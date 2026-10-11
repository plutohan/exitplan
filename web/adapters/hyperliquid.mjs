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
  const [state, mids, abstraction, vault, spot, fundingHistory, userFees, meta] = await Promise.all([
    requestJson(HL_INFO_URL, { ...options, body: { type: 'clearinghouseState', user: address } }),
    requestJson(HL_INFO_URL, { ...options, body: { type: 'allMids' } }),
    requestJson(HL_INFO_URL, { ...options, body: { type: 'userAbstraction', user: address } }),
    requestJson(HL_INFO_URL, { ...options, body: { type: 'vaultDetails', vaultAddress: address } }),
    // Informational for a standard account, required for a unified one (checked below); a failed read must not blank a standard import.
    requestJson(HL_INFO_URL, { ...options, body: { type: 'spotClearinghouseState', user: address } }).catch(() => undefined),
    // Carry input only: a failed funding read degrades to 'unknown' instead of failing the import.
    requestJson(HL_INFO_URL, { ...options, body: { type: 'fundingHistory', coin: 'SOL', startTime: now() - 7 * 86_400_000 } }).catch(() => undefined),
    // Fee input only: the account's own taker rate; a failed read falls back to the 5 bps model fee.
    requestJson(HL_INFO_URL, { ...options, body: { type: 'userFees', user: address } }).catch(() => undefined),
    // Order constraints: SOL lot size (szDecimals) and asset index; a failed read falls back to the known 0.01 SOL lot.
    requestJson(HL_INFO_URL, { ...options, body: { type: 'meta' } }).catch(() => undefined),
  ]);
  if (vault && typeof vault === 'object') {
    throw new AdapterError('VAULT_ADDRESS', `This address is a Hyperliquid vault (${String(vault.name ?? 'unnamed')}), not a user account; enter the address that holds your positions`);
  }
  const accountMode = typeof abstraction === 'string' ? abstraction : null;
  const declaredMode = accountMode === 'disabled' ? 'standard' : accountMode === 'unifiedAccount' ? 'unified' : null;
  let unified = declaredMode === 'unified';
  if (accountMode !== 'disabled' && accountMode !== 'default' && !unified) {
    const where = accountMode === 'portfolioMargin' ? 'portfolio margin pools several collateral assets, which this planner does not model' : 'this abstraction mode is not modelled';
    throw new AdapterError('UNSUPPORTED_ACCOUNT_MODE', `Hyperliquid account mode "${accountMode ?? 'unknown'}" is not supported: ${where}. Standard and Unified accounts are supported`);
  }
  record(state, 'clearinghouseState');
  record(mids, 'allMids');
  const summary = record(state.marginSummary, 'marginSummary');
  const perpsAccountValue = decimal(summary.accountValue, 'accountValue');
  const perpsWithdrawable = decimal(state.withdrawable, 'withdrawable');
  // Unified: the spot USDC total is the account equity (it already contains the perps margin and unrealised PnL); `hold`
  // only reduces what is withdrawable (perps margin plus holds for open spot orders). Both are the exchange's own figures.
  const spotBalances = spot && Array.isArray(spot.balances) ? spot.balances : [];
  const usdcEntry = spotBalances.find((b) => b && b.coin === 'USDC');
  const spotUsdc = { total: usdcEntry ? decimal(usdcEntry.total, 'spot USDC total') : 0, hold: usdcEntry ? decimal(usdcEntry.hold ?? 0, 'spot USDC hold') : 0 };
  if (spotUsdc.total < 0 || spotUsdc.hold < 0) throw new AdapterError('INVALID_RESPONSE', 'Spot USDC total and hold must be non-negative');
  if (spotUsdc.hold > spotUsdc.total + 1e-6) throw new AdapterError('INVALID_RESPONSE', `Spot USDC hold ($${spotUsdc.hold.toFixed(2)}) exceeds the total ($${spotUsdc.total.toFixed(2)}); the balances do not fit the model`);
  // A "default" abstraction setting is not a verified mode: establish it from the balances. In the unified layout the spot
  // total contains the perps equity and the hold equals perps equity minus perps withdrawable; a standard account keeps them apart.
  const perpsHeld = Math.max(0, perpsAccountValue - perpsWithdrawable); // margin actually in use; without it the two layouts cannot be told apart
  const holdMatches = Math.abs(spotUsdc.hold - perpsHeld) <= Math.max(1, spotUsdc.total * 0.0001);
  const layoutUnified = Boolean(usdcEntry) && perpsHeld > 1 && holdMatches && spotUsdc.total >= perpsAccountValue - 1;
  const layoutStandard = perpsAccountValue > 0 && (!usdcEntry || spotUsdc.total < perpsAccountValue - 1 || (perpsHeld > 1 && !holdMatches));
  const effectiveMode = declaredMode ?? (layoutUnified ? 'unified' : 'standard');
  const modeEvidence = declaredMode ? 'verified' : layoutUnified || layoutStandard ? 'inferred' : 'unknown';
  unified = effectiveMode === 'unified';
  if (unified && (!spot || typeof spot !== 'object' || !Array.isArray(spot.balances))) throw new AdapterError('INVALID_RESPONSE', 'Unified account: the spot clearinghouse state is missing or malformed');
  if (unified && !usdcEntry && (perpsAccountValue !== 0 || (Array.isArray(state.assetPositions) && state.assetPositions.length > 0))) throw new AdapterError('INVALID_RESPONSE', 'Unified account: the spot USDC entry is missing although the account has positions or equity');
  const accountValue = unified ? spotUsdc.total : perpsAccountValue;
  const withdrawable = unified ? round2(Math.max(0, spotUsdc.total - spotUsdc.hold)) : perpsWithdrawable;
  // Diagnostic, not a gate: the exchange's available-after-maintenance figure equals total minus cross maintenance margin
  // across every perp DEX; a mismatch usually means positions on another DEX (HIP-3), which this model does not read.
  let crossCheck = null;
  if (unified && Array.isArray(spot.tokenToAvailableAfterMaintenance) && state.crossMaintenanceMarginUsed != null) {
    const entry = spot.tokenToAvailableAfterMaintenance.find((e) => Array.isArray(e) && e[0] === 0);
    if (entry) {
      const available = round2(decimal(entry[1], 'USDC available after maintenance'));
      const implied = round2(spotUsdc.total - decimal(state.crossMaintenanceMarginUsed, 'crossMaintenanceMarginUsed'));
      crossCheck = { implied, available, ok: Math.abs(implied - available) <= Math.max(1, spotUsdc.total * 0.0001) };
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
  // The SOL leg reserves the larger of the exchange's 10% transfer floor and its own initial margin rate (1 / leverage).
  const reserveRate = solReport.leverage && solReport.leverage > 0 ? Math.max(HL_RESERVE_RATE, Math.ceil((1 / solReport.leverage) * 10_000) / 10_000) : HL_RESERVE_RATE;
  const collateral = round2(accountValue - locked);
  const collateralCents = Math.round(collateral * 100);
  const required = requiredMarginCents(shortSol, markPrice, reserveRate);
  if (collateral < 0 || required > collateralCents) {
    throw new AdapterError('LEVERAGE_TOO_HIGH', `Equity after other positions' margin ($${collateral.toFixed(2)}) is below the ${(reserveRate * 100).toFixed(reserveRate * 100 % 1 ? 2 : 0)}% reserve for the SOL short; the planner does not model this leverage`);
  }
  const modelHeadroom = (collateralCents - required) / 100;
  const freeWithdrawable = Math.max(0, Math.min(round2(withdrawable), modelHeadroom));
  let funding = null, fundingNote = null;
  if (Array.isArray(fundingHistory) && fundingHistory.length) {
    const rates = fundingHistory.map((entry) => Number(entry && entry.fundingRate));
    const times = fundingHistory.map((entry) => Number(entry && entry.time));
    if (rates.every((rate) => Number.isFinite(rate))) {
      const hourlyMean = rates.reduce((sum, rate) => sum + rate, 0) / rates.length;
      const hours = times.every((t) => Number.isFinite(t) && t > 0) ? Math.max(1, Math.round((Math.max(...times) - Math.min(...times)) / 3_600_000) + 1) : rates.length;
      const apr = round6(hourlyMean * 24 * 365);
      if (Math.abs(apr) > 5) fundingNote = `SOL funding history out of range at load (${(apr * 100).toFixed(0)}% a year over ${hours} hours); carry on the short is unknown`;
      else funding = { samples: rates.length, hours, hourlyMean: Math.round(hourlyMean * 1e10) / 1e10, apr };
    }
  }
  const fundingApr = funding ? funding.apr : null;
  const fundingSpan = funding ? (funding.hours >= 160 ? '7-day average' : `${funding.hours}-hour average`) : null;
  const universe = meta && Array.isArray(meta.universe) ? meta.universe : null;
  const assetIndex = universe ? universe.findIndex((u) => u && u.name === 'SOL') : -1;
  const szDecimals = assetIndex >= 0 && Number.isInteger(Number(universe[assetIndex].szDecimals)) && Number(universe[assetIndex].szDecimals) >= 0 && Number(universe[assetIndex].szDecimals) <= 6 ? Number(universe[assetIndex].szDecimals) : null;
  const lotSize = szDecimals == null ? 0.01 : Number((10 ** -szDecimals).toFixed(6));
  const minOrderUsd = 10; // Hyperliquid's minimum order value
  let fees = null;
  if (userFees && typeof userFees === 'object') {
    const taker = Number(userFees.userCrossRate), maker = Number(userFees.userAddRate);
    // Basis points straight from the decimal string, rounded up exactly (no floating-point epsilon games).
    const bpsCeil = (text) => { const m = /^(\d+)(?:\.(\d+))?$/.exec(String(text).trim()); if (!m) return null; const fraction = m[2] ?? ''; const n = BigInt(m[1] + fraction); const decimals = fraction.length; if (decimals <= 4) return Number(n * 10n ** BigInt(4 - decimals)); const d = 10n ** BigInt(decimals - 4); return Number((n + d - 1n) / d); };
    const closeBps = bpsCeil(userFees.userCrossRate) ?? (Number.isFinite(taker) ? Math.ceil(taker * 10_000) : null);
    if (Number.isFinite(taker) && taker >= 0 && taker < 0.01 && closeBps != null) fees = { takerRate: taker, makerRate: Number.isFinite(maker) ? maker : null, closeBps };
  }
  const assumptions = [
    modeEvidence === 'verified'
      ? unified
        ? 'Unified account verified on HyperCore: the spot USDC total is the account equity (it already contains the perps margin and unrealised PnL); withdrawable is spot USDC total minus hold, both exchange figures'
        : 'Account mode verified on HyperCore: standard (abstraction disabled)'
      : modeEvidence === 'inferred'
        ? `Account mode reported as "default" on HyperCore; the balances match the ${effectiveMode} layout (${unified ? 'the spot total contains the perps equity and the hold equals perps equity minus perps withdrawable' : 'perps equity is held apart from spot USDC'}), so it is modelled as ${effectiveMode}`
        : 'Account mode reported as "default" on HyperCore and could not be established from the balances (no perps equity yet); treated as standard',
    `Reserve is ${(reserveRate * 100).toFixed(reserveRate * 100 % 1 ? 2 : 0)}% of short notional (the larger of the exchange's 10% transfer floor and the position's initial margin rate), not the exchange maintenance margin`,
    "Other open positions lock the larger of their initial margin and 10% of their notional (the exchange's transfer rule), deducted from equity",
  ];
  assumptions.push(fees ? `Short-reduction fee uses your Hyperliquid taker rate (${(fees.takerRate * 10_000).toFixed(3)} bps before referral discount, rounded up to ${fees.closeBps} bps)` : 'Hyperliquid fee schedule unavailable at load; the model uses 5 bps for the short reduction');
  assumptions.push(szDecimals == null ? 'Hyperliquid meta unavailable at load; SOL lot size assumed 0.01 SOL and the $10 minimum order applied' : `Short reductions are sized in ${lotSize} SOL lots (szDecimals ${szDecimals} from meta); reductions below Hyperliquid's $${minOrderUsd} minimum order are rejected`);
  assumptions.push(funding ? `Carry uses the ${fundingSpan} SOL funding, ${(funding.apr * 100).toFixed(2)}% per year over ${funding.samples} hourly samples (positive means longs pay shorts); it is an estimate at today's rates` : fundingNote ?? 'SOL funding history unavailable at load; carry on the short is unknown');
  if (!unified && spot === undefined) assumptions.push('Spot balances unavailable at load; they are informational for a standard account (other stables and USOL on HyperCore spot not listed)');
  if (crossCheck && !crossCheck.ok) assumptions.push(`Cross-check: spot USDC total minus cross maintenance margin ($${crossCheck.implied.toFixed(2)}) does not match the exchange's available-after-maintenance figure ($${crossCheck.available.toFixed(2)}); positions on other perp DEXs (HIP-3) or a snapshot skew are likely, and those positions are not modelled`);
  if (otherStables.length) assumptions.push(`Other stable collateral on HyperCore spot (${otherStables.map((s) => `${s.coin} ${s.total.toLocaleString('en-US', { maximumFractionDigits: 2 })}`).join(', ')}) is not modelled`);
  if (spotSol > 0) assumptions.push(`HyperCore spot holds ${spotSol} USOL; it is not counted as Solana spot SOL`);
  if (round2(withdrawable) < modelHeadroom) assumptions.push(`The exchange reported $${round2(withdrawable).toFixed(2)} withdrawable at load; collateral released by reducing the short is a model estimate, not an exchange quote`);
  return {
    evidence: 'imported',
    venue: 'hyperliquid',
    address,
    observedAt: new Date(now()).toISOString(),
    source: 'Hyperliquid public info API',
    state: { accountMode: unified ? 'unified' : 'standard', marginMode: 'cross', asset: 'SOL', shortSol, markPrice, collateral, conservativeMarginRate: reserveRate, freeWithdrawable, fundingApr, lotSize, minOrderUsd },
    reported: { accountMode, effectiveMode, modeEvidence, accountValue: round2(accountValue), withdrawable, spotUsdc, lockedMargin: locked, otherStables, spotSol, funding, crossCheck, fees, szDecimals, assetIndex: assetIndex >= 0 ? assetIndex : null, marginUsed: decimal(summary.totalMarginUsed ?? 0, 'totalMarginUsed'), ...solReport, otherPositions },
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
