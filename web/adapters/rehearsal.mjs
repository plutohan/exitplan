/** Read-only rehearsal of the Solana sell leg: Jupiter quote → unsigned swap transaction → simulateTransaction. Never sends. */
import { AdapterError, record, requestJson } from './http.mjs';
import { isSolanaAddress, quoteSolToUsdc, rpc, LAMPORTS_PER_SOL } from './solana.mjs';

export { AdapterError };
export const JUPITER_SWAP_URL = 'https://lite-api.jup.ag/swap/v1/swap';

export async function simulateSellSol({ address, solAmount, fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 8000 }) {
  if (!isSolanaAddress(address)) throw new AdapterError('INVALID_ADDRESS', 'A Solana wallet address is required to build the unsigned transaction');
  if (typeof solAmount !== 'number' || !Number.isFinite(solAmount) || solAmount <= 0) throw new AdapterError('INVALID_AMOUNT', 'Sell amount must be a positive SOL quantity');
  const lamports = Math.round(solAmount * LAMPORTS_PER_SOL);
  const options = { fetchImpl, timeoutMs };
  const { quote, outAmount } = await quoteSolToUsdc(lamports, options);
  const swap = record(await requestJson(JUPITER_SWAP_URL, { method: 'POST', body: { quoteResponse: quote, userPublicKey: address, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true }, ...options }), 'Jupiter swap');
  if (typeof swap.swapTransaction !== 'string' || swap.swapTransaction === '') throw new AdapterError('INVALID_RESPONSE', 'Jupiter did not return a transaction to simulate');
  const result = record(await rpc('simulateTransaction', [swap.swapTransaction, { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'processed' }], options), 'simulateTransaction result');
  const value = record(result.value, 'simulateTransaction value');
  const err = value.err ?? null;
  const units = Number(value.unitsConsumed);
  return {
    ok: err === null,
    error: err === null ? null : typeof err === 'string' ? err : JSON.stringify(err),
    unitsConsumed: Number.isFinite(units) ? units : null,
    logCount: Array.isArray(value.logs) ? value.logs.length : 0,
    quotedUsdc: outAmount / 1e6,
    lamports,
    observedAt: new Date(now()).toISOString(),
    calls: ['quote', 'swap', 'simulateTransaction'],
  };
}
