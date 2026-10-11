import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { messageFromTransaction, inspectorUrl, previewReduceShort, simulateSellSol, simulateKaminoWithdraw, AdapterError } from '../web/adapters/rehearsal.mjs';

const quote = JSON.parse(await readFile(new URL('./fixtures/jupiter-quote.json', import.meta.url), 'utf8'));
const WALLET = 'DrEDgXWTBfZbbVNT2ZdvxA5DUZx8CLTteGnsSJaXtZsK';
const sequence = ({ swapStatus = 200, simulateValue = { err: null, logs: ['a', 'b', 'c'], unitsConsumed: 123456 }, swapTransaction = 'AQAA' } = {}) => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const target = new URL(url);
    calls.push(target.host + target.pathname);
    if (target.host === 'lite-api.jup.ag' && target.pathname === '/swap/v1/quote') {
      assert.equal(target.searchParams.get('amount'), '1500000000');
      return Response.json({ ...quote, inAmount: '1500000000', outAmount: '167817933' });
    }
    if (target.pathname === '/swap/v1/swap') {
      const body = JSON.parse(init.body);
      assert.equal(body.userPublicKey, WALLET);
      assert.equal(body.quoteResponse.outAmount, '167817933');
      assert.equal(body.wrapAndUnwrapSol, true);
      return swapStatus === 200 ? Response.json({ swapTransaction }) : new Response('bad', { status: swapStatus });
    }
    if (target.host === 'solana-rpc.publicnode.com') {
      const body = JSON.parse(init.body);
      assert.equal(body.method, 'simulateTransaction');
      assert.equal(body.params[0], swapTransaction);
      assert.deepEqual(body.params[1], { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'processed' });
      return Response.json({ jsonrpc: '2.0', id: 1, result: { context: { slot: 1 }, value: simulateValue } });
    }
    assert.fail('unexpected request ' + url);
  };
  return { calls, fetchImpl };
};

test('simulates the sell leg through quote, swap build and simulateTransaction without sending', async () => {
  const { calls, fetchImpl } = sequence();
  const result = await simulateSellSol({ address: WALLET, solAmount: 1.5, fetchImpl, now: () => 1_791_731_274_640 });
  assert.equal(result.ok, true);
  assert.equal(result.error, null);
  assert.equal(result.unitsConsumed, 123456);
  assert.equal(result.logCount, 3);
  assert.equal(result.quotedUsdc, 167.817933);
  assert.equal(result.lamports, 1_500_000_000);
  assert.deepEqual(calls, ['lite-api.jup.ag/swap/v1/quote', 'lite-api.jup.ag/swap/v1/swap', 'solana-rpc.publicnode.com/']);
  assert.equal(result.observedAt, new Date(1_791_731_274_640).toISOString());
});

test('a failed simulation is reported, not hidden', async () => {
  const { fetchImpl } = sequence({ simulateValue: { err: { InstructionError: [2, { Custom: 1 }] }, logs: [], unitsConsumed: 10 } });
  const result = await simulateSellSol({ address: WALLET, solAmount: 1.5, fetchImpl });
  assert.equal(result.ok, false);
  assert.match(result.error, /InstructionError/);
});

test('swap build failure is an HTTP error', async () => {
  const { fetchImpl } = sequence({ swapStatus: 400 });
  await assert.rejects(simulateSellSol({ address: WALLET, solAmount: 1.5, fetchImpl }), e => e instanceof AdapterError && e.code === 'HTTP_ERROR');
});

test('rejects a bad address or amount without fetching', async () => {
  const fetchImpl = () => assert.fail('must not fetch');
  await assert.rejects(simulateSellSol({ address: '0x' + 'a'.repeat(40), solAmount: 1, fetchImpl }), e => e.code === 'INVALID_ADDRESS');
  for (const solAmount of [0, -1, NaN, 'two']) {
    await assert.rejects(simulateSellSol({ address: WALLET, solAmount, fetchImpl }), e => e.code === 'INVALID_AMOUNT');
  }
});

