/** Read-only Solana import: public RPC balance, Kamino main-market obligations, Jupiter reference quote. No signing. */
import { AdapterError, decimal, record, requestJson, round2, round6 } from './http.mjs';

export { AdapterError };
export const SOLANA_RPC_URL = 'https://solana-rpc.publicnode.com';
export const KAMINO_API_URL = 'https://api.kamino.finance';
export const KAMINO_MAIN_MARKET = '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF';
export const USDC_RESERVE = 'D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59';
export const SOL_RESERVE = 'd4A2prbA2whesmvHaL88BH6Ewn5N4bTSU2Ze8P6Bc4Q';
export const JUPITER_QUOTE_URL = 'https://lite-api.jup.ag/swap/v1/quote';
export const JUPITER_BALANCES_URL = 'https://lite-api.jup.ag/ultra/v1/balances';
export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const LAMPORTS_PER_SOL = 1_000_000_000;
export const BORROW_LTV = 0.3;
const EMPTY_RESERVE = '11111111111111111111111111111111';
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const isSolanaAddress = value => typeof value === 'string' && ADDRESS.test(value);

/** Model fee for the SOL sale leg: 50 bps slippage allowance plus quoted price impact, never below the 30 bps fixture. */
export function solSaleBpsFromQuote(quote) {
  const impact = decimal(quote?.priceImpactPct ?? 0, 'priceImpactPct');
  return Math.max(30, 50 + Math.round(impact * 10_000));
}

export async function rpc(method, params, { fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  const payload = record(await requestJson(SOLANA_RPC_URL, { method: 'POST', body: { jsonrpc: '2.0', id: 1, method, params }, fetchImpl, timeoutMs }), 'RPC response');
  if (payload.error) throw new AdapterError('HTTP_ERROR', `Solana RPC error: ${payload.error.message ?? 'unknown'}`);
  return payload.result;
}

export async function quoteSolToUsdc(lamports, { fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  const url = `${JUPITER_QUOTE_URL}?inputMint=${SOL_MINT}&outputMint=${USDC_MINT}&amount=${lamports}&slippageBps=50`;
  const quote = record(await requestJson(url, { fetchImpl, timeoutMs }), 'Jupiter quote');
  const outAmount = decimal(quote.outAmount, 'Jupiter outAmount');
  if (outAmount <= 0) throw new AdapterError('INVALID_RESPONSE', 'Jupiter quote returned no output amount');
  return { quote, outAmount };
}

export async function importSolana(address, { fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 8000 } = {}) {
  if (!isSolanaAddress(address)) throw new AdapterError('INVALID_ADDRESS', 'Enter a Solana wallet address (base58, 32–44 characters)');
  const options = { fetchImpl, timeoutMs };
  const [balance, obligations, { quote, outAmount }, balances] = await Promise.all([
    rpc('getBalance', [address], options),
    requestJson(`${KAMINO_API_URL}/kamino-market/${KAMINO_MAIN_MARKET}/users/${address}/obligations`, options),
    quoteSolToUsdc(LAMPORTS_PER_SOL, options),
    requestJson(`${JUPITER_BALANCES_URL}/${address}`, options),
  ]);
  record(balances, 'Jupiter balances');
  const usdcEntry = balances[USDC_MINT];
  const walletUsdc = usdcEntry === undefined ? 0 : round2(decimal(record(usdcEntry, 'USDC balance').uiAmount, 'USDC uiAmount'));
  const lamports = decimal(record(balance, 'getBalance result').value, 'lamports');
  const sol = round6(lamports / LAMPORTS_PER_SOL);
  if (!Array.isArray(obligations)) throw new AdapterError('INVALID_RESPONSE', 'Kamino obligations must be an array');
  let usdc = 0;
  let debt = 0;
  const reports = [];
  for (const [index, obligation] of obligations.entries()) {
    record(obligation, `obligation[${index}]`);
    const state = record(obligation.state, `obligation[${index}].state`);
    const stats = record(obligation.refreshedStats, `obligation[${index}].refreshedStats`);
    if (!Array.isArray(state.deposits) || !Array.isArray(state.borrows)) throw new AdapterError('INVALID_RESPONSE', `obligation[${index}] is missing its deposit or borrow lists`);
    const deposits = state.deposits.filter(entry => entry && entry.depositReserve !== EMPTY_RESERVE);
    const borrows = state.borrows.filter(entry => entry && entry.borrowReserve !== EMPTY_RESERVE);
    if (deposits.some(entry => entry.depositReserve !== USDC_RESERVE)) {
      throw new AdapterError('UNSUPPORTED_OBLIGATION', 'Kamino obligations holding assets other than USDC are not supported by this model');
    }
    const totalBorrow = decimal(stats.userTotalBorrow ?? 0, 'userTotalBorrow');
    if (borrows.length > 0 || totalBorrow > 0) debt += Math.max(totalBorrow, 0.01);
    const totalDeposit = decimal(stats.userTotalDeposit ?? 0, 'userTotalDeposit');
    if (totalDeposit > 0 && deposits.length === 0) throw new AdapterError('INVALID_RESPONSE', `obligation[${index}] reports a deposit total without deposit entries`);
    usdc += totalDeposit;
    reports.push({ address: String(obligation.obligationAddress ?? ''), deposits: deposits.length, borrows: borrows.length });
  }
  usdc = round2(usdc);
  debt = round2(debt);
  const solPrice = round2(outAmount / 1e6);
  return {
    evidence: 'imported',
    venue: 'solana',
    address,
    observedAt: new Date(now()).toISOString(),
    state: {
      sol,
      solPrice,
      lending: { usdc, debt, withdrawCapacity: usdc },
      wallet: { usdc: walletUsdc },
      borrow: { enabled: true, capacity: round2(sol * solPrice * BORROW_LTV), maxLtv: BORROW_LTV },
    },
    quote: { outUsdcPerSol: outAmount / 1e6, priceImpactPct: String(quote.priceImpactPct ?? '0'), solSaleBps: solSaleBpsFromQuote(quote) },
    reported: { lamports, obligations: reports },
    sources: ['publicnode RPC getBalance', 'Kamino main-market obligations API', 'Jupiter quote for 1 SOL → USDC', 'Jupiter wallet token balances (USDC in the wallet)'],
    assumptions: [
      'Withdraw capacity equals supplied USDC; reserve utilisation is not checked',
      'Borrow capacity is 30% of SOL value, a model rule, not a Kamino quote',
      'SOL price is the Jupiter output for 1 SOL; larger sales are priced by the fee rule, not re-quoted',
    ],
  };
}
