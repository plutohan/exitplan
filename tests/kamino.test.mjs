import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateKaminoWithdraw, USDC_RESERVE, KAMINO_MAIN_MARKET } from '../server/kamino.mjs';

const WALLET = 'DrEDgXWTBfZbbVNT2ZdvxA5DUZx8CLTteGnsSJaXtZsK';
const calls = [];
const tokenAccountData = amount => { const bytes = new Uint8Array(165); new DataView(bytes.buffer).setBigUint64(64, BigInt(amount), true); return Buffer.from(bytes).toString('base64'); };
function fakeSdk({ obligation = { obligationAddress: 'Dhs7xv1M' }, simulation = { err: null, unitsConsumed: 112573n, logs: new Array(38).fill('log'), accounts: [{ data: [tokenAccountData(1_000_000 + 1_663_850_000), 'base64'] }] }, failLoad = false, preBalance = '1000000' } = {}) {
  calls.length = 0;
  const rpc = {
    getTokenAccountBalance: () => ({ send: async () => { if (preBalance === null) throw new Error('could not find account'); return { value: { amount: preBalance } }; } }),
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
    getProgramDerivedAddress: async ({ seeds }) => { calls.push(['pda', seeds.length]); return ['UserUsdcAta', 255]; },
    getAddressEncoder: () => ({ encode: () => new Uint8Array(32) }),
    KaminoMarket: { load: async (rpc, market, slotMs) => { calls.push(['load', market, slotMs]); if (failLoad) throw new Error('rpc down'); return { getUserVanillaObligation: async wallet => { calls.push(['obligation', wallet]); return obligation; } }; } },
    KaminoAction: { buildWithdrawTxns: async props => { calls.push(['build', props.amount, props.reserveAddress, props.owner.address, props.useV2Ixs]); return { computeBudgetIxs: [{ k: 'cu' }], setupIxs: [{ k: 'ata' }, { k: 'refreshReserve' }, { k: 'refreshObligation' }], setupIxsLabels: ['CreateUserAta[x]', 'RefreshReserve[r]', 'RefreshObligation[o]'], lendingIxs: [{ k: 'withdraw' }], lendingIxsLabels: ['withdrawObligationCollateralAndRedeemReserveCollateralV2'], cleanupIxs: [], cleanupIxsLabels: [] }; } },
    resolveLedgerInstantForSlot: async (rpc, slot) => ({ slot, blockTime: 1_791_741_027n }),
  };
}

test('builds an unsigned Kamino withdrawal for the wallet and simulates it without sending', async () => {
  const result = await simulateKaminoWithdraw({ wallet: WALLET, amountUsdc: 1663.85 }, { sdk: fakeSdk(), rpcUrl: 'https://rpc.example', now: () => 1_791_741_027_000 });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true, error: null, unitsConsumed: 112573, logCount: 38, instructions: ['CreateUserAta[x]', 'RefreshReserve[r]', 'RefreshObligation[o]', 'withdrawObligationCollateralAndRedeemReserveCollateralV2'], amountUsdc: 1663.85, deliveredUsdc: 1663.85, observedAt: '2026-10-11T17:50:27.000Z', rpc: 'rpc.example', obligation: 'Dhs7xv1M', transactionBase64: 'WIRE:5' /* compute budget + 3 setup + withdraw */ });
  assert.deepEqual(calls.find(c => c[0] === 'build'), ['build', '1663850000', USDC_RESERVE, WALLET, true]);
  assert.deepEqual(calls.find(c => c[0] === 'load').slice(1), [KAMINO_MAIN_MARKET, 450]);
  const sim = calls.find(c => c[0] === 'simulateTransaction');
  assert.equal(sim[1], 'WIRE:5');
  assert.deepEqual(sim[2], { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'processed', accounts: { encoding: 'base64', addresses: ['UserUsdcAta'] } });
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

test('delivered USDC comes from the simulated token account, and a missing account before means a zero start', async () => {
  const fresh = await simulateKaminoWithdraw({ wallet: WALLET, amountUsdc: 1663.85 }, { sdk: fakeSdk({ preBalance: null, simulation: { err: null, unitsConsumed: 1n, logs: [], accounts: [{ data: [tokenAccountData(1_663_850_000), 'base64'] }] } }) });
  assert.equal(fresh.body.deliveredUsdc, 1663.85);
  const capped = await simulateKaminoWithdraw({ wallet: WALLET, amountUsdc: 20000 }, { sdk: fakeSdk({ simulation: { err: null, unitsConsumed: 1n, logs: [], accounts: [{ data: [tokenAccountData(1_000_000 + 9_607_060_000), 'base64'] }] } }) });
  assert.equal(capped.body.ok, true);
  assert.equal(capped.body.deliveredUsdc, 9607.06, 'the simulation reports what would actually arrive, not the requested amount');
  const noAccounts = await simulateKaminoWithdraw({ wallet: WALLET, amountUsdc: 5 }, { sdk: fakeSdk({ simulation: { err: null, unitsConsumed: 1n, logs: [], accounts: [null] } }) });
  assert.equal(noAccounts.body.deliveredUsdc, null);
});