test('the Kamino withdrawal simulation posts to the same-origin function and maps the answer', async () => {
  let seen;
  const fetchImpl = async (url, init = {}) => { seen = { url, init }; return Response.json({ ok: true, error: null, unitsConsumed: 112573, logCount: 38, instructions: ['RefreshReserve[r]', 'withdrawV2'], amountUsdc: 25 }); };
  const result = await simulateKaminoWithdraw({ address: WALLET, amountUsdc: 25, fetchImpl });
  assert.equal(seen.url, '/api/kamino-withdraw');
  assert.equal(seen.init.method, 'POST');
  assert.deepEqual(JSON.parse(seen.init.body), { wallet: WALLET, amountUsdc: 25 });
  assert.equal(result.ok, true);
  assert.equal(result.unitsConsumed, 112573);
  assert.deepEqual(result.instructions, ['RefreshReserve[r]', 'withdrawV2']);
  assert.equal(result.inspectorUrl, null, 'no transaction in the answer, no link');
  const tx = Buffer.concat([Buffer.from([1]), Buffer.alloc(64), Buffer.from([0x80, 7])]).toString('base64');
  const withTx = await simulateKaminoWithdraw({ address: WALLET, amountUsdc: 25, fetchImpl: async () => Response.json({ ok: true, error: null, unitsConsumed: 1, logCount: 1, instructions: ['withdrawV2'], amountUsdc: 25, transactionBase64: tx }) });
  assert.equal(withTx.transactionBase64, tx);
  assert.equal(withTx.inspectorUrl, inspectorUrl(tx));
  await assert.rejects(simulateKaminoWithdraw({ address: WALLET, amountUsdc: 25, fetchImpl: async () => Response.json({ error: 'No Kamino obligation' }, { status: 404 }) }), e => e instanceof AdapterError && /obligation/.test(e.message));
  await assert.rejects(simulateKaminoWithdraw({ address: 'bad', amountUsdc: 25, fetchImpl: () => assert.fail('must not fetch') }), e => e.code === 'INVALID_ADDRESS');
  await assert.rejects(simulateKaminoWithdraw({ address: WALLET, amountUsdc: 0, fetchImpl: () => assert.fail('must not fetch') }), e => e.code === 'INVALID_AMOUNT');
});

test('previews a short reduction by walking the live asks read-only: average price, slippage, levels and partial fills', async () => {
  const book = JSON.parse(await readFile(new URL('./fixtures/hl-l2book.json', import.meta.url), 'utf8'));
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, body: JSON.parse(init.body) });
    assert.equal(url, 'https://api.hyperliquid.xyz/info');
    assert.equal(init.method, 'POST', 'the info API takes a JSON POST; a GET with a body is rejected by browsers');
    assert.deepEqual(JSON.parse(init.body), { type: 'l2Book', coin: 'SOL' });
    return Response.json(book);
  };
  const asks = book.levels[1];
  const bestAsk = Number(asks[0].px), bestBid = Number(book.levels[0][0].px);
  const small = await previewReduceShort({ quantity: 20, fetchImpl });
  assert.equal(small.ok, true);
  assert.equal(small.filled, 20);
  assert.equal(small.averagePrice, bestAsk);
  assert.equal(small.bestAsk, bestAsk);
  assert.equal(small.bestBid, bestBid);
  assert.equal(small.levelsUsed, 1);
  assert.equal(small.slippageBps, 0);
  assert.equal(small.partial, false);
  assert.equal(small.bookTime, book.time);
  let remaining = 2000, cost = 0, used = 0;
  for (const level of asks) { const take = Math.min(remaining, Number(level.sz)); cost += take * Number(level.px); remaining -= take; used += 1; if (remaining <= 0) break; }
  const large = await previewReduceShort({ quantity: 2000, fetchImpl });
  assert.equal(large.averagePrice, Math.round((cost / 2000) * 10000) / 10000);
  assert.equal(large.levelsUsed, used);
  assert.ok(large.slippageBps >= 0);
  const depth = asks.reduce((sum, level) => sum + Number(level.sz), 0);
  const huge = await previewReduceShort({ quantity: 1_000_000, fetchImpl });
  assert.equal(huge.partial, true);
  assert.equal(huge.filled, Math.round(depth * 1e6) / 1e6);
  assert.equal(huge.visibleDepth, Math.round(depth * 1e6) / 1e6);
  assert.equal(calls.length, 3, 'one info read per preview and nothing else');
  await assert.rejects(previewReduceShort({ quantity: 0, fetchImpl }), e => e.code === 'INVALID_AMOUNT');
  await assert.rejects(previewReduceShort({ quantity: 1, fetchImpl: async () => Response.json({ levels: 'nope' }) }), e => e.code === 'INVALID_RESPONSE');
});

