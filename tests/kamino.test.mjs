import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateKaminoWithdraw, USDC_RESERVE, KAMINO_MAIN_MARKET } from '../server/kamino.mjs';

const WALLET = 'DrEDgXWTBfZbbVNT2ZdvxA5DUZx8CLTteGnsSJaXtZsK';
const calls = [];
function fakeSdk({ obligation = { obligationAddress: 'Dhs7xv1M' }, simulation = { err: null, unitsConsumed: 112573n, logs: new Array(38).fill('log') }, failLoad = false } = {}) {
  calls.length = 0;
  const rpc = {
    getSlot: () => ({ send: async () => 455_000_000n }),
    getLatestBlockhash: () => ({ send: async () => ({ value: { blockhash: 'hash', lastValidBlockHeight: 1n } }) }),
    simulateTransaction: (wire, options) => ({ send: async () => { calls.push(['simulateTransaction', wire, options]); return { value: simulation }; } }),
  };
  return {
    createSolanaRpc: url => { calls.push(['rpc', url]); return rpc; },
    address: value => value,
    createNoopSigner: value => ({ address: value }),
    pipe: (value, ...fns) => fns.reduce((acc, fn) => fn(acc), value),
    createTransactionMessage: () => ({ instructions: [] }),
    setTransactionMessageFeePayer: (payer, message) => ({ ...message, payer }),
    setTransactionMessageLifetimeUsingBlockhash: (blockhash, message) => ({ ...message, blockhash }),
    appendTransactionMessageInstructions: (instructions, message) => ({ ...message, instructions: [...message.instructions, ...instructions] }),
    compileTransaction: message => ({ message }),
    getBase64EncodedWireTransaction: tx => 'WIRE:' + tx.message.instructions.length,
    KaminoMarket: { load: async (rpc, market, slotMs) => { calls.push(['load', market, slotMs]); if (failLoad) throw new Error('rpc down'); return { getUserVanillaObligation: async wallet => { calls.push(['obligation', wallet]); return obligation; } }; } },
    KaminoAction: { buildWithdrawTxns: async props => { calls.push(['build', props.amount, props.reserveAddress, props.owner.address, props.useV2Ixs]); return { computeBudgetIxs: [{ k: 'cu' }], setupIxs: [{ k: 'ata' }, { k: 'refreshReserve' }, { k: 'refreshObligation' }], setupIxsLabels: ['CreateUserAta[x]', 'RefreshReserve[r]', 'RefreshObligation[o]'], lendingIxs: [{ k: 'withdraw' }], lendingIxsLabels: ['withdrawObligationCollateralAndRedeemReserveCollateralV2'], cleanupIxs: [], cleanupIxsLabels: [] }; } },
    resolveLedgerInstantForSlot: async (rpc, slot) => ({ slot, blockTime: 1_791_741_027n }),
  };
}

test('builds an unsigned Kamino withdrawal for the wallet and simulates it without sending', async () => {
  const result = await simulateKaminoWithdraw({ wallet: WALLET, amountUsdc: 1663.85 }, { sdk: fakeSdk(), rpcUrl: 'https://rpc.example', now: () => 1_791_741_027_000 });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true, error: null, unitsConsumed: 112573, logCount: 38, instructions: ['CreateUserAta[x]', 'RefreshReserve[r]', 'RefreshObligation[o]', 'withdrawObligationCollateralAndRedeemReserveCollateralV2'], amountUsdc: 1663.85, observedAt: '2026-10-11T17:50:27.000Z', rpc: 'rpc.example', obligation: 'Dhs7xv1M' });
  assert.deepEqual(calls.find(c => c[0] === 'build'), ['build', '1663850000', USDC_RESERVE, WALLET, true]);
  assert.deepEqual(calls.find(c => c[0] === 'load').slice(1), [KAMINO_MAIN_MARKET, 450]);
  const sim = calls.find(c => c[0] === 'simulateTransaction');
  assert.equal(sim[1], 'WIRE:5');
  assert.deepEqual(sim[2], { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'processed' });
  assert.ok(!calls.some(c => /send/i.test(String(c[0])) && c[0] !== 'simulateTransaction'));
});

test('a failed simulation is reported with the program error, not hidden', async () => {
  const result = await simulateKaminoWithdraw({ wallet: WALLET, amountUsdc: 5 }, { sdk: fakeSdk({ simulation: { err: { InstructionError: [3, { Custom: 6025 }] }, unitsConsumed: 40000n, logs: ['x'] } }) });
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, false);
  assert.match(result.body.error, /InstructionError/);
});

test('rejects bad input before touching the RPC, and reports a missing obligation or RPC failure honestly', async () => {
  for (const bad of [{ wallet: 'nope', amountUsdc: 1 }, { wallet: WALLET, amountUsdc: 0 }, { wallet: WALLET, amountUsdc: -2 }, { wallet: WALLET, amountUsdc: 'ten' }, { wallet: WALLET, amountUsdc: 1e9 }, null]) {
    const result = await simulateKaminoWithdraw(bad, { sdk: fakeSdk() });
    assert.equal(result.status, 400, JSON.stringify(bad));
    assert.ok(!calls.some(c => c[0] === 'rpc'), 'no RPC client for invalid input');
  }
  const none = await simulateKaminoWithdraw({ wallet: WALLET, amountUsdc: 1 }, { sdk: fakeSdk({ obligation: null }) });
  assert.equal(none.status, 404);
  assert.match(none.body.error, /no Kamino obligation/i);
  const down = await simulateKaminoWithdraw({ wallet: WALLET, amountUsdc: 1 }, { sdk: fakeSdk({ failLoad: true }) });
  assert.equal(down.status, 502);
  assert.doesNotMatch(JSON.stringify(down.body), /rpc down/);
});

test('an SDK "could not find vanilla obligation" error is reported as a missing obligation, not an outage', async () => {
  const sdk = fakeSdk();
  const market = await sdk.KaminoMarket.load();
  sdk.KaminoMarket.load = async () => ({ ...market, getUserVanillaObligation: async () => { throw new Error('Could not find vanilla obligation JDnJphHGTGbt2CJAkgtpa2wyUwL1WDLj9wft3qkBUygW'); } });
  const result = await simulateKaminoWithdraw({ wallet: WALLET, amountUsdc: 1 }, { sdk });
  assert.equal(result.status, 404);
  assert.match(result.body.error, /no Kamino obligation/i);
});

test('a failure to load the SDK is a clean 502, never an unhandled exception', async () => {
  const result = await simulateKaminoWithdraw({ wallet: WALLET, amountUsdc: 1 }, { loadSdkImpl: async () => { throw new Error('Cannot find module klend'); } });
  assert.equal(result.status, 502);
  assert.equal(result.body.ok, false);
  assert.doesNotMatch(JSON.stringify(result.body), /Cannot find module/);
});
