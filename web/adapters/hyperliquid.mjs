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
  const [state, mids, abstraction] = await Promise.all([
    requestJson(HL_INFO_URL, { ...options, body: { type: 'clearinghouseState', user: address } }),
    requestJson(HL_INFO_URL, { ...options, body: { type: 'allMids' } }),
    requestJson(HL_INFO_URL, { ...options, body: { type: 'userAbstraction', user: address } }),
  ]);
  const accountMode = typeof abstraction === 'string' ? abstraction : null;
  if (accountMode !== 'disabled' && accountMode !== 'default') {
    const where = accountMode === 'unifiedAccount' || accountMode === 'portfolioMargin' ? 'unified and portfolio-margin accounts keep USDC in the spot balance, which this planner does not read' : 'this abstraction mode is not modelled';
    throw new AdapterError('UNSUPPORTED_ACCOUNT_MODE', `Hyperliquid account mode "${accountMode ?? 'unknown'}" is not supported: ${where}. ExitPlan plans Standard accounts today (abstraction disabled or default); Unified is next`);
  }
  record(state, 'clearinghouseState');
  record(mids, 'allMids');
  const summary = record(state.marginSummary, 'marginSummary');
  const accountValue = decimal(summary.accountValue, 'accountValue');
  const withdrawable = decimal(state.withdrawable, 'withdrawable');
  if (!Array.isArray(state.assetPositions)) throw new AdapterError('INVALID_RESPONSE', 'assetPositions is missing');
  if (!Object.hasOwn(mids, 'SOL')) throw new AdapterError('INVALID_RESPONSE', 'SOL mid price is missing');
  let markPrice = round2(decimal(mids.SOL, 'SOL mid'));
  if (markPrice <= 0) throw new AdapterError('INVALID_RESPONSE', 'SOL mid price must be positive');

  const positions = state.assetPositions.map((asset, index) => record(record(asset, `assetPositions[${index}]`).position, `assetPositions[${index}].position`));
  const sol = positions.find(position => position.coin === 'SOL');
  let shortSol = 0;
  let solReport = { entryPrice: null, liquidationPrice: null, leverage: null, maxLeverage: null, solMarginUsed: 0 };
  if (sol) {
    const size = decimal(sol.szi, 'SOL size');
    if (size > 0) throw new AdapterError('UNSUPPORTED_POSITION', 'This account is long SOL; the planner models a SOL short hedge');
    const leverage = record(sol.leverage, 'SOL leverage');
    if (leverage.type !== 'cross') throw new AdapterError('ISOLATED_MARGIN', 'Isolated-margin SOL positions are not supported');
    shortSol = round6(-size);
    // The exchange marks the position at positionValue / |size|; using it keeps the model's numbers equal to the exchange's own.
    if (sol.positionValue != null && size !== 0) { const marked = round2(decimal(sol.positionValue, 'SOL position value') / Math.abs(size)); if (marked > 0) markPrice = marked; }
    solReport = {
      entryPrice: sol.entryPx == null ? null : decimal(sol.entryPx, 'SOL entry price'),
      liquidationPrice: sol.liquidationPx == null ? null : decimal(sol.liquidationPx, 'SOL liquidation price'),
      leverage: decimal(leverage.value, 'SOL leverage'),
      maxLeverage: Number.isFinite(Number(sol.maxLeverage)) && Number(sol.maxLeverage) > 0 ? Number(sol.maxLeverage) : null,
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
  const modelHeadroom = (collateralCents - required) / 100;
  const freeWithdrawable = Math.max(0, Math.min(round2(withdrawable), modelHeadroom));
  const assumptions = [
    accountMode === 'disabled' ? 'Account mode verified on HyperCore: standard (abstraction disabled)' : 'Account mode reported as "default" on HyperCore (no abstraction chosen); treated as a standard account',
    'Reserve is 10% of short notional, a model assumption, not the exchange maintenance margin',
    'Margin used by other open positions is treated as locked and deducted from equity',
  ];
  if (round2(withdrawable) < modelHeadroom) assumptions.push(`The exchange reported $${round2(withdrawable).toFixed(2)} withdrawable at load; collateral released by reducing the short is a model estimate, not an exchange quote`);
  return {
    evidence: 'imported',
    venue: 'hyperliquid',
    address,
    observedAt: new Date(now()).toISOString(),
    source: 'Hyperliquid public info API',
    state: { accountMode: 'standard', marginMode: 'cross', asset: 'SOL', shortSol, markPrice, collateral, conservativeMarginRate: HL_RESERVE_RATE, freeWithdrawable },
    reported: { accountMode, accountValue, withdrawable, marginUsed: decimal(summary.totalMarginUsed ?? 0, 'totalMarginUsed'), ...solReport, otherPositions },
    assumptions,
  };
}

/**
 * Liquidation price after a route, anchored on the exchange's own liquidation price at load.
 * Model: equity above maintenance at the current mark is (liq − mark)·S·(1+mmr) for a short of S SOL,
 * with mmr = 1 / (2 × max leverage). Withdrawing W and paying fees lower it; closing q SOL frees mmr·q·mark.
 * This is an estimate; the exchange recomputes after execution and other positions move the real number.
 */
export function estimateLiquidationAfter({ liquidationPrice, markPrice, shortSol, maxLeverage, withdraw = 0, closeQty = 0, closeFee = 0 }) {
  const values = [liquidationPrice, markPrice, shortSol, maxLeverage, withdraw, closeQty, closeFee];
  if (values.some(value => typeof value !== 'number' || !Number.isFinite(value))) return null;
  if (maxLeverage <= 0 || markPrice <= 0) return null;
  const remaining = shortSol - closeQty;
  if (remaining <= 1e-9) return null;
  const mmr = 1 / (2 * maxLeverage);
  const available = (liquidationPrice - markPrice) * shortSol * (1 + mmr);
  const availableAfter = available - withdraw - closeFee + mmr * closeQty * markPrice;
  return round2(markPrice + availableAfter / (remaining * (1 + mmr)));
}
