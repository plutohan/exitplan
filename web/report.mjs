/** Shared, DOM-free helpers: route and step names, the imported-portfolio assembly, the pre-flight checks and the plain-text report. Used by the browser app and the terminal command. */
import { createDemoPortfolio, requiredMarginCents } from './engine.mjs';

const fmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
export const money = (n, precise = false) =>
  '$' +
  new Intl.NumberFormat('en-US', { minimumFractionDigits: precise || Math.abs((Number(n) || 0) % 1) > 1e-9 ? 2 : 0, maximumFractionDigits: 2 }).format(
    Number(n) || 0,
  );
export const num = (n) => fmt.format(Number(n) || 0);
export function planName(p) {
  if (p.id === 'no-action') return 'Keep current positions';
  if (p.family === 'wallet') return 'Use wallet USDC';
  const actions = p.steps || [];
  const walletPrefix = p.walletUsed > 0 ? 'Wallet USDC + ' : '';
  const hasLend = actions.some((s) => s.action.startsWith('Withdraw lending'));
  const hasHl = actions.some((s) => s.action.startsWith('Withdraw and transfer'));
  if (p.newDebt > 0)
    return walletPrefix + (hasLend || hasHl ? 'Withdraw deposits + borrow more' : 'Borrow against SOL');
  if (p.shortReduced > 0 && p.solSold === 0)
    return walletPrefix + (hasLend ? 'Reduce short + released margin + deposits' : 'Reduce short + released margin');
  if (p.solSold > 0 && p.shortReduced > 0)
    return walletPrefix + (hasLend && hasHl ? 'Withdraw deposits + HL collateral + trim spot and short' : hasLend ? 'Withdraw deposits + trim spot and short' : hasHl ? 'HL collateral + trim spot and short' : 'Trim spot and short together');
  if (p.solSold > 0) return walletPrefix + 'Sell SOL only';
  if (hasLend && hasHl) return walletPrefix + 'Split withdrawal: Solana + HL';
  if (hasLend) return walletPrefix + 'Withdraw Solana deposit USDC';
  if (hasHl) return walletPrefix + 'Withdraw free HL collateral';
  return walletPrefix + 'Cash route';
}

export function stepName(s) {
  return s.action.startsWith('Use USDC')
    ? 'Use wallet USDC'
    : s.action.startsWith('Withdraw lending')
      ? 'Withdraw deposited USDC'
      : s.action.startsWith('Sell SOL')
        ? 'Sell SOL spot'
        : s.action === 'Reduce SOL short'
          ? 'Reduce SOL short'
          : s.action.startsWith('Reduce SOL')
            ? 'Reduce SOL short by the same amount'
          : s.action.startsWith('Borrow')
            ? 'Borrow against SOL (comparison)'
            : 'Withdraw HL collateral → Solana';
}

export const carryText = (p) => (p.carryPerYear == null ? ['Carry', 'unknown'] : p.carryPerYear < 0 ? ['Carry saved', `${money(-p.carryPerYear, true)}/yr`] : ['Carry given up', `${money(p.carryPerYear, true)}/yr`]);
export const initialHlBuffer = (portfolio) =>
  portfolio.hyperliquid.collateral -
  requiredMarginCents(
    portfolio.hyperliquid.shortSol,
    portfolio.hyperliquid.markPrice,
    portfolio.hyperliquid.conservativeMarginRate,
  ) /
    100;

