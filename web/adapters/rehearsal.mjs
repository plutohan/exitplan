/** Read-only rehearsal of the Solana sell leg: Jupiter quote → unsigned swap transaction → simulateTransaction. Never sends. */
import { AdapterError, decimal, record, requestJson, round6 } from './http.mjs';
import { isSolanaAddress, quoteSolToUsdc, rpc, LAMPORTS_PER_SOL } from './solana.mjs';

export { AdapterError };
export const JUPITER_SWAP_URL = 'https://lite-api.jup.ag/swap/v1/swap';
export const HL_INFO_URL = 'https://api.hyperliquid.xyz/info';

const bytesFromBase64 = (text) => { try { const bin = atob(text); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i); return out; } catch { return null; } };
const base64FromBytes = (bytes) => { let bin = ''; for (const byte of bytes) bin += String.fromCharCode(byte); return btoa(bin); };
/** The message bytes of a serialized transaction: a compact-u16 signature count, that many 64-byte signature slots, then the message. Null when the bytes do not fit that layout. */
export function messageFromTransaction(transactionBase64) {
  if (typeof transactionBase64 !== 'string' || !transactionBase64) return null;
  const bytes = bytesFromBase64(transactionBase64);
  if (!bytes || bytes.length < 2) return null;
  const count = bytes[0]; // a single compact-u16 byte below 128 covers every real transaction
  if (count === 0 || count >= 128) return null;
  const start = 1 + 64 * count;
  if (bytes.length <= start) return null;
  return base64FromBytes(bytes.subarray(start));
}
/** Solana Explorer's transaction inspector decodes an unsigned message, so a judge can read every instruction of what would be signed. */
export const inspectorUrl = (transactionBase64) => {
  const message = messageFromTransaction(transactionBase64);
  return message ? `https://explorer.solana.com/tx/inspector?message=${encodeURIComponent(message)}` : null;
};

/** Read-only preview of buying back SOL to reduce the short: walks the live asks of the public order book. Never places an order. */
/** Hyperliquid price rule for perps: at most 5 significant figures and at most (6 − szDecimals) decimals; rounded up for a buy so an IOC can fill. */
export function tickRoundUp(px, szDecimals) {
  const maxDecimals = Math.max(0, 6 - szDecimals);
  const decimals = Math.max(0, Math.min(maxDecimals, 4 - Math.floor(Math.log10(px))));
  const factor = 10 ** decimals;
  return { price: Math.ceil(px * factor - 1e-9) / factor, decimals };
}

