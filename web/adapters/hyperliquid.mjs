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
  const [state, mids, abstraction, vault, spot, fundingHistory] = await Promise.all([
    requestJson(HL_INFO_URL, { ...options, body: { type: 'clearinghouseState', user: address } }),
    requestJson(HL_INFO_URL, { ...options, body: { type: 'allMids' } }),
    requestJson(HL_INFO_URL, { ...options, body: { type: 'userAbstraction', user: address } }),
    requestJson(HL_INFO_URL, { ...options, body: { type: 'vaultDetails', vaultAddress: address } }),
    requestJson(HL_INFO_URL, { ...options, body: { type: 'spotClearinghouseState', user: address } }),
    // Carry input only: a failed funding read degrades to 'unknown' instead of failing the import.
    requestJson(HL_INFO_URL, { ...options, body: { type: 'fundingHistory', coin: 'SOL', startTime: now() - 7 * 86_400_000 } }).catch(() => undefined),
  ]);
  if (vault && typeof vault === 'object') {
    throw new AdapterError('VAULT_ADDRESS', `This address is a Hyperliquid vault (${String(vault.name ?? 'unnamed')}), not a user account; enter the address that holds your positions`);
  }
  const accountMode = typeof abstraction === 'string' ? abstraction : null;
  const unified = accountMode === 'unifiedAccount';
  if (accountMode !== 'disabled' && accountMode !== 'default' && !unified) {
    const where = accountMode === 'portfolioMargin' ? 'portfolio margin pools several collateral assets, which this planner does not model' : 'this abstraction mode is not modelled';
    throw new AdapterError('UNSUPPORTED_ACCOUNT_MODE', `Hyperliquid account mode "${accountMode ?? 'unknown'}" is not supported: ${where}. Standard and Unified accounts are supported`);
  }
  record(state, 'clearinghouseState');
  record(mids, 'allMids');
  const summary = record(state.marginSummary, 'marginSummary');
  const perpsAccountValue = decimal(summary.accountValue, 'accountValue');
  const perpsWithdrawable = decimal(state.withdrawable, 'withdrawable');
  // Spot USDC: separate from perps on a standard account; backs the perps on a unified account (hold = margin in use).
  const spotBalances = spot && Array.isArray(spot.balances) ? spot.balances : [];
  const usdcEntry = spotBalances.find((b) => b && b.coin === 'USDC');
  const spotUsdc = { total: usdcEntry ? decimal(usdcEntry.total, 'spot USDC total') : 0, hold: usdcEntry ? decimal(usdcEntry.hold ?? 0, 'spot USDC hold') : 0 };
  // Unified: the spot USDC total already contains the perps equity (margin plus unrealised PnL); `hold` is the part the
  // exchange keeps back (perps equity minus perps withdrawable, plus holds for open spot orders). Equity = total minus any
  // hold that is not explained by the perps; withdrawable = total minus hold. Both are the exchange's own figures.
  const perpsHeld = Math.max(0, perpsAccountValue - perpsWithdrawable);
  const residualHold = unified ? Math.max(0, spotUsdc.hold - perpsHeld) : 0;
  const accountValue = unified ? spotUsdc.total - residualHold : perpsAccountValue;
  const withdrawable = unified ? round2(Math.max(0, spotUsdc.total - spotUsdc.hold)) : perpsWithdrawable;
  if (unified && Array.isArray(spot?.tokenToAvailableAfterMaintenance) && state.crossMaintenanceMarginUsed != null) {
    const entry = spot.tokenToAvailableAfterMaintenance.find((e) => Array.isArray(e) && e[0] === 0);
    if (entry) {
      const available = decimal(entry[1], 'USDC available after maintenance');
      const maintenance = decimal(state.crossMaintenanceMarginUsed, 'crossMaintenanceMarginUsed');
      const implied = spotUsdc.total - maintenance;
      if (Math.abs(implied - available) > 1) throw new AdapterError('INVALID_RESPONSE', `Unified account cross-check failed: spot USDC total minus cross maintenance margin ($${round2(implied).toFixed(2)}) does not match the exchange's available-after-maintenance figure ($${round2(available).toFixed(2)}); the equity model does not fit this account`);
    }
  }
  const otherStables = spotBalances.filter((b) => b && ['USDT0', 'USDT', 'USDH', 'USDE', 'USDC.e'].includes(b.coin) && Number(b.total) > 0).map((b) => ({ coin: String(b.coin), total: decimal(b.total, `${b.coin} total`) }));
  const spotSolEntry = spotBalances.find((b) => b && b.coin === 'USOL');
  const spotSol = spotSolEntry ? decimal(spotSolEntry.total, 'USOL total') : 0;
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
  // The exchange's transfer rule keeps max(initial margin, 10% of notional) per position; locking that for the other
  // positions makes the model's free collateral match the exchange's reported withdrawable on real accounts.
  const otherPositions = positions.filter(position => position.coin !== 'SOL').map(position => {
    const marginUsed = decimal(position.marginUsed, `${position.coin} margin used`);
    const notional = position.positionValue == null ? null : Math.abs(decimal(position.positionValue, `${position.coin} position value`));
    return {
      coin: String(position.coin),
      size: decimal(position.szi, `${position.coin} size`),
      marginUsed,
      notional,
      lockedMargin: round2(Math.max(marginUsed, notional == null ? 0 : notional * HL_RESERVE_RATE)),
    };
  });
  const locked = round2(otherPositions.reduce((sum, position) => sum + position.lockedMargin, 0));
  const collateral = round2(accountValue - locked);
  const collateralCents = Math.round(collateral * 100);
  const required = requiredMarginCents(shortSol, markPrice, HL_RESERVE_RATE);
  if (collateral < 0 || required > collateralCents) {
    throw new AdapterError('LEVERAGE_TOO_HIGH', `Equity after other positions' margin ($${collateral.toFixed(2)}) is below the 10% reserve for the SOL short; the planner does not model this leverage`);
  }
  const modelHeadroom = (collateralCents - required) / 100;
  const freeWithdrawable = Math.max(0, Math.min(round2(withdrawable), modelHeadroom));
  let funding = null;
  if (Array.isArray(fundingHistory) && fundingHistory.length) {
    const rates = fundingHistory.map((entry) => Number(entry && entry.fundingRate));
    if (rates.every((rate) => Number.isFinite(rate))) {
      const hourlyMean = rates.reduce((sum, rate) => sum + rate, 0) / rates.length;
      funding = { samples: rates.length, hourlyMean: Math.round(hourlyMean * 1e10) / 1e10, apr: round6(hourlyMean * 24 * 365) };
    }
  }
  const fundingApr = funding ? funding.apr : null;
  const assumptions = [
    unified
      ? 'Unified account verified on HyperCore: the spot USDC total is the account equity (it already contains the perps margin and unrealised PnL); withdrawable is spot USDC total minus hold, both exchange figures'
      : accountMode === 'disabled' ? 'Account mode verified on HyperCore: standard (abstraction disabled)' : 'Account mode reported as "default" on HyperCore (no abstraction chosen); treated as a standard account',
    'Reserve is 10% of short notional, a model assumption, not the exchange maintenance margin',
    "Other open positions lock the larger of their initial margin and 10% of their notional (the exchange's transfer rule), deducted from equity",
  ];
  assumptions.push(funding ? `Carry uses the 7-day average SOL funding, ${(funding.apr * 100).toFixed(2)}% per year over ${funding.samples} hourly samples (positive means longs pay shorts); it is an estimate at today's rates` : 'SOL funding history unavailable at load; carry on the short is unknown');
  if (otherStables.length) assumptions.push(`Other stable collateral on HyperCore spot (${otherStables.map((s) => `${s.coin} ${s.total.toLocaleString('en-US', { maximumFractionDigits: 2 })}`).join(', ')}) is not modelled`);
  if (spotSol > 0) assumptions.push(`HyperCore spot holds ${spotSol} USOL; it is not counted as Solana spot SOL`);
  if (round2(withdrawable) < modelHeadroom) assumptions.push(`The exchange reported $${round2(withdrawable).toFixed(2)} withdrawable at load; collateral released by reducing the short is a model estimate, not an exchange quote`);
  return {
    evidence: 'imported',
    venue: 'hyperliquid',
    address,
    observedAt: new Date(now()).toISOString(),
    source: 'Hyperliquid public info API',
    state: { accountMode: unified ? 'unified' : 'standard', marginMode: 'cross', asset: 'SOL', shortSol, markPrice, collateral, conservativeMarginRate: HL_RESERVE_RATE, freeWithdrawable, fundingApr },
    reported: { accountMode, accountValue: round2(accountValue), withdrawable, spotUsdc, lockedMargin: locked, otherStables, spotSol, funding, marginUsed: decimal(summary.totalMarginUsed ?? 0, 'totalMarginUsed'), ...solReport, otherPositions },
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
