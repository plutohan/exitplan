import test from 'node:test';
import assert from 'node:assert/strict';
import { getMarketSnapshot, normalizeImportedAccount, HYPERLIQUID_INFO_URL, HyperliquidDataError } from '../server/hyperliquid.mjs';

const TIME = Date.parse('2026-10-11T13:00:00.000Z');
const now = () => TIME;
const json = (value, options = {}) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' }, ...options });
const hasCode = (code) => (error) => error instanceof HyperliquidDataError && error.code === code;
const fixture = () => ({
  accountMode: 'standard',
  userAbstraction: 'disabled',
  dex: '',
  clearinghouseState: {
    time: TIME - 1000,
    marginSummary: { accountValue: '1200', totalMarginUsed: '100' },
    crossMarginSummary: { accountValue: '1200' },
    withdrawable: '1100',
    assetPositions: [{ type: 'oneWay', position: {
      coin: 'SOL', szi: '-10', entryPx: '140', positionValue: '1500',
      unrealizedPnl: '-100', marginUsed: '100', liquidationPx: null,
      leverage: { type: 'cross', value: 3 },
    } }],
  },
  spotClearinghouseState: { balances: [{ coin: 'USDC', token: 0, total: '600', hold: '100' }] },
});

test('public snapshot uses only allMids and preserves price provenance', async () => {
  let request;
  let tick = 0;
  const snapshot = await getMarketSnapshot({
    now: () => TIME + tick++,
    fetchImpl: async (url, options) => { request = { url, options }; return json({ SOL: '151.1250', BTC: '90000' }); },
  });
  assert.equal(request.url, HYPERLIQUID_INFO_URL);
  assert.equal(request.options.method, 'POST');
  assert.deepEqual(JSON.parse(request.options.body), { type: 'allMids' });
  assert.equal(request.options.credentials, 'omit');
  assert.equal(request.options.redirect, 'error');
  assert.ok(request.options.signal instanceof AbortSignal);
  assert.equal(snapshot.evidence, 'live-market');
  assert.equal(snapshot.solUsd, 151.125);
  assert.equal(snapshot.solPriceRaw, '151.1250');
  assert.equal(snapshot.observedAt, new Date(TIME + 1).toISOString());
  assert.equal(snapshot.requestedAt, new Date(TIME).toISOString());
  assert.equal(snapshot.sourceTimestamp, null);
  assert.equal(snapshot.executable, false);
  assert.equal(snapshot.priceKind, 'perpetual-mid-or-last-trade');
  assert.equal(snapshot.portfolio, undefined);
});

test('accepts a finite positive numeric price without inventing precision', async () => {
  const snapshot = await getMarketSnapshot({ now, fetchImpl: async () => json({ SOL: 150.25 }) });
  assert.equal(snapshot.solUsd, 150.25);
  assert.equal(snapshot.solPriceRaw, '150.25');
});

test('missing SOL fails closed without a scenario-price fallback', async () => {
  await assert.rejects(getMarketSnapshot({ now, fetchImpl: async () => json({ BTC: '90000' }) }), hasCode('MISSING_PRICE'));
});

test('invalid prices and response shapes fail closed', async () => {
  for (const bad of [null, false, true, '', ' ', 'NaN', 'Infinity', '0xFF', '1e4', [], {}, '0', '-1', '99999999999999999', 0, -4]) {
    await assert.rejects(getMarketSnapshot({ now, fetchImpl: async () => json({ SOL: bad }) }), hasCode('INVALID_DATA'), `accepted ${JSON.stringify(bad)}`);
  }
  for (const bad of [null, [], '150', 150]) {
    await assert.rejects(getMarketSnapshot({ now, fetchImpl: async () => json(bad) }), hasCode('INVALID_DATA'));
  }
});

test('HTTP errors retain status and do not expose response contents', async () => {
  for (const status of [403, 429, 500]) {
    await assert.rejects(getMarketSnapshot({ now, fetchImpl: async () => new Response('private diagnostic', { status }) }), (error) => {
      assert.equal(error.code, 'HTTP_ERROR');
      assert.equal(error.status, status);
      assert.ok(!error.message.includes('private diagnostic'));
      return true;
    });
  }
});

test('non-JSON, broken JSON, and oversized responses are rejected', async () => {
  await assert.rejects(getMarketSnapshot({ now, fetchImpl: async () => new Response('<html>oops</html>') }), hasCode('INVALID_RESPONSE'));
  await assert.rejects(getMarketSnapshot({ now, fetchImpl: async () => new Response('{', { headers: { 'content-type': 'application/json' } }) }), hasCode('INVALID_JSON'));
  await assert.rejects(getMarketSnapshot({ now, fetchImpl: async () => new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '2000000' } }) }), hasCode('INVALID_RESPONSE'));
  await assert.rejects(getMarketSnapshot({ now, fetchImpl: async () => json({ SOL: '150', excess: 'x'.repeat(1_048_576) }) }), hasCode('INVALID_RESPONSE'));
});

test('network failure is distinct from data and HTTP errors', async () => {
  await assert.rejects(getMarketSnapshot({ now, fetchImpl: async () => { throw new TypeError('connection reset'); } }), hasCode('NETWORK_ERROR'));
});

