import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { importSolana, isSolanaAddress, solSaleBpsFromQuote, AdapterError, KAMINO_MAIN_MARKET, USDC_RESERVE, SOL_RESERVE } from '../web/adapters/solana.mjs';
import { planExit, defaultConstraints, createDemoPortfolio } from '../web/engine.mjs';

const fixture = async name => JSON.parse(await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const WALLET = 'DrEDgXWTBfZbbVNT2ZdvxA5DUZx8CLTteGnsSJaXtZsK';
const fetchFor = ({ lamports = 3_219_600_000, obligations, quote, rpcError = null }) => async (url, init = {}) => {
  const target = new URL(url);
  if (target.origin === 'https://solana-rpc.publicnode.com') {
    const body = JSON.parse(init.body);
    assert.equal(body.method, 'getBalance');
    assert.equal(body.params[0], WALLET);
    return Response.json(rpcError ? { jsonrpc: '2.0', id: 1, error: rpcError } : { jsonrpc: '2.0', id: 1, result: { context: { slot: 1 }, value: lamports } });
  }
  if (target.origin === 'https://api.kamino.finance') {
    assert.equal(target.pathname, `/kamino-market/${KAMINO_MAIN_MARKET}/users/${WALLET}/obligations`);
    return Response.json(obligations);
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
  assert.deepEqual(result.state.lending, { usdc: 0, debt: 0, withdrawCapacity: 0 });
});

test('rejects malformed address without fetching', async () => {
  assert.equal(isSolanaAddress(WALLET), true);
  for (const bad of ['0x' + 'a'.repeat(40), 'short', WALLET + 'OIl0', '']) {
    assert.equal(isSolanaAddress(bad), false);
    await assert.rejects(importSolana(bad, { fetchImpl: () => assert.fail('must not fetch') }), e => e instanceof AdapterError && e.code === 'INVALID_ADDRESS');
  }
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
