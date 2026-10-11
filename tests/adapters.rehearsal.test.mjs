import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { simulateSellSol, AdapterError } from '../web/adapters/rehearsal.mjs';

const quote = JSON.parse(await readFile(new URL('./fixtures/jupiter-quote.json', import.meta.url), 'utf8'));
const WALLET = 'DrEDgXWTBfZbbVNT2ZdvxA5DUZx8CLTteGnsSJaXtZsK';
const sequence = ({ swapStatus = 200, simulateValue = { err: null, logs: ['a', 'b', 'c'], unitsConsumed: 123456 } } = {}) => {
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
      return swapStatus === 200 ? Response.json({ swapTransaction: 'AQAA' }) : new Response('bad', { status: swapStatus });
    }
    if (target.host === 'solana-rpc.publicnode.com') {
      const body = JSON.parse(init.body);
      assert.equal(body.method, 'simulateTransaction');
      assert.equal(body.params[0], 'AQAA');
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
