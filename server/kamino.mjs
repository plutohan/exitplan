/**
 * Server-side, read-only Kamino withdrawal rehearsal: builds the real unsigned withdraw transaction with Kamino's SDK
 * (refresh reserve, refresh obligation, withdraw + redeem) for the given wallet and runs simulateTransaction.
 * Nothing is signed or sent. The SDK is loaded lazily so the rest of the server never pays for it.
 */
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const KAMINO_MAIN_MARKET = '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF';
export const USDC_RESERVE = 'D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59';
export const DEFAULT_RPC_URL = 'https://api.mainnet-beta.solana.com';
const MAX_USDC = 1_000_000;

let sdkPromise = null;
function loadSdk() {
  if (!sdkPromise) {
    sdkPromise = Promise.all([import('@solana/kit'), import('@kamino-finance/klend-sdk')]).then(([kit, klend]) => ({
      createSolanaRpc: kit.createSolanaRpc,
      address: kit.address,
      createNoopSigner: kit.createNoopSigner,
      pipe: kit.pipe,
      createTransactionMessage: kit.createTransactionMessage,
      setTransactionMessageFeePayer: kit.setTransactionMessageFeePayer,
      setTransactionMessageLifetimeUsingBlockhash: kit.setTransactionMessageLifetimeUsingBlockhash,
      appendTransactionMessageInstructions: kit.appendTransactionMessageInstructions,
      compileTransaction: kit.compileTransaction,
      getBase64EncodedWireTransaction: kit.getBase64EncodedWireTransaction,
      KaminoMarket: klend.KaminoMarket,
      KaminoAction: klend.KaminoAction,
      resolveLedgerInstantForSlot: klend.resolveLedgerInstantForSlot,
    }));
  }
  return sdkPromise;
}

export async function simulateKaminoWithdraw(body, { sdk, rpcUrl = process.env.SOLANA_RPC_URL || DEFAULT_RPC_URL, now = Date.now } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { status: 400, body: { error: 'Request must be a JSON object with wallet and amountUsdc' } };
  const { wallet, amountUsdc } = body;
  if (typeof wallet !== 'string' || !SOLANA_ADDRESS.test(wallet)) return { status: 400, body: { error: 'wallet must be a Solana address' } };
  if (typeof amountUsdc !== 'number' || !Number.isFinite(amountUsdc) || amountUsdc <= 0 || amountUsdc > MAX_USDC) {
    return { status: 400, body: { error: `amountUsdc must be a positive number up to ${MAX_USDC.toLocaleString('en-US')}` } };
  }
  const baseUnits = String(Math.round(amountUsdc * 1e6));
  const lib = sdk ?? (await loadSdk());
  try {
    const rpc = lib.createSolanaRpc(rpcUrl);
    const market = await lib.KaminoMarket.load(rpc, lib.address(KAMINO_MAIN_MARKET), 450);
    if (!market) return { status: 502, body: { error: 'Kamino market could not be loaded', ok: false } };
    const obligation = await market.getUserVanillaObligation(lib.address(wallet));
    if (!obligation) return { status: 404, body: { error: 'No Kamino obligation found for this wallet in the main market', ok: false } };
    const slot = await rpc.getSlot().send();
    const ledger = await lib.resolveLedgerInstantForSlot(rpc, slot, 'exitplan');
    const action = await lib.KaminoAction.buildWithdrawTxns({
      kaminoMarket: market,
      amount: baseUnits,
      reserveAddress: lib.address(USDC_RESERVE),
      owner: lib.createNoopSigner(lib.address(wallet)),
      obligation,
      useV2Ixs: true,
      scopeRefreshConfig: undefined,
      currentLedgerInstant: ledger,
      includeAtaIxs: true,
    });
    const instructions = [...action.computeBudgetIxs, ...action.setupIxs, ...action.lendingIxs, ...action.cleanupIxs];
    const labels = [...action.setupIxsLabels, ...action.lendingIxsLabels, ...action.cleanupIxsLabels];
    const { value: latest } = await rpc.getLatestBlockhash().send();
    const message = lib.pipe(
      lib.createTransactionMessage({ version: 0 }),
      (m) => lib.setTransactionMessageFeePayer(lib.address(wallet), m),
      (m) => lib.setTransactionMessageLifetimeUsingBlockhash(latest, m),
      (m) => lib.appendTransactionMessageInstructions(instructions, m),
    );
    const wire = lib.getBase64EncodedWireTransaction(lib.compileTransaction(message));
    const simulation = await rpc.simulateTransaction(wire, { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'processed' }).send();
    const err = simulation.value?.err ?? null;
    return {
      status: 200,
      body: {
        ok: err === null,
        error: err === null ? null : typeof err === 'string' ? err : JSON.stringify(err),
        unitsConsumed: simulation.value?.unitsConsumed == null ? null : Number(simulation.value.unitsConsumed),
        logCount: Array.isArray(simulation.value?.logs) ? simulation.value.logs.length : 0,
        instructions: labels,
        amountUsdc,
        observedAt: new Date(now()).toISOString(),
        rpc: new URL(rpcUrl).host,
        obligation: String(obligation.obligationAddress ?? ''),
      },
    };
  } catch (error) {
    if (/could not find vanilla obligation/i.test(String(error?.message || ''))) {
      return { status: 404, body: { error: 'No Kamino obligation found for this wallet in the main market', ok: false } };
    }
    console.error('kamino simulation failed', error?.name, String(error?.message || '').slice(0, 200));
    return { status: 502, body: { error: 'Kamino simulation is unavailable right now', ok: false } };
  }
}