export function rejectionText(p, constraints, initialBuffer) {
  const reasons = [];
  if (p.netCash < constraints.target) reasons.push(`${money(constraints.target - p.netCash)} short of the target`);
  if (constraints.preserveSolQuantity && p.solSold > 0) reasons.push('Sells SOL while keep-SOL-quantity is on');
  if (constraints.preserveHedge && Math.abs(p.solSold - p.shortReduced) > 0.0000005)
    reasons.push('Spot sold and short reduced differ, which changes net SOL exposure while keep-net-exposure is on');
  if (p.newDebt > constraints.maxNewDebt) reasons.push(`New debt ${money(p.newDebt)} exceeds the limit`);
  if (p.hlBufferAfter < constraints.minHlBuffer && p.hlBufferAfter < initialBuffer)
    reasons.push(`Leaves the Hyperliquid buffer below your ${money(constraints.minHlBuffer)} floor`);
  if (p.estimatedHours > constraints.deadlineHours) reasons.push('Assumed duration exceeds the planning window');
  return reasons.join(' · ') || 'Needs more than the available balance, collateral or position allows';
}

export function buildImportedPortfolio(solana, hyperliquid) {
  const base = createDemoPortfolio();
  return {
    evidence: 'imported',
    synthetic: false,
    snapshot: { complete: true, ageSeconds: 0, maxAgeSeconds: 300 },
    solana: solana.state,
    hyperliquid: hyperliquid.state,
    fees: { ...base.fees, lendingWithdraw: 0, solSaleBps: solana.quote.solSaleBps, hlCloseBps: hyperliquid.reported.fees?.closeBps ?? base.fees.hlCloseBps, hlSlippageBps: 10 }, // Kamino charges no withdrawal fee; the short-reduction fee is the account's taker rate when known; 10 bps reserved for buy-back slippage
    timing: base.timing,
  };
}

