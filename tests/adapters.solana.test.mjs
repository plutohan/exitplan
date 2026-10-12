import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { importSolana, hasKaminoUsdcAndSol, isSolanaAddress, solSaleBpsFromQuote, AdapterError, KAMINO_MAIN_MARKET, USDC_RESERVE, SOL_RESERVE } from '../web/adapters/solana.mjs';
import { planExit, defaultConstraints, createDemoPortfolio } from '../web/engine.mjs';

const fixture = async name => JSON.parse(await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const WALLET = 'DrEDgXWTBfZbbVNT2ZdvxA5DUZx8CLTteGnsSJaXtZsK';
const DEFAULT_METRICS = [{ reserve: 'D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59', liquidityToken: 'USDC', totalSupply: '120702201.40143211682', totalBorrow: '112626977.24339373829' }];
const fetchFor = ({ lamports = 3_219_600_000, obligations, quote, rpcError = null, balances, metrics = DEFAULT_METRICS }) => async (url, init = {}) => {
  const target = new URL(url);
  if (target.origin === 'https://solana-rpc.publicnode.com') {
    const body = JSON.parse(init.body);
    assert.equal(body.method, 'getBalance');
    assert.equal(body.params[0], WALLET);
    return Response.json(rpcError ? { jsonrpc: '2.0', id: 1, error: rpcError } : { jsonrpc: '2.0', id: 1, result: { context: { slot: 1 }, value: lamports } });
  }
  if (target.origin === 'https://api.kamino.finance' && target.pathname.endsWith('/reserves/metrics')) {
    assert.equal(target.pathname, `/kamino-market/${KAMINO_MAIN_MARKET}/reserves/metrics`);
    return Response.json(metrics);
  }
  if (target.origin === 'https://api.kamino.finance') {
    assert.equal(target.pathname, `/kamino-market/${KAMINO_MAIN_MARKET}/users/${WALLET}/obligations`);
    return Response.json(obligations);
  }
  if (target.origin === 'https://lite-api.jup.ag' && target.pathname.startsWith('/ultra/v1/balances/')) {
    assert.equal(target.pathname, `/ultra/v1/balances/${WALLET}`);
    return Response.json(balances === undefined ? { SOL: { amount: '3219600000', uiAmount: 3.2196 }, EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { amount: '336400000', uiAmount: 336.4 } } : balances);
  }
  if (target.origin === 'https://lite-api.jup.ag') {
    assert.equal(target.searchParams.get('amount'), '1000000000');
    assert.equal(init.method ?? 'GET', 'GET');
    return Response.json(quote);
  }
  assert.fail('unexpected request ' + url);
};
const loaded = async () => ({ obligations: await fixture('kamino-obligations'), quote: await fixture('jupiter-quote') });

test('normalises balance, Kamino USDC deposits and a Jupiter quote into the engine shape', async () => {
  const result = await importSolana(WALLET, { fetchImpl: fetchFor(await loaded()), now: () => 1_791_731_274_640 });
  assert.equal(result.evidence, 'imported');
  assert.equal(result.venue, 'solana');
  assert.equal(result.state.sol, 3.2196);
  assert.equal(result.state.solPrice, 111.88);
  assert.equal(result.state.lending.usdc, 9607.36);
  assert.equal(result.state.lending.debt, 0);
  assert.equal(result.state.lending.withdrawCapacity, 9607.36);
  assert.equal(result.state.wallet.usdc, 336.4);
  assert.equal(result.state.borrow.maxLtv, 0.3);
  assert.equal(result.state.borrow.capacity, Math.round(3.2196 * 111.88 * 0.3 * 100) / 100);
  assert.equal(result.quote.solSaleBps, 50);
  assert.equal(result.observedAt, new Date(1_791_731_274_640).toISOString());
  const portfolio = { ...createDemoPortfolio(), evidence: 'imported', synthetic: false, solana: result.state };
  assert.deepEqual(planExit(portfolio, defaultConstraints()).errors, []);
});

test('reports debt when any obligation has borrows and the engine rejects it', async () => {
  const data = await loaded();
  data.obligations[0].state.borrows[0].borrowReserve = USDC_RESERVE;
  data.obligations[0].refreshedStats.userTotalBorrow = '100';
  const result = await importSolana(WALLET, { fetchImpl: fetchFor(data) });
  assert.equal(result.state.lending.debt, 100);
  const portfolio = { ...createDemoPortfolio(), evidence: 'imported', synthetic: false, solana: result.state };
  assert.match(planExit(portfolio, defaultConstraints()).errors.join(' '), /Existing lending debt/);
});

test('rejects a mixed-asset obligation', async () => {
  const data = await loaded();
  data.obligations[0].state.deposits[1].depositReserve = SOL_RESERVE;
  data.obligations[0].state.deposits[1].depositedAmount = '1';
  await assert.rejects(importSolana(WALLET, { fetchImpl: fetchFor(data) }), e => e instanceof AdapterError && e.code === 'UNSUPPORTED_OBLIGATION');
});

test('a wallet with no Kamino obligation imports zero lending', async () => {
  const result = await importSolana(WALLET, { fetchImpl: fetchFor({ obligations: [], quote: await fixture('jupiter-quote') }) });
  assert.deepEqual(result.state.lending, { usdc: 0, debt: 0, withdrawCapacity: 0, supplyApy: null });
});

test('rejects malformed address without fetching', async () => {
  assert.equal(isSolanaAddress(WALLET), true);
  for (const bad of ['0x' + 'a'.repeat(40), 'short', WALLET + 'OIl0', '']) {
    assert.equal(isSolanaAddress(bad), false);
    await assert.rejects(importSolana(bad, { fetchImpl: () => assert.fail('must not fetch') }), e => e instanceof AdapterError && e.code === 'INVALID_ADDRESS');
  }
});

test('Jupiter priceImpactPct is a fraction: 0.025 means 2.5% (verified 2026-10-11 with a 200,000 SOL quote: per-SOL price fell 2.5%)', () => {
  assert.equal(solSaleBpsFromQuote({ priceImpactPct: '0.0250889608' }), 301);
});

test('sale fee never drops below 30 bps and grows with price impact', () => {
  assert.equal(solSaleBpsFromQuote({ priceImpactPct: '0' }), 50);
  assert.equal(solSaleBpsFromQuote({ priceImpactPct: '-0.01' }), 30);
  assert.equal(solSaleBpsFromQuote({ priceImpactPct: '0.0025' }), 75);
});

test('RPC errors and malformed quotes fail closed', async () => {
  const data = await loaded();
  await assert.rejects(importSolana(WALLET, { fetchImpl: fetchFor({ ...data, rpcError: { code: -32602, message: 'bad' } }) }), e => e.code === 'HTTP_ERROR');
  await assert.rejects(importSolana(WALLET, { fetchImpl: fetchFor({ ...data, quote: { routePlan: [] } }) }), e => e.code === 'INVALID_RESPONSE');
});

test('rejects obligations whose deposit list is missing or inconsistent with the total', async () => {
  const missing = await loaded();
  delete missing.obligations[0].state.deposits;
  await assert.rejects(importSolana(WALLET, { fetchImpl: fetchFor(missing) }), e => e instanceof AdapterError && e.code === 'INVALID_RESPONSE');
  const inconsistent = await loaded();
  for (const entry of inconsistent.obligations[0].state.deposits) { entry.depositReserve = '11111111111111111111111111111111'; entry.depositedAmount = '0'; }
  await assert.rejects(importSolana(WALLET, { fetchImpl: fetchFor(inconsistent) }), e => e instanceof AdapterError && e.code === 'INVALID_RESPONSE');
});

test('wallet USDC comes from Jupiter balances and is zero when absent or malformed', async () => {
  const data = await loaded();
  const none = await importSolana(WALLET, { fetchImpl: fetchFor({ ...data, balances: { SOL: { uiAmount: 1 } } }) });
  assert.equal(none.state.wallet.usdc, 0);
  await assert.rejects(importSolana(WALLET, { fetchImpl: fetchFor({ ...data, balances: [] }) }), e => e.code === 'INVALID_RESPONSE');
  await assert.rejects(importSolana(WALLET, { fetchImpl: fetchFor({ ...data, balances: { EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { uiAmount: 'lots' } } }) }), e => e.code === 'INVALID_RESPONSE');
});

test('withdraw capacity is capped by the USDC reserve liquidity and fails closed without it', async () => {
  const data = await loaded();
  const capped = await importSolana(WALLET, { fetchImpl: fetchFor({ ...data, metrics: [{ reserve: USDC_RESERVE, totalSupply: '100', totalBorrow: '40' }] }) });
  assert.equal(capped.state.lending.usdc, 9607.36);
  assert.equal(capped.state.lending.withdrawCapacity, 60);
  assert.equal(capped.reported.reserveLiquidity, 60);
  assert.ok(capped.assumptions.some(line => /reserve liquidity/i.test(line)));
  await assert.rejects(importSolana(WALLET, { fetchImpl: fetchFor({ ...data, metrics: [] }) }), e => e.code === 'INVALID_RESPONSE');
  await assert.rejects(importSolana(WALLET, { fetchImpl: fetchFor({ ...data, metrics: [{ reserve: USDC_RESERVE, totalSupply: 'x', totalBorrow: '1' }] }) }), e => e.code === 'INVALID_RESPONSE');
});

test('only the vanilla obligation is modelled; other obligations are ignored and disclosed', async () => {
  const data = await loaded();
  const extra = structuredClone(data.obligations[0]);
  extra.obligationAddress = 'OtherObligation1111111111111111111111111111';
  extra.humanTag = 'Multiply'; extra.obligationTag = 1;
  extra.refreshedStats.userTotalDeposit = '5000';
  data.obligations.push(extra);
  const result = await importSolana(WALLET, { fetchImpl: fetchFor(data) });
  assert.equal(result.state.lending.usdc, 9607.36, 'the non-vanilla obligation must not be counted');
  assert.ok(result.assumptions.some(line => /1 other obligation/.test(line)), result.assumptions.join(' | '));
  const onlyOther = await loaded();
  onlyOther.obligations[0].obligationTag = 1; onlyOther.obligations[0].humanTag = 'Multiply';
  const none = await importSolana(WALLET, { fetchImpl: fetchFor(onlyOther) });
  assert.equal(none.state.lending.usdc, 0);
});

test('imports the USDC reserve supply APY for carry, null when the metrics omit it', async () => {
  const data = { obligations: await fixture('kamino-obligations'), quote: await fixture('jupiter-quote') };
  const withApy = await importSolana(WALLET, { fetchImpl: fetchFor({ ...data, metrics: [{ ...DEFAULT_METRICS[0], supplyApy: '0.0468228385' }] }) });
  assert.equal(withApy.state.lending.supplyApy, 0.046823);
  assert.ok(withApy.assumptions.some(line => /supply APY/.test(line) && /4\.68%/.test(line)), withApy.assumptions.join(' | '));
  const without = await importSolana(WALLET, { fetchImpl: fetchFor(data) });
  assert.equal(without.state.lending.supplyApy, null);
  const bad = await importSolana(WALLET, { fetchImpl: fetchFor({ ...data, metrics: [{ ...DEFAULT_METRICS[0], supplyApy: 'x' }] }) });
  assert.equal(bad.state.lending.supplyApy, null);
});

test('when the Jupiter swap quote is down, the planning price falls back to Jupiter\'s price endpoint with a conservative sale fee and says so', async () => {
  const data = { obligations: await fixture('kamino-obligations'), quote: await fixture('jupiter-quote') };
  const base = fetchFor(data);
  const fetchImpl = async (url, init) => {
    const target = new URL(url);
    if (target.host === 'lite-api.jup.ag' && target.pathname === '/swap/v1/quote') return new Response('down', { status: 503 });
    if (target.host === 'lite-api.jup.ag' && target.pathname === '/price/v3') { assert.equal(target.searchParams.get('ids'), 'So11111111111111111111111111111111111111112'); return Response.json({ So11111111111111111111111111111111111111112: { usdPrice: 111.14267732935319, decimals: 9 } }); }
    return base(url, init);
  };
  const result = await importSolana(WALLET, { fetchImpl, retryDelayMs: 1 });
  assert.equal(result.state.solPrice, 111.14);
  assert.equal(result.quote.solSaleBps, 50);
  assert.equal(result.quote.source, 'jupiter-price');
  assert.ok(result.assumptions.some(line => /swap quote unavailable/i.test(line) && /50 bps/.test(line)), result.assumptions.join(' | '));
  const bothDown = async (url, init) => { const target = new URL(url); if (target.host === 'lite-api.jup.ag' && target.pathname !== '/ultra/v1/balances/' + WALLET && !target.pathname.startsWith('/ultra/')) return new Response('down', { status: 503 }); return base(url, init); };
  await assert.rejects(importSolana(WALLET, { fetchImpl: bothDown, retryDelayMs: 1 }), e => e.code === 'HTTP_ERROR');
});

const probeFetch = ({ lamports = 3_219_600_000, obligations }) => async (url, init = {}) => {
  const target = new URL(url);
  if (target.origin === 'https://solana-rpc.publicnode.com') return Response.json({ jsonrpc: '2.0', id: 1, result: { context: { slot: 1 }, value: lamports } });
  if (target.host === 'api.kamino.finance' && target.pathname.endsWith('/obligations')) return Response.json(obligations);
  assert.fail('the probe must only read the balance and the obligations: ' + url);
};

test('hasKaminoUsdcAndSol is true for a wallet with SOL and a USDC-only Kamino deposit, using two reads', async () => {
  const obligations = await fixture('kamino-obligations');
  assert.equal(await hasKaminoUsdcAndSol(WALLET, { fetchImpl: probeFetch({ obligations }) }), true);
});

test('hasKaminoUsdcAndSol is false without SOL, without a deposit, with a borrow or with a non-USDC deposit', async () => {
  const obligations = await fixture('kamino-obligations');
  assert.equal(await hasKaminoUsdcAndSol(WALLET, { fetchImpl: probeFetch({ obligations, lamports: 1_000_000 }) }), false);
  assert.equal(await hasKaminoUsdcAndSol(WALLET, { fetchImpl: probeFetch({ obligations: [] }) }), false);
  const borrowed = structuredClone(obligations);
  borrowed[0].state.borrows[0] = { borrowReserve: 'd4A2prbA2whesmvHaL88BH6Ewn5N4bTSU2Ze8P6Bc4Q' };
  borrowed[0].refreshedStats.userTotalBorrow = '12.5';
  assert.equal(await hasKaminoUsdcAndSol(WALLET, { fetchImpl: probeFetch({ obligations: borrowed }) }), false);
  const mixed = structuredClone(obligations);
  mixed[0].state.deposits[1] = { depositReserve: SOL_RESERVE };
  assert.equal(await hasKaminoUsdcAndSol(WALLET, { fetchImpl: probeFetch({ obligations: mixed }) }), false);
});

test('hasKaminoUsdcAndSol rejects an invalid address and propagates transport failures', async () => {
  await assert.rejects(hasKaminoUsdcAndSol('nope', { fetchImpl: probeFetch({ obligations: [] }) }), e => e instanceof AdapterError && e.code === 'INVALID_ADDRESS');
  await assert.rejects(hasKaminoUsdcAndSol(WALLET, { fetchImpl: async () => new Response('down', { status: 404 }) }), e => e instanceof AdapterError);
});