test('the Kamino market is cached for 30 seconds per RPC to spare the public endpoint', async () => {
  const sdk = fakeSdk();
  let clock = 1_000_000;
  const now = () => clock;
  await simulateKaminoWithdraw({ wallet: WALLET, amountUsdc: 1 }, { sdk, rpcUrl: 'https://cache.example', now });
  await simulateKaminoWithdraw({ wallet: WALLET, amountUsdc: 1 }, { sdk, rpcUrl: 'https://cache.example', now });
  assert.equal(calls.filter(c => c[0] === 'load').length, 1, 'second call within 30 s must reuse the market');
  clock += 31_000;
  await simulateKaminoWithdraw({ wallet: WALLET, amountUsdc: 1 }, { sdk, rpcUrl: 'https://cache.example', now });
  assert.equal(calls.filter(c => c[0] === 'load').length, 2);
});

test('a slot whose block the RPC does not have yet is retried on an older slot instead of failing the simulation', async () => {
  const sdk = fakeSdk();
  const slotCalls = [], ledgerSlots = [];
  const rpc = sdk.createSolanaRpc('https://rpc.example');
  rpc.getSlot = (options) => { slotCalls.push(options); return { send: async () => 455_000_000n }; };
  sdk.resolveLedgerInstantForSlot = async (_rpc, slot) => {
    ledgerSlots.push(slot);
    if (ledgerSlots.length === 1) { const error = new Error('Solana error #-32004; Block not available for slot 455000000'); error.context = { __code: -32004 }; throw error; }
    return { slot, blockTime: 1_791_741_027n };
  };
  const result = await simulateKaminoWithdraw({ wallet: 'DrEDgXWTBfZbbVNT2ZdvxA5DUZx8CLTteGnsSJaXtZsK', amountUsdc: 74.99 }, { sdk });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.ok, true);
  assert.deepEqual(slotCalls, [{ commitment: 'finalized' }], 'the slot must be a finalized one, whose block every node has');
  assert.equal(ledgerSlots.length, 2);
  assert.ok(ledgerSlots[1] < ledgerSlots[0], 'the retry uses an older slot');
});

test('when no nearby block is available at all, the simulation still runs on a wall-clock ledger instant', async () => {
  const sdk = fakeSdk();
  const ledgerSlots = [];
  sdk.resolveLedgerInstantForSlot = async (_rpc, slot) => { ledgerSlots.push(slot); const error = new Error('Solana error #-32004'); error.context = { __code: -32004 }; throw error; };
  const result = await simulateKaminoWithdraw({ wallet: 'DrEDgXWTBfZbbVNT2ZdvxA5DUZx8CLTteGnsSJaXtZsK', amountUsdc: 74.99 }, { sdk, now: () => 1_791_828_010_000 });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.ok, true);
  assert.equal(ledgerSlots.length, 4, 'four slots are tried before the fallback');
});

test('a non-RPC error from the ledger lookup is still reported as an outage', async () => {
  const sdk = fakeSdk();
  sdk.resolveLedgerInstantForSlot = async () => { throw new Error('boom'); };
  const result = await simulateKaminoWithdraw({ wallet: 'DrEDgXWTBfZbbVNT2ZdvxA5DUZx8CLTteGnsSJaXtZsK', amountUsdc: 74.99 }, { sdk });
  assert.equal(result.status, 502);
});

test('a block-not-available error anywhere in the attempt is retried, and the second attempt succeeds', async () => {
  const sdk = fakeSdk();
  let calls = 0;
  const originalLoad = sdk.KaminoMarket.load;
  sdk.KaminoMarket.load = async (...args) => { // the fake builds a fresh market per load, so patch the one the function will use
    const market = await originalLoad(...args);
    const inner = market.getUserVanillaObligation;
    market.getUserVanillaObligation = async (...a) => { calls++; if (calls === 1) { const error = new Error('Solana error #-32004'); error.context = { __code: -32004 }; throw error; } return inner(...a); };
    return market;
  };
  const slept = [];
  const result = await simulateKaminoWithdraw({ wallet: 'DrEDgXWTBfZbbVNT2ZdvxA5DUZx8CLTteGnsSJaXtZsK', amountUsdc: 74.99 }, { sdk, sleep: async (ms) => { slept.push(ms); } });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.ok, true);
  assert.equal(calls, 2);
  assert.deepEqual(slept, [300]);
});

test('three block-not-available failures in a row are reported as an outage, not retried forever', async () => {
  const sdk = fakeSdk();
  let calls = 0;
  const originalLoad = sdk.KaminoMarket.load;
  sdk.KaminoMarket.load = async (...args) => {
    const market = await originalLoad(...args);
    market.getUserVanillaObligation = async () => { calls++; const error = new Error('Solana error #-32004'); error.context = { __code: -32004 }; throw error; };
    return market;
  };
  const result = await simulateKaminoWithdraw({ wallet: 'DrEDgXWTBfZbbVNT2ZdvxA5DUZx8CLTteGnsSJaXtZsK', amountUsdc: 74.99 }, { sdk, sleep: async () => {} });
  assert.equal(result.status, 502);
  assert.equal(calls, 3);
});