export function preflightChecks({ imported, portfolio, constraints }) {
  const hl = imported.hyperliquid, so = imported.solana;
  const items = [];
  const push = (status, label, detail) => items.push({ status, label, detail });
  const unifiedMode = hl.reported.effectiveMode === 'unified';
  const unifiedDetail = `spot USDC ${money(hl.reported.spotUsdc.total, true)} is the equity, ${money(hl.reported.spotUsdc.hold, true)} held for margin or open orders`;
  if (unifiedMode && hl.reported.crossCheck && !hl.reported.crossCheck.ok) push('warn', 'Account mode', `unified account, but the cross-check failed: spot USDC total minus maintenance ${money(hl.reported.crossCheck.implied, true)} vs exchange available ${money(hl.reported.crossCheck.available, true)}; positions on other perp DEXs (HIP-3) are not modelled`);
  else if (hl.reported.modeEvidence === 'verified') push('ok', 'Account mode', unifiedMode ? `verified on HyperCore: unified account (${unifiedDetail})` : 'verified on HyperCore: standard (abstraction disabled)');
  else if (hl.reported.modeEvidence === 'inferred') push('warn', 'Account mode', `reported as default on HyperCore; the balances match the ${hl.reported.effectiveMode} layout, so it is modelled as ${hl.reported.effectiveMode}${unifiedMode ? ` (${unifiedDetail})` : ''}; confirm the mode in Hyperliquid settings before acting on Hyperliquid routes`);
  else push('warn', 'Account mode', 'reported as default on HyperCore and could not be established from the balances; treated as standard, so confirm the mode in Hyperliquid settings before acting on Hyperliquid routes');
  const exposure = portfolio.solana.sol - portfolio.hyperliquid.shortSol;
  if (Math.abs(exposure) < 0.000001) push('ok', 'Net exposure', '0 SOL: spot and short balanced');
  else push('warn', 'Net exposure', `${num(exposure)} SOL: not neutral (spot ${num(portfolio.solana.sol)}, short ${num(portfolio.hyperliquid.shortSol)}); keep-net-exposure preserves this${hl.reported.spotSol > 0 ? ` · HyperCore spot also holds ${hl.reported.spotSol} USOL, not counted` : ''}`);
  if (portfolio.hyperliquid.shortSol > 0 && hl.reported.liquidationPrice) {
    const distance = (hl.reported.liquidationPrice - portfolio.hyperliquid.markPrice) / portfolio.hyperliquid.markPrice;
    if (distance <= 0) push('warn', 'Liquidation', `${money(hl.reported.liquidationPrice, true)} vs mark ${money(portfolio.hyperliquid.markPrice, true)}: at or past liquidation on the exchange's number; reload positions`);
    else push(distance >= 0.25 ? 'ok' : 'warn', 'Liquidation', `${money(hl.reported.liquidationPrice, true)} vs mark ${money(portfolio.hyperliquid.markPrice, true)} (${(distance * 100).toFixed(0)}% above mark), cross-margin price from the exchange; assumes other positions' prices hold`);
  } else push('info', 'Liquidation', 'no SOL short, no liquidation price');
  const buffer = initialHlBuffer(portfolio);
  const reserveLabel = `${(portfolio.hyperliquid.conservativeMarginRate * 100).toFixed(portfolio.hyperliquid.conservativeMarginRate * 100 % 1 ? 2 : 0)}% reserve`;
  if (buffer < constraints.minHlBuffer) push('warn', 'HL margin buffer', `model buffer ${money(buffer, true)} (${reserveLabel}) is under your ${money(constraints.minHlBuffer)} floor: HL withdrawals only after reducing the short; non-HL routes are evaluated separately`);
  else push('ok', 'HL margin buffer', `model buffer ${money(buffer, true)} (${reserveLabel}) above your ${money(constraints.minHlBuffer)} floor; ${unifiedMode ? "derived from the exchange's total and hold:" : 'exchange reported'} ${money(hl.reported.withdrawable, true)} withdrawable (Δ ${money(Math.abs(buffer - hl.reported.withdrawable), true)})`);
  const liquidity = so.reported.reserveLiquidity, deposit = portfolio.solana.lending.usdc;
  if (deposit <= 0) push('info', 'Kamino liquidity', 'no Kamino deposit to withdraw');
  else if (liquidity >= deposit) push('ok', 'Kamino liquidity', `${money(liquidity, true)} pool cash in the USDC reserve (before withdrawal caps) vs your ${money(deposit, true)} deposited`);
  else push('warn', 'Kamino liquidity', `only ${money(liquidity, true)} pool cash in the USDC reserve (before withdrawal caps) vs your ${money(deposit, true)} deposited`);
  const walletUsdc = portfolio.solana.wallet.usdc;
  push(walletUsdc > 0 ? 'ok' : 'info', 'Wallet USDC', walletUsdc > 0 ? `${money(walletUsdc, true)} used first at zero fee` : 'none in the wallet');
  const fundingApr = portfolio.hyperliquid.fundingApr, supplyApy = portfolio.solana.lending.supplyApy;
  const fundingSpan = hl.reported.funding ? (hl.reported.funding.hours >= 160 ? '7-day average' : `${hl.reported.funding.hours}-hour average`) : '7-day average';
  const shortNotional = portfolio.hyperliquid.shortSol * portfolio.hyperliquid.markPrice;
  const fundingPart = fundingApr == null ? 'SOL funding history unavailable' : portfolio.hyperliquid.shortSol > 0 ? `short ${fundingApr >= 0 ? 'earns' : 'pays'} ~${money(Math.abs(shortNotional * fundingApr), true)}/yr funding (${fundingSpan} ${(fundingApr * 100).toFixed(2)}%)` : `no short; SOL funding ${fundingSpan} ${(fundingApr * 100).toFixed(2)}%`;
  const yieldPart = supplyApy == null ? 'Kamino supply APY unavailable' : deposit > 0 ? `deposit earns ~${money(deposit * supplyApy, true)}/yr (${(supplyApy * 100).toFixed(2)}% APY)` : `no deposit; Kamino USDC ${(supplyApy * 100).toFixed(2)}% APY`;
  push('info', 'Carry', `${fundingPart} · ${yieldPart}; each route shows the carry it gives up`);
  if (hl.reported.otherPositions.length) push('info', 'Other Hyperliquid positions', `${hl.reported.otherPositions.map((p) => p.coin).join(', ')}: margin treated as locked`);
  push('info', 'Not simulated', 'Hyperliquid order and withdrawal legs; HL → Solana CCTP delivery fee');
  return items;
}

