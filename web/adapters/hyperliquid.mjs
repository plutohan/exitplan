/** Read-only Hyperliquid import: public info API only, no address discovery, no signing. */
import { requiredMarginCents } from '../engine.mjs';
import { AdapterError, decimal, record, requestJson, round2, round6 } from './http.mjs';

export { AdapterError };
export const HL_INFO_URL = 'https://api.hyperliquid.xyz/info';
export const HL_RESERVE_RATE = 0.1;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export async function importHyperliquid(address, { fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 8000 } = {}) {
  if (typeof address !== 'string' || !ADDRESS.test(address)) throw new AdapterError('INVALID_ADDRESS', 'Enter a Hyperliquid address: 0x followed by 40 hex characters');
  const options = { method: 'POST', fetchImpl, timeoutMs };
  const [state, mids] = await Promise.all([
    requestJson(HL_INFO_URL, { ...options, body: { type: 'clearinghouseState', user: address } }),
    requestJson(HL_INFO_URL, { ...options, body: { type: 'allMids' } }),
  ]);
  record(state, 'clearinghouseState');
  record(mids, 'allMids');
  const summary = record(state.marginSummary, 'marginSummary');
  const accountValue = decimal(summary.accountValue, 'accountValue');
  const withdrawable = decimal(state.withdrawable, 'withdrawable');
  if (!Array.isArray(state.assetPositions)) throw new AdapterError('INVALID_RESPONSE', 'assetPositions is missing');
  if (!Object.hasOwn(mids, 'SOL')) throw new AdapterError('INVALID_RESPONSE', 'SOL mid price is missing');
  const markPrice = round2(decimal(mids.SOL, 'SOL mid'));
  if (markPrice <= 0) throw new AdapterError('INVALID_RESPONSE', 'SOL mid price must be positive');

  const positions = state.assetPositions.map((asset, index) => record(record(asset, `assetPositions[${index}]`).position, `assetPositions[${index}].position`));
  const sol = positions.find(position => position.coin === 'SOL');
  let shortSol = 0;
  let solReport = { entryPrice: null, liquidationPrice: null, leverage: null, solMarginUsed: 0 };
  if (sol) {
    const size = decimal(sol.szi, 'SOL size');
    if (size > 0) throw new AdapterError('UNSUPPORTED_POSITION', 'This account is long SOL; the planner models a SOL short hedge');
    const leverage = record(sol.leverage, 'SOL leverage');
    if (leverage.type !== 'cross') throw new AdapterError('ISOLATED_MARGIN', 'Isolated-margin SOL positions are not supported');
    shortSol = round6(-size);
    solReport = {
      entryPrice: sol.entryPx == null ? null : decimal(sol.entryPx, 'SOL entry price'),
      liquidationPrice: sol.liquidationPx == null ? null : decimal(sol.liquidationPx, 'SOL liquidation price'),
      leverage: decimal(leverage.value, 'SOL leverage'),
      solMarginUsed: decimal(sol.marginUsed, 'SOL margin used'),
    };
  }
  const otherPositions = positions.filter(position => position.coin !== 'SOL').map(position => ({
    coin: String(position.coin),
    size: decimal(position.szi, `${position.coin} size`),
    marginUsed: decimal(position.marginUsed, `${position.coin} margin used`),
  }));
  const locked = otherPositions.reduce((sum, position) => sum + position.marginUsed, 0);
  const collateral = round2(accountValue - locked);
  const collateralCents = Math.round(collateral * 100);
  const required = requiredMarginCents(shortSol, markPrice, HL_RESERVE_RATE);
  if (collateral < 0 || required > collateralCents) {
    throw new AdapterError('LEVERAGE_TOO_HIGH', `Equity after other positions' margin ($${collateral.toFixed(2)}) is below the 10% reserve for the SOL short; the planner does not model this leverage`);
  }
  const freeWithdrawable = Math.max(0, Math.min(round2(withdrawable), (collateralCents - required) / 100));
  return {
    evidence: 'imported',
    venue: 'hyperliquid',
    address,
    observedAt: new Date(now()).toISOString(),
    source: 'Hyperliquid public info API',
    state: { accountMode: 'standard', marginMode: 'cross', asset: 'SOL', shortSol, markPrice, collateral, conservativeMarginRate: HL_RESERVE_RATE, freeWithdrawable },
    reported: { accountValue, withdrawable, marginUsed: decimal(summary.totalMarginUsed ?? 0, 'totalMarginUsed'), ...solReport, otherPositions },
    assumptions: [
      'Standard account assumed; the public API does not verify the account mode',
      'Reserve is 10% of short notional, a model assumption, not the exchange maintenance margin',
      'Margin used by other open positions is treated as locked and deducted from equity',
    ],
  };
}
