import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { importHyperliquid, estimateLiquidationAfter, AdapterError } from '../web/adapters/hyperliquid.mjs';
import { planExit, defaultConstraints, createDemoPortfolio, requiredMarginCents } from '../web/engine.mjs';

const fixture = async name => JSON.parse(await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const ADDR = '0x' + 'a'.repeat(40);
const mids = { SOL: '109.695', BTC: '70000' };
const fetchFor = (state, options = {}) => async (url, init) => {
  assert.equal(url, 'https://api.hyperliquid.xyz/info');
  const body = JSON.parse(init.body);
  if (body.type === 'allMids') return Response.json(options.mids ?? mids);
  if (body.type === 'userAbstraction') { assert.equal(body.user, ADDR); return Response.json(options.mode ?? 'disabled'); }
  if (body.type === 'vaultDetails') { assert.equal(body.vaultAddress, ADDR); return Response.json(options.vault ?? null); }
  if (body.type === 'spotClearinghouseState') { assert.equal(body.user, ADDR); if (options.spot === 'error') return new Response('boom', { status: 503 }); return Response.json(options.spot ?? { balances: [] }); }
  if (body.type === 'clearinghouseState') { assert.equal(body.user, ADDR); return Response.json(state); }
  if (body.type === 'meta') { if (options.meta === 'error') return new Response('boom', { status: 500 }); return Response.json(options.meta ?? await fixture('hl-meta')); }
  if (body.type === 'userFees') { assert.equal(body.user, ADDR); if (options.fees === 'error') return new Response('boom', { status: 500 }); return Response.json(options.fees ?? await fixture('hl-user-fees')); }
  if (body.type === 'fundingHistory') { assert.equal(body.coin, 'SOL'); assert.ok(Number.isInteger(body.startTime)); if (options.funding === 'error') return new Response('boom', { status: 500 }); return Response.json(options.funding ?? await fixture('hl-funding-history')); }
  assert.fail('unexpected request ' + init.body);
};
const solPosition = state => state.assetPositions.find(a => a.position.coin === 'SOL');

test('normalises a cross-margin SOL short into the engine shape', async () => {
  const state = await fixture('hl-sol-short');
  const result = await importHyperliquid(ADDR, { fetchImpl: fetchFor(state), now: () => 1_791_731_274_640 });
  assert.equal(result.evidence, 'imported');
  assert.equal(result.venue, 'hyperliquid');
  const sol = solPosition(state).position;
  assert.equal(result.state.markPrice, Math.round((Number(sol.positionValue) / Math.abs(Number(sol.szi))) * 100) / 100, 'mark comes from the position value when a position exists');
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
  for (const mode of ['portfolioMargin', 'dexAbstraction', 'somethingNew', 42]) {
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

test('reports the exchange liquidation price and max leverage', async () => {
  const result = await importHyperliquid(ADDR, { fetchImpl: fetchFor(await fixture('hl-sol-short')) });
  assert.ok(result.reported.liquidationPrice > result.state.markPrice, 'a short liquidates above the mark');
  assert.equal(result.reported.maxLeverage, 20);
});

test('liquidation estimate is anchored on the exchange price and moves the right way', () => {
  const base = { liquidationPrice: 267.04, markPrice: 111.9, shortSol: 91.32, maxLeverage: 20 };
  assert.equal(estimateLiquidationAfter({ ...base, withdraw: 0, closeQty: 0, closeFee: 0 }), 267.04);
  const afterWithdraw = estimateLiquidationAfter({ ...base, withdraw: 1000, closeQty: 0, closeFee: 0 });
  assert.ok(afterWithdraw < 267.04 && afterWithdraw > base.markPrice, String(afterWithdraw));
  const afterClose = estimateLiquidationAfter({ ...base, withdraw: 0, closeQty: 10, closeFee: 0.56 });
  assert.ok(afterClose > 267.04, String(afterClose));
  assert.equal(estimateLiquidationAfter({ ...base, withdraw: 0, closeQty: 91.32, closeFee: 0 }), null);
  assert.equal(estimateLiquidationAfter({ ...base, liquidationPrice: null, withdraw: 0, closeQty: 0, closeFee: 0 }), null);
});

test('portfolio-margin rejections explain what is modelled', async () => {
  const state = await fixture('hl-sol-short');
  await assert.rejects(importHyperliquid(ADDR, { fetchImpl: fetchFor(state, { mode: 'portfolioMargin' }) }), e => e.code === 'UNSUPPORTED_ACCOUNT_MODE' && /portfolio margin/i.test(e.message) && /Standard and Unified/.test(e.message));
});

test('a unified account imports with the spot USDC total as equity and total minus hold as withdrawable', async () => {
  const perps = await fixture('hl-unified-perps');
  const spot = await fixture('hl-unified-spot');
  const result = await importHyperliquid(ADDR, { fetchImpl: fetchFor(perps, { mode: 'unifiedAccount', spot }) });
  assert.equal(result.reported.accountMode, 'unifiedAccount');
  assert.equal(result.state.accountMode, 'unified');
  const usdc = spot.balances.find(b => b.coin === 'USDC');
  const total = Number(usdc.total), hold = Number(usdc.hold);
  const residualHold = 0;
  assert.ok(Math.abs(hold - (Number(perps.marginSummary.accountValue) - Number(perps.withdrawable))) < 0.01, 'fixture: hold equals perps equity minus perps withdrawable');
  const locked = perps.assetPositions.filter(a => a.position.coin !== 'SOL').reduce((sum, a) => sum + Math.round(Math.max(Number(a.position.marginUsed), 0.1 * Number(a.position.positionValue)) * 100) / 100, 0);
  assert.equal(result.state.collateral, Math.round((total - residualHold - locked) * 100) / 100);
  assert.deepEqual(result.reported.otherPositions.map(p => p.lockedMargin), perps.assetPositions.filter(a => a.position.coin !== 'SOL').map(a => Math.round(Math.max(Number(a.position.marginUsed), 0.1 * Number(a.position.positionValue)) * 100) / 100));
  assert.equal(result.reported.withdrawable, Math.round((total - hold) * 100) / 100);
  assert.equal(result.reported.accountValue, Math.round((total - residualHold) * 100) / 100);
  assert.ok(result.state.freeWithdrawable <= result.reported.withdrawable);
  assert.ok(result.assumptions.some(line => /Unified account/.test(line) && /spot USDC/.test(line)), result.assumptions.join(' | '));
  assert.deepEqual(result.reported.spotUsdc, { total, hold });
  const noUsdc = await importHyperliquid(ADDR, { fetchImpl: fetchFor(perps, { mode: 'unifiedAccount', spot: { balances: [] } }) }).catch(e => e);
  assert.equal(noUsdc.code, 'INVALID_RESPONSE', 'a unified account with positions must have a USDC spot entry');
});

test('a residual spot hold (open spot orders) lowers withdrawable but not unified equity', async () => {
  const perps = await fixture('hl-unified-perps');
  const spot = structuredClone(await fixture('hl-unified-spot'));
  const usdc = spot.balances.find(b => b.coin === 'USDC');
  usdc.hold = String(Number(usdc.hold) + 500);
  delete spot.tokenToAvailableAfterMaintenance;
  const result = await importHyperliquid(ADDR, { fetchImpl: fetchFor(perps, { mode: 'unifiedAccount', spot }) });
  assert.equal(result.reported.accountValue, Math.round(Number(usdc.total) * 100) / 100);
  assert.equal(result.reported.withdrawable, Math.round((Number(usdc.total) - Number(usdc.hold)) * 100) / 100);
});

test('a unified account whose maintenance figure contradicts the spot total imports with a cross-check warning', async () => {
  const perps = await fixture('hl-unified-perps');
  const good = await importHyperliquid(ADDR, { fetchImpl: fetchFor(perps, { mode: 'unifiedAccount', spot: await fixture('hl-unified-spot') }) });
  assert.equal(good.reported.crossCheck.ok, true);
  const spot = structuredClone(await fixture('hl-unified-spot'));
  spot.tokenToAvailableAfterMaintenance = [[0, '50000']];
  const result = await importHyperliquid(ADDR, { fetchImpl: fetchFor(perps, { mode: 'unifiedAccount', spot }) });
  assert.equal(result.reported.crossCheck.ok, false);
  assert.equal(result.reported.crossCheck.available, 50000);
  assert.ok(result.assumptions.some(line => /other perp DEXs/.test(line) && /not modelled/.test(line)), result.assumptions.join(' | '));
});

test('a unified account fails closed on a missing or malformed spot state, but an empty account may lack a USDC entry', async () => {
  const perps = await fixture('hl-unified-perps');
  for (const spot of [undefined, {}, { balances: 'nope' }, { balances: [{ coin: 'USDC', token: 0, total: '-1', hold: '0' }] }, { balances: [] }]) {
    await assert.rejects(importHyperliquid(ADDR, { fetchImpl: fetchFor(perps, { mode: 'unifiedAccount', spot }) }), e => e.code === 'INVALID_RESPONSE' && /spot/i.test(e.message), JSON.stringify(spot));
  }
  const empty = structuredClone(await fixture('hl-no-position'));
  empty.marginSummary.accountValue = '0.0'; empty.withdrawable = '0.0';
  const result = await importHyperliquid(ADDR, { fetchImpl: fetchFor(empty, { mode: 'unifiedAccount', spot: { balances: [] } }) });
  assert.equal(result.state.collateral, 0);
  assert.equal(result.state.shortSol, 0);
});

test('a SOL short below 10x leverage reserves its initial margin rate instead of the 10% floor', async () => {
  const state = structuredClone(await fixture('hl-sol-short'));
  const sol = solPosition(state).position;
  sol.leverage.value = 5;
  sol.marginUsed = String(Number(sol.positionValue) / 5);
  const result = await importHyperliquid(ADDR, { fetchImpl: fetchFor(state) });
  assert.equal(result.state.conservativeMarginRate, 0.2);
  const twenty = await importHyperliquid(ADDR, { fetchImpl: fetchFor(await fixture('hl-sol-short')) });
  assert.equal(twenty.state.conservativeMarginRate, 0.1);
  sol.leverage.value = 3;
  const three = await importHyperliquid(ADDR, { fetchImpl: fetchFor(state) });
  assert.equal(three.state.conservativeMarginRate, 0.3334);
});

test('other stable collateral and SOL held on HyperCore spot are reported, not silently dropped', async () => {
  const perps = await fixture('hl-unified-perps');
  const spot = structuredClone(await fixture('hl-unified-spot'));
  spot.balances.push({ coin: 'USDH', token: 360, total: '1000.5', hold: '0.0', entryNtl: '1000.5' }, { coin: 'USOL', token: 200, total: '12.5', hold: '0.0', entryNtl: '1300' }, { coin: 'PURR', token: 1, total: '3', hold: '0', entryNtl: '1' });
  const result = await importHyperliquid(ADDR, { fetchImpl: fetchFor(perps, { mode: 'unifiedAccount', spot }) });
  assert.deepEqual(result.reported.otherStables, [{ coin: 'USDH', total: 1000.5 }]);
  assert.equal(result.reported.spotSol, 12.5);
  assert.ok(result.assumptions.some(line => /USDH/.test(line) && /not modelled/.test(line)), result.assumptions.join(' | '));
  assert.ok(result.assumptions.some(line => /12\.5 USOL/.test(line)), result.assumptions.join(' | '));
  const plain = await importHyperliquid(ADDR, { fetchImpl: fetchFor(await fixture('hl-sol-short')) });
  assert.deepEqual(plain.reported.otherStables, []);
  assert.equal(plain.reported.spotSol, 0);
});

test('a Hyperliquid vault address is rejected as not a user account', async () => {
  const state = await fixture('hl-sol-short');
  await assert.rejects(importHyperliquid(ADDR, { fetchImpl: fetchFor(state, { mode: 'default', vault: { name: 'Hyperliquidity Provider (HLP)', vaultAddress: ADDR, leader: '0x' + '1'.repeat(40) } }) }), e => e instanceof AdapterError && e.code === 'VAULT_ADDRESS' && /vault/.test(e.message));
  const ok = await importHyperliquid(ADDR, { fetchImpl: fetchFor(state, { vault: null }) });
  assert.equal(ok.state.shortSol > 0, true);
});

test('other positions lock max(initial margin, 10% of notional), which matches the exchange withdrawable within $1 on both real accounts', async () => {
  const standard = await importHyperliquid(ADDR, { fetchImpl: fetchFor(await fixture('hl-sol-short')) });
  const unified = await importHyperliquid(ADDR, { fetchImpl: fetchFor(await fixture('hl-unified-perps'), { mode: 'unifiedAccount', spot: await fixture('hl-unified-spot') }) });
  for (const result of [standard, unified]) {
    const reserve = requiredMarginCents(result.state.shortSol, result.state.markPrice, result.state.conservativeMarginRate) / 100;
    const modelFree = Math.round((result.state.collateral - reserve) * 100) / 100;
    assert.ok(Math.abs(modelFree - result.reported.withdrawable) <= 1, `${result.reported.accountMode}: model ${modelFree} vs exchange ${result.reported.withdrawable}`);
    assert.ok(result.state.freeWithdrawable <= result.reported.withdrawable);
  }
  assert.equal(unified.reported.lockedMargin, 108035.6);
  assert.equal(standard.reported.lockedMargin, 12818.25);
});

test('imports the 7-day average SOL funding as an annual rate, and degrades to unknown when the history is unavailable', async () => {
  const state = await fixture('hl-sol-short');
  const history = await fixture('hl-funding-history');
  const mean = history.reduce((sum, h) => sum + Number(h.fundingRate), 0) / history.length;
  const result = await importHyperliquid(ADDR, { fetchImpl: fetchFor(state) });
  assert.equal(result.state.fundingApr, Math.round(mean * 24 * 365 * 1e6) / 1e6);
  const hours = Math.round((Math.max(...history.map(h => h.time)) - Math.min(...history.map(h => h.time))) / 3_600_000) + 1;
  assert.deepEqual(result.reported.funding, { samples: history.length, hours, hourlyMean: Math.round(mean * 1e10) / 1e10, apr: result.state.fundingApr });
  assert.ok(result.assumptions.some(line => /7-day average/.test(line) && /funding/.test(line)), result.assumptions.join(' | '));
  const down = await importHyperliquid(ADDR, { fetchImpl: fetchFor(state, { funding: 'error' }) });
  assert.equal(down.state.fundingApr, null);
  assert.equal(down.reported.funding, null);
  assert.ok(down.assumptions.some(line => /funding history unavailable/i.test(line)), down.assumptions.join(' | '));
  const empty = await importHyperliquid(ADDR, { fetchImpl: fetchFor(state, { funding: [] }) });
  assert.equal(empty.state.fundingApr, null);
  const garbage = await importHyperliquid(ADDR, { fetchImpl: fetchFor(state, { funding: [{ fundingRate: 'nope' }] }) });
  assert.equal(garbage.state.fundingApr, null);
});

test('imports the account taker rate as the short-reduction fee, rounded up to the basis point, and degrades to the 5 bps model', async () => {
  const state = await fixture('hl-sol-short');
  const result = await importHyperliquid(ADDR, { fetchImpl: fetchFor(state) });
  assert.deepEqual(result.reported.fees, { takerRate: 0.0003825, makerRate: 0.0001275, closeBps: 4 });
  assert.ok(result.assumptions.some(line => /taker rate/.test(line) && /3\.825 bps/.test(line) && /up to 4 bps/.test(line)), result.assumptions.join(' | '));
  const fresh = await importHyperliquid(ADDR, { fetchImpl: fetchFor(state, { fees: { userCrossRate: '0.00045', userAddRate: '0.00015' } }) });
  assert.equal(fresh.reported.fees.closeBps, 5);
  const down = await importHyperliquid(ADDR, { fetchImpl: fetchFor(state, { fees: 'error' }) });
  assert.equal(down.reported.fees, null);
  assert.ok(down.assumptions.some(line => /fee schedule unavailable/i.test(line) && /5 bps/.test(line)), down.assumptions.join(' | '));
  const garbage = await importHyperliquid(ADDR, { fetchImpl: fetchFor(state, { fees: { userCrossRate: 'abc' } }) });
  assert.equal(garbage.reported.fees, null);
});

test('reads the SOL lot size and asset index from meta, falling back to the known 0.01 lot when meta is unavailable', async () => {
  const state = await fixture('hl-sol-short');
  const meta = await fixture('hl-meta');
  const index = meta.universe.findIndex(u => u.name === 'SOL');
  const result = await importHyperliquid(ADDR, { fetchImpl: fetchFor(state) });
  assert.equal(result.reported.szDecimals, 2);
  assert.equal(result.reported.assetIndex, index);
  assert.equal(result.state.lotSize, 0.01);
  assert.equal(result.state.minOrderUsd, 10);
  assert.ok(result.assumptions.some(line => /0\.01 SOL lots/.test(line) && /\$10/.test(line)), result.assumptions.join(' | '));
  const down = await importHyperliquid(ADDR, { fetchImpl: fetchFor(state, { meta: 'error' }) });
  assert.equal(down.state.lotSize, 0.01);
  assert.equal(down.reported.assetIndex, null);
  assert.ok(down.assumptions.some(line => /lot size assumed/i.test(line)), down.assumptions.join(' | '));
  const odd = await importHyperliquid(ADDR, { fetchImpl: fetchFor(state, { meta: { universe: [{ name: 'SOL', szDecimals: 3, maxLeverage: 20 }] } }) });
  assert.equal(odd.state.lotSize, 0.001);
});

test('a failed spot read only degrades a standard import, but still fails a unified one', async () => {
  const standard = await importHyperliquid(ADDR, { fetchImpl: fetchFor(await fixture('hl-sol-short'), { spot: 'error' }) });
  assert.equal(standard.state.shortSol > 0, true);
  assert.deepEqual(standard.reported.spotUsdc, { total: 0, hold: 0 });
  assert.ok(standard.assumptions.some(line => /spot balances unavailable/i.test(line)), standard.assumptions.join(' | '));
  await assert.rejects(importHyperliquid(ADDR, { fetchImpl: fetchFor(await fixture('hl-unified-perps'), { mode: 'unifiedAccount', spot: 'error' }) }), e => e.code === 'INVALID_RESPONSE' && /spot/i.test(e.message));
});

test('a funding anomaly or a short history degrades carry to unknown or is labelled by its real span, never a fatal portfolio', async () => {
  const state = await fixture('hl-sol-short');
  const hour = 3_600_000, start = 1_791_000_000_000;
  const series = (n, rate) => Array.from({ length: n }, (_, i) => ({ coin: 'SOL', fundingRate: String(rate), premium: '0', time: start + i * hour }));
  const wild = await importHyperliquid(ADDR, { fetchImpl: fetchFor(state, { funding: series(168, 0.001) }) }); // 876% a year
  assert.equal(wild.state.fundingApr, null);
  assert.ok(wild.assumptions.some(line => /funding/i.test(line) && /out of range/i.test(line)), wild.assumptions.join(' | '));
  const short = await importHyperliquid(ADDR, { fetchImpl: fetchFor(state, { funding: series(10, 0.00001) }) });
  assert.equal(short.state.fundingApr, Math.round(0.00001 * 24 * 365 * 1e6) / 1e6);
  assert.equal(short.reported.funding.hours, 10);
  assert.ok(short.assumptions.some(line => /10-hour average/.test(line)), short.assumptions.join(' | '));
  assert.ok(!short.assumptions.some(line => /7-day average/.test(line)));
  const full = await importHyperliquid(ADDR, { fetchImpl: fetchFor(state) });
  assert.ok(full.assumptions.some(line => /7-day average/.test(line)));
});

test('the taker rate is turned into basis points exactly from the decimal string, rounded up', async () => {
  const state = await fixture('hl-sol-short');
  for (const [rate, bps] of [['0.0004', 4], ['0.00040001', 5], ['0.0003825', 4], ['0.00045', 5], ['0.0001', 1], ['0', 0]]) {
    const result = await importHyperliquid(ADDR, { fetchImpl: fetchFor(state, { fees: { userCrossRate: rate, userAddRate: '0.0001' } }) });
    assert.equal(result.reported.fees.closeBps, bps, `${rate} → ${bps} bps`);
  }
});

test('a unified hold larger than the total is rejected instead of clamped', async () => {
  const spot = structuredClone(await fixture('hl-unified-spot'));
  const usdc = spot.balances.find(b => b.coin === 'USDC');
  usdc.hold = String(Number(usdc.total) + 1);
  await assert.rejects(importHyperliquid(ADDR, { fetchImpl: fetchFor(await fixture('hl-unified-perps'), { mode: 'unifiedAccount', spot }) }), e => e.code === 'INVALID_RESPONSE' && /hold/i.test(e.message));
});