test('timeout aborts the request even when fetch does not honor the signal', async () => {
  let signal;
  await assert.rejects(getMarketSnapshot({ now, timeoutMs: 10, fetchImpl: (_, options) => { signal = options.signal; return new Promise(() => {}); } }), hasCode('TIMEOUT'));
  assert.equal(signal.aborted, true);
});

test('timeout also covers a stalled response body', async () => {
  await assert.rejects(getMarketSnapshot({ now, timeoutMs: 10, fetchImpl: async () => ({ ok: true, headers: new Headers({ 'content-type': 'application/json' }), text: () => new Promise(() => {}) }) }), hasCode('TIMEOUT'));
});

test('invalid adapter options are rejected before a network call', async () => {
  for (const options of [{ timeoutMs: 0 }, { timeoutMs: -1 }, { timeoutMs: 100000 }, { timeoutMs: 1.5 }, { now: null }, { fetchImpl: null }]) {
    await assert.rejects(getMarketSnapshot(options), hasCode('INVALID_OPTIONS'));
  }
  await assert.rejects(getMarketSnapshot({ now: () => NaN }), hasCode('INVALID_DATA'));
});

test('offline import counts perps equity once and leaves spot unpriced', () => {
  const input = fixture();
  const before = structuredClone(input);
  const result = normalizeImportedAccount(input, { now });
  assert.equal(result.evidence, 'imported-account');
  assert.equal(result.perpsEquityUsd, 1200);
  assert.equal(result.reportedWithdrawableUsd, 1100);
  assert.equal(result.positions[0].side, 'short');
  assert.equal(result.positions[0].size, -10);
  assert.equal(result.positions[0].unrealizedPnlUsd, -100);
  assert.equal(result.positions[0].liquidationPrice, null);
  assert.equal(result.spotBalances[0].total, 600);
  assert.equal(result.spotBalances[0].unheld, 500);
  assert.equal(result.spotBalances[0].valueUsd, null);
  assert.equal(result.combinedAccountValueUsd, null);
  assert.equal(result.sourceAsOf, new Date(TIME - 1000).toISOString());
  assert.deepEqual(input, before);
});

test('negative equity is preserved rather than hidden or clamped', () => {
  const input = fixture();
  input.clearinghouseState.marginSummary.accountValue = '-50';
  assert.equal(normalizeImportedAccount(input, { now }).perpsEquityUsd, -50);
});

test('a missing spot export stays unknown instead of becoming zero', () => {
  const input = fixture();
  delete input.spotClearinghouseState;
  assert.equal(normalizeImportedAccount(input, { now }).spotBalances, null);
});

test('nonstandard and unknown abstraction modes are never silently normalized', () => {
  for (const userAbstraction of ['unifiedAccount', 'portfolioMargin', 'dexAbstraction', 'default', 'standard', '', undefined, null]) {
    const input = fixture(); input.userAbstraction = userAbstraction;
    assert.throws(() => normalizeImportedAccount(input, { now }), hasCode('UNSUPPORTED_ACCOUNT_MODE'));
  }
  for (const accountMode of ['unified', 'portfolioMargin', undefined]) {
    const input = fixture(); input.accountMode = accountMode;
    assert.throws(() => normalizeImportedAccount(input, { now }), hasCode('UNSUPPORTED_ACCOUNT_MODE'));
  }
});

test('rejects absent or builder DEX identity and builder positions', () => {
  for (const dex of [undefined, 'xyz']) {
    const input = fixture(); input.dex = dex;
    assert.throws(() => normalizeImportedAccount(input, { now }), hasCode('UNSUPPORTED_DEX'));
  }
  const input = fixture(); input.clearinghouseState.assetPositions[0].position.coin = 'xyz:SOL';
  assert.throws(() => normalizeImportedAccount(input, { now }), hasCode('UNSUPPORTED_DEX'));
});

test('rejects duplicate positions and balances rather than double counting', () => {
  const first = fixture(); first.clearinghouseState.assetPositions.push(structuredClone(first.clearinghouseState.assetPositions[0]));
  assert.throws(() => normalizeImportedAccount(first, { now }), hasCode('INVALID_DATA'));
  const second = fixture(); second.spotClearinghouseState.balances.push(structuredClone(second.spotClearinghouseState.balances[0]));
  assert.throws(() => normalizeImportedAccount(second, { now }), hasCode('INVALID_DATA'));
});

test('rejects missing equity, impossible holds, future times, and missing position data', () => {
  const edits = [
    (input) => { delete input.clearinghouseState.marginSummary.accountValue; },
    (input) => { input.spotClearinghouseState.balances[0].hold = '999'; },
    (input) => { input.clearinghouseState.time = TIME + 61_000; },
    (input) => { delete input.clearinghouseState.assetPositions[0].position.szi; },
    (input) => { delete input.clearinghouseState.assetPositions[0].position.liquidationPx; },
  ];
  for (const edit of edits) {
    const input = fixture(); edit(input);
    assert.throws(() => normalizeImportedAccount(input, { now }), hasCode('INVALID_DATA'));
  }
});