export function buildReport({ imported, portfolio, result, constraints, selectedId = null, link = '', now = () => new Date() }) {
  const hl = imported.hyperliquid, so = imported.solana, h = portfolio.hyperliquid, s = portfolio.solana;
  const yesNo = (v) => (v ? 'yes' : 'no');
  const ranked = [...result.feasible];
  // One line per rejected route name, keeping the attempt that came closest to the target.
  const rejectedByName = new Map();
  for (const p of result.plans.filter((plan) => !plan.feasible)) { const name = planName(p); const kept = rejectedByName.get(name); if (!kept || p.netCash > kept.netCash) rejectedByName.set(name, p); }
  const rejected = [...rejectedByName.values()];
  const routeLine = (p, i) => `${i + 1}. ${p.id === selectedId ? '[selected] ' : ''}${planName(p)} — net ${money(p.netCash, true)} · upfront fees ${money(p.fees, true)} · ${carryText(p)[0].toLowerCase()} ${carryText(p)[1]} · new debt ${money(p.newDebt)} · steps: ${p.steps.map((st) => `${stepName(st)} ${st.unit === 'USDC' ? money(st.amount, true) : num(st.amount) + ' SOL'}`).join(' → ')}`;
  return [
    `# ExitPlan pre-flight report · ${now().toISOString().replace('T', ' ').slice(0, 16)} UTC`,
    'Read-only. Nothing was signed or sent. Estimates at today\'s rates from public APIs; not an execution plan.',
    '',
    `Solana wallet ${imported.solana.address} · Hyperliquid address ${imported.hyperliquid.address}`,
    `Solana: ${num(s.sol)} SOL · Kamino deposit ${money(s.lending.usdc, true)} · wallet USDC ${money(s.wallet.usdc, true)} · SOL quote ${money(s.solPrice, true)}`,
    `Hyperliquid: ${h.accountMode} account · short ${num(h.shortSol)} SOL at mark ${money(h.markPrice, true)} · liquidation ${hl.reported.liquidationPrice ? money(hl.reported.liquidationPrice, true) : 'n/a'} · model buffer ${money(initialHlBuffer(portfolio), true)} (${(h.conservativeMarginRate * 100).toFixed(h.conservativeMarginRate * 100 % 1 ? 2 : 0)}% reserve) · exchange withdrawable ${money(hl.reported.withdrawable, true)}`,
    `Goal: ${money(constraints.target)} net USDC · keep net exposure: ${yesNo(constraints.preserveHedge)} · keep SOL quantity: ${yesNo(constraints.preserveSolQuantity)} · new-debt cap ${money(constraints.maxNewDebt)} · min HL buffer ${money(constraints.minHlBuffer)} · deadline ${constraints.deadlineHours} h`,
    ...(result.errors && result.errors.length ? ['', '## Errors', ...result.errors.map((line) => `- ${line}`)] : []),
    '',
    '## Checks',
    ...preflightChecks({ imported, portfolio, constraints }).map((i) => `- ${i.label}: ${i.status} · ${i.detail}`),
    '',
    `## Routes (ranked by upfront fees) · ${ranked.length} of ${result.plans.length} fit`,
    ...(ranked.length ? ranked.map(routeLine) : ['- none fits the current goal and limits']),
    '',
    '## Rejected routes',
    ...(rejected.length ? rejected.map((p) => `- ${planName(p)} — ${rejectionText(p, constraints, initialHlBuffer(portfolio))}`) : ['- none']),
    '',
    `Plan link: ${link}`,
    'Generated by ExitPlan (https://exitplan-rouge.vercel.app) · MIT · Not financial advice. Hyperliquid legs are not simulated; HL → Solana delivery fees are a model placeholder.',
  ].join('\n');
}