export async function previewReduceShort({ quantity, assetIndex = null, szDecimals = 2, markPrice = null, slippageCapBps = 50, fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 8000 }) {
  if (!Number.isFinite(quantity) || quantity <= 0) throw new AdapterError('INVALID_AMOUNT', 'Quantity must be a positive number of SOL');
  const sizeFactor = 10 ** szDecimals;
  const size = Math.floor(quantity * sizeFactor + 1e-9) / sizeFactor; // what the exchange would accept
  if (size <= 0) throw new AdapterError('INVALID_AMOUNT', `Quantity is below one lot of ${1 / sizeFactor} SOL`);
  const book = record(await requestJson(HL_INFO_URL, { method: 'POST', fetchImpl, timeoutMs, body: { type: 'l2Book', coin: 'SOL' } }), 'l2Book');
  if (!Array.isArray(book.levels) || book.levels.length < 2 || !Array.isArray(book.levels[0]) || !Array.isArray(book.levels[1])) throw new AdapterError('INVALID_RESPONSE', 'l2Book levels are missing');
  const level = (entry, label) => ({ px: decimal(entry?.px, `${label} price`), sz: decimal(entry?.sz, `${label} size`) });
  const bids = book.levels[0].map((entry, i) => level(entry, `bid ${i}`));
  const asks = book.levels[1].map((entry, i) => level(entry, `ask ${i}`));
  if (!asks.length || !bids.length) throw new AdapterError('INVALID_RESPONSE', 'The SOL order book is empty');
  let remaining = size, cost = 0, levelsUsed = 0, worstPrice = asks[0].px;
  for (const { px, sz } of asks) {
    const take = Math.min(remaining, sz);
    cost += take * px; remaining -= take; levelsUsed += 1; worstPrice = px;
    if (remaining <= 1e-9) { remaining = 0; break; }
  }
  const filled = round6(size - remaining);
  const averagePrice = filled > 0 ? Math.round((cost / filled) * 10_000) / 10_000 : null;
  const bestAsk = asks[0].px, bestBid = bids[0].px;
  const { price: limitPrice, decimals } = tickRoundUp(worstPrice * (1 + slippageCapBps / 10_000), szDecimals);
  const bookTime = Number(book.time) || null;
  const bookAgeSeconds = bookTime ? Math.max(0, Math.round((now() - bookTime) / 1000)) : null;
  // The order the user would sign, in the exchange's own wire shape: buy, reduce-only, immediate-or-cancel. Built, never sent.
  const canonical = (value) => String(Number(value)); // Hyperliquid signing rules: no trailing zeros, no exponent at these magnitudes
  const stale = bookAgeSeconds == null || bookAgeSeconds > 10;
  const orderNote = !Number.isInteger(assetIndex) || assetIndex < 0 ? 'asset index unavailable, order not built' : stale ? `book is ${bookAgeSeconds == null ? 'undated' : `stale (${bookAgeSeconds}s old)`}; run the preview again before signing` : size * limitPrice < 10 ? `below the $10 minimum order at the limit price ($${(size * limitPrice).toFixed(2)})` : null;
  const order = orderNote ? null : { a: assetIndex, b: true, p: canonical(limitPrice.toFixed(decimals)), s: canonical(size), r: true, t: { limit: { tif: 'Ioc' } } };
  return {
    ok: true, quantity, size, sizeSnapped: size !== quantity, filled, partial: remaining > 0, averagePrice, bestAsk, bestBid,
    mid: Math.round(((bestAsk + bestBid) / 2) * 10_000) / 10_000,
    slippageBps: averagePrice == null ? null : Math.round(((averagePrice - bestAsk) / bestAsk) * 10_000 * 10) / 10,
    slippageVsMarkBps: averagePrice == null || markPrice == null ? null : Math.round(((averagePrice - markPrice) / markPrice) * 10_000 * 10) / 10,
    costVsPlan: averagePrice == null || markPrice == null ? null : Math.round((averagePrice - markPrice) * filled * 100) / 100,
    levelsUsed, visibleDepth: round6(asks.reduce((sum, l) => sum + l.sz, 0)), bookTime, bookAgeSeconds, stale,
    limitPrice, slippageCapBps, order, orderNote,
  };
}

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
    transactionBase64: swap.swapTransaction,
    inspectorUrl: inspectorUrl(swap.swapTransaction),
  };
}

/** Read-only Kamino withdrawal rehearsal through the same-origin server function (the SDK runs there). */
export async function simulateKaminoWithdraw({ address, amountUsdc, fetchImpl = globalThis.fetch, timeoutMs = 45000 }) {
  if (!isSolanaAddress(address)) throw new AdapterError('INVALID_ADDRESS', 'A Solana wallet address is required to build the unsigned transaction');
  if (typeof amountUsdc !== 'number' || !Number.isFinite(amountUsdc) || amountUsdc <= 0) throw new AdapterError('INVALID_AMOUNT', 'Withdrawal amount must be a positive USDC amount');
  let response;
  try {
    response = await fetchImpl('/api/kamino-withdraw', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ wallet: address, amountUsdc }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new AdapterError('NETWORK_ERROR', 'The simulation service could not be reached', { cause: error });
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new AdapterError(response.status === 404 ? 'NO_OBLIGATION' : 'HTTP_ERROR', data.error || `Simulation service returned HTTP ${response.status}`);
  return {
    ok: data.ok === true,
    error: data.error ?? null,
    unitsConsumed: data.unitsConsumed ?? null,
    logCount: data.logCount ?? 0,
    instructions: Array.isArray(data.instructions) ? data.instructions.map(String) : [],
    amountUsdc: data.amountUsdc,
    deliveredUsdc: typeof data.deliveredUsdc === 'number' ? data.deliveredUsdc : null,
    observedAt: data.observedAt ?? null,
    transactionBase64: typeof data.transactionBase64 === 'string' ? data.transactionBase64 : null,
    inspectorUrl: typeof data.transactionBase64 === 'string' ? inspectorUrl(data.transactionBase64) : null,
  };
}