test('the preview builds the unsigned reduce-only IOC order the user would sign, with a tick-rounded limit, cost vs plan and book age', async () => {
  const book = JSON.parse(await readFile(new URL('./fixtures/hl-l2book.json', import.meta.url), 'utf8'));
  const fetchImpl = async () => Response.json(book);
  const bestAsk = Number(book.levels[1][0].px);
  const result = await previewReduceShort({ quantity: 20, assetIndex: 5, szDecimals: 2, markPrice: 111, slippageCapBps: 50, now: () => book.time + 3000, fetchImpl });
  const limit = Math.ceil(bestAsk * 1.005 * 100) / 100; // 5 significant figures → 2 decimals at this price, rounded up for a buy
  assert.deepEqual(result.order, { a: 5, b: true, p: limit.toFixed(2), s: '20', r: true, t: { limit: { tif: 'Ioc' } } });
  assert.equal(result.limitPrice, limit);
  assert.equal(result.costVsPlan, Math.round((bestAsk - 111) * 20 * 100) / 100);
  assert.equal(result.slippageVsMarkBps, Math.round(((bestAsk - 111) / 111) * 10000 * 10) / 10);
  assert.equal(result.bookAgeSeconds, 3);
  assert.equal(result.stale, false);
  const old = await previewReduceShort({ quantity: 20, assetIndex: 5, szDecimals: 2, now: () => book.time + 20_000, fetchImpl });
  assert.equal(old.stale, true);
  assert.equal(old.costVsPlan, null, 'no mark, no cost comparison');
  const snapped = await previewReduceShort({ quantity: 20.123, assetIndex: 5, szDecimals: 2, fetchImpl });
  assert.equal(snapped.order.s, '20.12');
  assert.equal(snapped.sizeSnapped, true);
  const noIndex = await previewReduceShort({ quantity: 20, fetchImpl });
  assert.equal(noIndex.order, null);
  const cheap = await previewReduceShort({ quantity: 20, assetIndex: 5, szDecimals: 2, fetchImpl: async () => Response.json({ ...book, levels: [[{ px: '0.012345', sz: '1000' }], [{ px: '0.012346', sz: '1000' }]] }) });
  assert.equal(cheap.order.p, '0.0125', 'four decimals at most for a perp with szDecimals 2, rounded up');
});

const fakeTx = (signatures, message) => Buffer.concat([Buffer.from([signatures]), Buffer.alloc(64 * signatures), Buffer.from(message)]).toString('base64');

test('the explorer inspector link carries the message bytes (transaction minus its signature slots), and is omitted for malformed input', () => {
  const message = [0x80, 1, 2, 3, 4];
  assert.equal(messageFromTransaction(fakeTx(1, message)), Buffer.from(message).toString('base64'));
  assert.equal(messageFromTransaction(fakeTx(2, message)), Buffer.from(message).toString('base64'));
  assert.equal(inspectorUrl(fakeTx(1, message)), `https://explorer.solana.com/tx/inspector?message=${encodeURIComponent(Buffer.from(message).toString('base64'))}`);
  for (const bad of ['AQAA', '', Buffer.from([0, 1, 2]).toString('base64'), Buffer.from([1, ...new Array(64).fill(0)]).toString('base64')]) {
    assert.equal(messageFromTransaction(bad), null, JSON.stringify(bad));
    assert.equal(inspectorUrl(bad), null);
  }
});

test('the sell simulation hands back the unsigned transaction and its inspector link', async () => {
  const tx = fakeTx(1, [0x80, 9, 9]);
  const { fetchImpl } = sequence({ swapTransaction: tx });
  const result = await simulateSellSol({ address: WALLET, solAmount: 1.5, fetchImpl, now: () => 1_791_731_274_640 });
  assert.equal(result.transactionBase64, tx);
  assert.equal(result.inspectorUrl, inspectorUrl(tx));
});
