import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { importHyperliquid, AdapterError } from '../web/adapters/hyperliquid.mjs';
import { planExit, defaultConstraints, createDemoPortfolio } from '../web/engine.mjs';

const fixture = async name => JSON.parse(await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const ADDR = '0x' + 'a'.repeat(40);
const mids = { SOL: '109.695', BTC: '70000' };
const fetchFor = (state, options = {}) => async (url, init) => {
  assert.equal(url, 'https://api.hyperliquid.xyz/info');
  const body = JSON.parse(init.body);
  if (body.type === 'allMids') return Response.json(options.mids ?? mids);
  if (body.type === 'userAbstraction') { assert.equal(body.user, ADDR); return Response.json(options.mode ?? 'disabled'); }
  if (body.type === 'clearinghouseState') { assert.equal(body.user, ADDR); return Response.json(state); }
  assert.fail('unexpected request ' + init.body);
};
const solPosition = state => state.assetPositions.find(a => a.position.coin === 'SOL');

test('normalises a cross-margin SOL short into the engine shape', async () => {
  const state = await fixture('hl-sol-short');
  const result = await importHyperliquid(ADDR, { fetchImpl: fetchFor(state), now: () => 1_791_731_274_640 });
  assert.equal(result.evidence, 'imported');
  assert.equal(result.venue, 'hyperliquid');
  assert.equal(result.state.markPrice, 109.7);
  assert.ok(result.state.shortSol > 0);
  assert.ok((String(result.state.shortSol).split('.')[1]?.length ?? 0) <= 6);
  assert.equal(result.state.accountMode, 'standard');
  assert.equal(result.state.marginMode, 'cross');
  assert.equal(result.observedAt, new Date(1_791_731_274_640).toISOString());
  const portfolio = { ...createDemoPortfolio(), evidence: 'imported', synthetic: false, hyperliquid: result.state };
  assert.deepEqual(planExit(portfolio, defaultConstraints()).errors, []);
});

test('other coins are allowed and their margin is deducted from equity', async () => {
  const state = await fixture('hl-sol-short');
  const others = state.assetPositions.filter(a => a.position.coin !== 'SOL');
  assert.ok(others.length > 0, 'fixture should hold other positions');
  const locked = others.reduce((sum, a) => sum + Number(a.position.marginUsed), 0);
  const result = await importHyperliquid(ADDR, { fetchImpl: fetchFor(state) });
  assert.equal(result.state.collateral, Math.round((Number(state.marginSummary.accountValue) - locked) * 100) / 100);
  assert.deepEqual(result.reported.otherPositions.map(p => p.coin), others.map(a => a.position.coin));
});

test('an account with no positions imports as a zero short', async () => {
  const state = await fixture('hl-no-position');
  const result = await importHyperliquid(ADDR, { fetchImpl: fetchFor(state) });
  assert.equal(result.state.shortSol, 0);
  assert.deepEqual(result.reported.otherPositions, []);
  assert.equal(result.state.freeWithdrawable, Math.min(Math.round(result.reported.withdrawable * 100) / 100, result.state.collateral));
});

test('rejects malformed address without fetching', async () => {
  for (const bad of ['0x123', 'abc', '0x' + 'g'.repeat(40), '']) {
    await assert.rejects(importHyperliquid(bad, { fetchImpl: () => assert.fail('must not fetch') }), e => e instanceof AdapterError && e.code === 'INVALID_ADDRESS');
  }
});

for (const [name, mutate, code] of [
  ['a long SOL position', s => { solPosition(s).position.szi = '12.5'; }, 'UNSUPPORTED_POSITION'],
  ['isolated margin', s => { solPosition(s).position.leverage.type = 'isolated'; }, 'ISOLATED_MARGIN'],
  ['equity below the 10% reserve', s => { s.marginSummary.accountValue = '1'; s.withdrawable = '0'; }, 'LEVERAGE_TOO_HIGH'],
  ['missing margin summary', s => { delete s.marginSummary; }, 'INVALID_RESPONSE'],
  ['non-numeric size', s => { solPosition(s).position.szi = 'lots'; }, 'INVALID_RESPONSE'],
]) test(`rejects ${name}`, async () => {
  const state = await fixture('hl-sol-short');
  mutate(state);
  await assert.rejects(importHyperliquid(ADDR, { fetchImpl: fetchFor(state) }), e => e instanceof AdapterError && e.code === code);
});

test('rounds mark price to cents and rejects a missing SOL mid', async () => {
  const state = await fixture('hl-no-position');
  const result = await importHyperliquid(ADDR, { fetchImpl: fetchFor(state, { mids: { SOL: '123.456789' } }) });
  assert.equal(result.state.markPrice, 123.46);
  await assert.rejects(importHyperliquid(ADDR, { fetchImpl: fetchFor(state, { mids: { BTC: '1' } }) }), e => e.code === 'INVALID_RESPONSE');
});

test('HTTP failure, bad JSON and timeout are distinct errors', async () => {
  await assert.rejects(importHyperliquid(ADDR, { fetchImpl: async () => new Response('x', { status: 500 }) }), e => e.code === 'HTTP_ERROR');
  await assert.rejects(importHyperliquid(ADDR, { fetchImpl: async () => new Response('{bad', { status: 200, headers: { 'content-type': 'application/json' } }) }), e => e.code === 'INVALID_RESPONSE');
  await assert.rejects(importHyperliquid(ADDR, { fetchImpl: () => new Promise(() => {}), timeoutMs: 5 }), e => e.code === 'TIMEOUT');
  await assert.rejects(importHyperliquid(ADDR, { fetchImpl: async () => { throw new TypeError('offline'); } }), e => e.code === 'NETWORK_ERROR');
});

test('states when the exchange reported less withdrawable than the model reserve allows', async () => {
  const state = await fixture('hl-sol-short');
  state.withdrawable = '0.0';
  const result = await importHyperliquid(ADDR, { fetchImpl: fetchFor(state) });
  assert.ok(result.state.collateral - result.state.shortSol * result.state.markPrice * 0.1 > 0, 'fixture must leave model headroom');
  assert.ok(result.assumptions.some(line => /reported \$0\.00 withdrawable/.test(line)), result.assumptions.join(' | '));
  assert.equal(result.reported.withdrawable, 0);
});

test('equity above the reserve but below locked margin still rejects with LEVERAGE_TOO_HIGH', async () => {
  const state = await fixture('hl-sol-short');
  const others = state.assetPositions.filter(a => a.position.coin !== 'SOL').reduce((sum, a) => sum + Number(a.position.marginUsed), 0);
  state.marginSummary.accountValue = String(others + 100); // positive collateral of $100, below the 10% reserve of a 700 SOL short
  await assert.rejects(importHyperliquid(ADDR, { fetchImpl: fetchFor(state) }), e => e.code === 'LEVERAGE_TOO_HIGH');
});

test('verifies the account mode on HyperCore: standard accepted, abstraction modes rejected', async () => {
  const state = await fixture('hl-sol-short');
  for (const mode of ['portfolioMargin', 'unifiedAccount', 'dexAbstraction', 'somethingNew', 42]) {
    await assert.rejects(importHyperliquid(ADDR, { fetchImpl: fetchFor(state, { mode }) }), e => e instanceof AdapterError && e.code === 'UNSUPPORTED_ACCOUNT_MODE');
  }
  const standard = await importHyperliquid(ADDR, { fetchImpl: fetchFor(state, { mode: 'disabled' }) });
  assert.equal(standard.reported.accountMode, 'disabled');
  assert.ok(standard.assumptions.some(line => /verified on HyperCore/.test(line)), standard.assumptions.join(' | '));
  assert.ok(standard.assumptions.every(line => !/does not verify/.test(line)));
  const unset = await importHyperliquid(ADDR, { fetchImpl: fetchFor(state, { mode: 'default' }) });
  assert.equal(unset.reported.accountMode, 'default');
  assert.ok(unset.assumptions.some(line => /"default"/.test(line)));
});
