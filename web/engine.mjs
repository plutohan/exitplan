/** ExitPlan's pure, synthetic cash-goal enumerator. No RPCs, signing, or execution. */
const UNITS = 1_000_000;
const CONSTRAINT_KEYS = ['target', 'maxNewDebt', 'preserveHedge', 'preserveSolQuantity', 'minHlBuffer', 'deadlineHours'];
const BASE_WARNINGS = [
  'Synthetic scenario only. Balances, prices, fees, liquidity, margin requirements and timings are invented fixture inputs.',
  'No live account validation, authoritative protocol simulation, transaction construction, signing or execution is supported.',
  'Cash means estimated USDC in a Solana wallet; it does not mean fiat in a bank account.',
  'Best means lowest upfront fees among the evaluated feasible candidates, not a global optimum or a recommendation. Borrowing carry is shown separately.',
  'The simplified Hyperliquid reserve is a scenario assumption, not protocol liquidation health or a safety guarantee.',
  'Paired sales and short reductions preserve final exposure only; this model does not guarantee atomicity or intermediate execution safety.'
];
const cents = value => Math.round(value * 100);
const dollars = value => value / 100;
const quantity = units => units / UNITS;
const units = value => Math.round(value * UNITS);
const mulFloor = (a, b, divisor) => Number(BigInt(a) * BigInt(b) / BigInt(divisor));
const mulCeil = (a, b, divisor) => Number((BigInt(a) * BigInt(b) + BigInt(divisor - 1)) / BigInt(divisor));
const feeFor = (amount, basisPoints) => mulCeil(amount, basisPoints, 10_000);
/** Integer cents of the model reserve for a SOL short, using the engine's own rounding. Adapters reuse it. */
export const requiredMarginCents = (shortSol, markPrice, rate) => feeFor(mulCeil(units(shortSol), cents(markPrice), UNITS), Math.round(rate * 10_000));
const IMPORTED_WARNING = 'Imported snapshot: balances and positions were read from public APIs at load time; fees, reserve rate, timings and borrowing terms remain model assumptions.';

export function createDemoPortfolio() {
  return {
    evidence: 'scenario', synthetic: true,
    snapshot: { complete: true, ageSeconds: 0, maxAgeSeconds: 300 },
    solana: {
      sol: 100, solPrice: 100,
      lending: { usdc: 3000, debt: 0, withdrawCapacity: 3000 },
      wallet: { usdc: 0 },
      borrow: { enabled: true, capacity: 3000, maxLtv: 0.3 }
    },
    hyperliquid: {
      accountMode: 'standard', marginMode: 'cross', asset: 'SOL',
      shortSol: 100, markPrice: 100, collateral: 4000,
      conservativeMarginRate: 0.1, freeWithdrawable: 3000
    },
    fees: {
      lendingWithdraw: 0.25, solSaleBps: 30, hlCloseBps: 5,
      hlTransfer: 1, borrowFixed: 0.5, borrowAprBps: 800
    },
    timing: { lendingWithdrawHours: 0.1, hlTransferHours: 0.5, tradeHours: 0.1, borrowHours: 0.1 }
  };
}

export function defaultConstraints() {
  return { target: 2000, maxNewDebt: 0, preserveHedge: true, preserveSolQuantity: false, minHlBuffer: 1500, deadlineHours: 24 };
}

function validate(portfolio, supplied) {
  const errors = [];
  const constraints = { ...defaultConstraints(), ...supplied };
  const p = portfolio;
  const number = (value, name, { max = 1_000_000_000, scale = 100 } = {}) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) {
      errors.push(`${name} must be a finite non-negative number no greater than ${max}.`);
    } else if (Math.abs(value * scale - Math.round(value * scale)) > 0.00001) {
      errors.push(`${name} has unsupported precision.`);
    }
  };
  if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) errors.push('Constraints must be an object.');
  for (const key of Object.keys(supplied || {})) if (!CONSTRAINT_KEYS.includes(key)) errors.push(`Unsupported constraint: ${key}.`);
  for (const key of ['target', 'maxNewDebt', 'minHlBuffer']) number(constraints[key], key);
  number(constraints.deadlineHours, 'deadlineHours', { max: 8760, scale: 1_000_000 });
  for (const key of ['preserveHedge', 'preserveSolQuantity']) if (typeof constraints[key] !== 'boolean') errors.push(`${key} must be boolean.`);
  if (!p || typeof p !== 'object' || Array.isArray(p)) return { errors: [...errors, 'Portfolio is missing.'], constraints };
  const scenario = p.evidence === 'scenario' && p.synthetic === true;
  const imported = p.evidence === 'imported' && p.synthetic === false;
  if (!scenario && !imported) errors.push('Portfolio evidence must be scenario (synthetic: true) or imported (synthetic: false).');
  if (p.snapshot?.complete !== true) errors.push('Portfolio snapshot is missing or incomplete.');
  number(p.snapshot?.ageSeconds, 'snapshot.ageSeconds', { scale: 1, max: 31_536_000 });
  number(p.snapshot?.maxAgeSeconds, 'snapshot.maxAgeSeconds', { scale: 1, max: 300 });
  if (p.snapshot?.ageSeconds > p.snapshot?.maxAgeSeconds) errors.push('Portfolio snapshot is stale; refresh state before planning.');
  const s = p.solana, h = p.hyperliquid, f = p.fees, t = p.timing;
  number(s?.sol, 'solana.sol', { scale: UNITS, max: 1_000_000 });
  number(s?.solPrice, 'solana.solPrice');
  if (s?.solPrice === 0) errors.push('SOL price must be positive.');
  for (const key of ['usdc', 'debt', 'withdrawCapacity']) number(s?.lending?.[key], `solana.lending.${key}`);
  if (s?.lending?.withdrawCapacity > s?.lending?.usdc) errors.push('Lending withdrawal capacity cannot exceed the supplied USDC balance.');
  if (s?.lending?.debt !== 0) errors.push('Existing lending debt is unsupported by this fixture adapter.');
  number(s?.wallet?.usdc, 'solana.wallet.usdc');
  if (typeof s?.borrow?.enabled !== 'boolean') errors.push('solana.borrow.enabled must be boolean.');
  number(s?.borrow?.capacity, 'solana.borrow.capacity');
  number(s?.borrow?.maxLtv, 'solana.borrow.maxLtv', { max: 1, scale: 10_000 });
  if (h?.accountMode !== 'standard') errors.push('Unsupported Hyperliquid account mode; only the standard-account scenario is supported.');
  if (h?.marginMode !== 'cross') errors.push('Unsupported Hyperliquid margin mode; isolated and strict-isolated scenarios are not supported.');
  if (h?.asset !== 'SOL') errors.push('Only a single SOL short is supported in the Hyperliquid scenario.');
  number(h?.shortSol, 'hyperliquid.shortSol', { scale: UNITS, max: 1_000_000 });
  for (const key of ['markPrice', 'collateral', 'freeWithdrawable']) number(h?.[key], `hyperliquid.${key}`);
  if (h?.markPrice === 0) errors.push('Hyperliquid mark price must be positive.');
  number(h?.conservativeMarginRate, 'hyperliquid.conservativeMarginRate', { max: 1, scale: 10_000 });
  if (h?.conservativeMarginRate === 0) errors.push('Conservative margin rate must be positive.');
  if (s?.sol * s?.solPrice > 1_000_000_000 || h?.shortSol * h?.markPrice > 1_000_000_000) errors.push('Position notional exceeds the supported scenario range.');
  for (const key of ['lendingWithdraw', 'hlTransfer', 'borrowFixed']) number(f?.[key], `fees.${key}`);
  for (const key of ['solSaleBps', 'hlCloseBps', 'borrowAprBps']) number(f?.[key], `fees.${key}`, { max: 10_000, scale: 1 });
  for (const key of ['lendingWithdrawHours', 'hlTransferHours', 'tradeHours', 'borrowHours']) number(t?.[key], `timing.${key}`, { max: 8760, scale: 1_000_000 });
  if (!errors.length) {
    const required = requiredMarginCents(h.shortSol, h.markPrice, h.conservativeMarginRate);
    if (required > cents(h.collateral)) errors.push('Hyperliquid collateral is below the scenario required margin.');
    if (cents(h.freeWithdrawable) > Math.max(0, cents(h.collateral) - required)) errors.push('Hyperliquid free-withdrawable input exceeds collateral less the scenario reserve.');
  }
  return { errors, constraints };
}

/** Pure bounded enumeration. Invalid or unsupported inputs fail closed in result.errors. */
export function planExit(portfolio, suppliedConstraints = defaultConstraints()) {
  const { errors, constraints: c } = validate(portfolio, suppliedConstraints);
  const evidence = portfolio?.evidence === 'imported' ? 'imported' : 'scenario';
  const result = {
    plans: [], feasible: [], best: null, maximumWithoutSelling: 0,
    evidence, executionSupported: false, warnings: evidence === 'imported' ? [IMPORTED_WARNING, ...BASE_WARNINGS.slice(1)] : [...BASE_WARNINGS], errors,
    cashAsset: 'USDC', cashDestination: 'Solana wallet (scenario)',
    ranking: 'Lowest total upfront fees, then less new debt, less SOL sold, fewer steps, and stable plan ID.',
    constraints: c
  };
  if (errors.length) return result;
  const { solana: s, hyperliquid: h, fees: f, timing: t } = portfolio;
  const target = cents(c.target), minimumBuffer = cents(c.minHlBuffer);
  const initialSol = units(s.sol), initialShort = units(h.shortSol);
  const price = cents(s.solPrice), mark = cents(h.markPrice);
  const initialCollateral = cents(h.collateral), initialLending = cents(s.lending.usdc);
  const lendingCapacity = cents(s.lending.withdrawCapacity);
  const walletCents = cents(s.wallet.usdc);
  const walletUse = Math.min(walletCents, target); // free USDC is always used first, at zero fee
  const need = target - walletUse;
  const initialFree = cents(h.freeWithdrawable);
  const marginBps = Math.round(h.conservativeMarginRate * 10_000);
  const ltvBps = Math.round(s.borrow.maxLtv * 10_000);
  const fixedLendingFee = cents(f.lendingWithdraw), fixedTransferFee = cents(f.hlTransfer), fixedBorrowFee = cents(f.borrowFixed);
  const notional = (q, p = price) => mulFloor(q, p, UNITS);
  const requiredMargin = short => feeFor(mulCeil(short, mark, UNITS), marginBps);
  const originalRequired = requiredMargin(initialShort);
  const initialBuffer = initialCollateral - originalRequired;
  const closeFee = q => feeFor(mulCeil(q, mark, UNITS), f.hlCloseBps);
  const hlCapacity = closed => Math.max(0, Math.min(
    initialCollateral - closeFee(closed) - requiredMargin(initialShort - closed) - minimumBuffer,
    initialFree + originalRequired - requiredMargin(initialShort - closed) - closeFee(closed)
  ));
  const borrowCapacity = sold => s.borrow.enabled ? Math.max(0, Math.min(cents(s.borrow.capacity), mulFloor(notional(initialSol - sold), ltvBps, 10_000))) : 0;
  const saleNet = q => notional(q) - feeFor(notional(q), f.solSaleBps);
  const cash = a => a.wallet + a.lending - (a.lending ? fixedLendingFee : 0)
    + a.hl - (a.hl ? fixedTransferFee : 0) + saleNet(a.sold)
    + a.borrowed - (a.borrowed ? fixedBorrowFee : 0);
  const minQuantity = (limit, meets) => {
    if (meets(0)) return 0;
    if (!meets(limit)) return limit;
    let lo = 0, hi = limit;
    while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (meets(mid)) hi = mid; else lo = mid + 1; }
    return lo;
  };
  const allocation = (updates = {}) => ({ wallet: walletUse, lending: 0, hl: 0, sold: 0, closed: 0, borrowed: 0, ...updates });
  const signatures = new Set();
  const add = (id, label, a, family, deduplicate = false) => {
    const signature = [a.wallet, a.lending, a.hl, a.sold, a.closed, a.borrowed].join(':');
    if (deduplicate && signatures.has(signature)) return;
    signatures.add(signature);
    const proceedsFees = (a.lending ? fixedLendingFee : 0) + (a.hl ? fixedTransferFee : 0)
      + feeFor(notional(a.sold), f.solSaleBps) + (a.borrowed ? fixedBorrowFee : 0);
    const collateralFees = closeFee(a.closed);
    const hlAfter = initialCollateral - a.hl - collateralFees;
    const marginAfter = requiredMargin(initialShort - a.closed);
    const net = cash(a), rejections = [], steps = [];
    const step = (venue, action, amount, unit) => steps.push({ venue, action, amount, unit });
    if (a.wallet) step('Solana wallet', 'Use USDC already in the wallet', dollars(a.wallet), 'USDC');
    if (a.lending) step('Solana lending (fixture)', 'Withdraw lending USDC', dollars(a.lending), 'USDC');
    if (a.sold) step('Solana (fixture)', 'Sell SOL for USDC', quantity(a.sold), 'SOL');
    if (a.closed) step('Hyperliquid (fixture)', 'Reduce SOL short by the paired quantity', quantity(a.closed), 'SOL');
    if (a.borrowed) step('Solana lending (comparison only)', 'Borrow USDC against retained SOL', dollars(a.borrowed), 'USDC');
    if (a.hl) step('Hyperliquid → Solana (fixture)', 'Withdraw and transfer USDC collateral', dollars(a.hl), 'USDC');
    const estimatedHours = Number(((a.lending ? t.lendingWithdrawHours : 0) + (a.sold || a.closed ? t.tradeHours : 0)
      + (a.hl ? t.hlTransferHours : 0) + (a.borrowed ? t.borrowHours : 0)).toFixed(6));
    if (net < target) rejections.push(`Net USDC is $${dollars(net).toFixed(2)}, below the $${c.target.toFixed(2)} target.`);
    if (a.borrowed > cents(c.maxNewDebt)) rejections.push(`New debt of $${dollars(a.borrowed).toFixed(2)} exceeds the $${c.maxNewDebt.toFixed(2)} debt limit.`);
    if (c.preserveSolQuantity && a.sold) rejections.push('Selling SOL violates the preserve-SOL-quantity constraint.');
    if (c.preserveHedge && a.sold !== a.closed) rejections.push('SOL sale and short reduction are mismatched; starting net SOL exposure would change.');
    // The floor binds only when a route lowers the buffer; an account that already sits under it may still raise cash elsewhere.
    if (hlAfter - marginAfter < minimumBuffer && hlAfter - marginAfter < initialBuffer) rejections.push(`Remaining HL scenario buffer of $${dollars(hlAfter - marginAfter).toFixed(2)} is below $${c.minHlBuffer.toFixed(2)}.`);
    if (estimatedHours > c.deadlineHours) rejections.push(`Fixture duration of ${estimatedHours} hours exceeds the ${c.deadlineHours}-hour deadline; this is not a delivery guarantee.`);
    if (a.wallet > walletCents) rejections.push('Wallet USDC exceeds the balance.');
    if (a.lending > lendingCapacity) rejections.push('Lending withdrawal exceeds supplied capacity.');
    if (a.sold > initialSol || a.closed > initialShort) rejections.push('Trade exceeds the available position quantity.');
    if (a.hl > hlCapacity(a.closed)) rejections.push('HL withdrawal exceeds the scenario removable collateral limit.');
    if (a.borrowed > borrowCapacity(a.sold)) rejections.push('Borrow amount exceeds the comparison-only collateral capacity.');
    const totalFees = proceedsFees + collateralFees;
    const feeBreakdown = {
      lendingWithdrawal: dollars(a.lending ? fixedLendingFee : 0),
      spotSale: dollars(feeFor(notional(a.sold), f.solSaleBps)),
      shortClose: dollars(collateralFees),
      hlTransfer: dollars(a.hl ? fixedTransferFee : 0),
      borrowOrigination: dollars(a.borrowed ? fixedBorrowFee : 0)
    };
    result.plans.push({
      id, label, family, steps, netCash: dollars(net), fees: dollars(totalFees),
      feesFromProceeds: dollars(proceedsFees), feesFromCollateral: dollars(collateralFees), feeBreakdown,
      grossProceeds: dollars(a.wallet + a.lending + a.hl + notional(a.sold) + a.borrowed),
      walletUsed: dollars(a.wallet),
      newDebt: dollars(a.borrowed), existingDebt: s.lending.debt, debtAfter: s.lending.debt + dollars(a.borrowed),
      solAfter: quantity(initialSol - a.sold), shortAfter: quantity(initialShort - a.closed),
      solPledgedAfter: a.borrowed ? quantity(minQuantity(initialSol - a.sold, q => mulFloor(notional(q), ltvBps, 10_000) >= a.borrowed)) : 0,
      netSolExposure: quantity(initialSol - a.sold - initialShort + a.closed),
      solSold: quantity(a.sold), shortReduced: quantity(a.closed),
      hlCollateralAfter: dollars(hlAfter), hlRequiredMarginAfter: dollars(marginAfter), hlBufferAfter: dollars(hlAfter - marginAfter),
      lendingAfter: dollars(initialLending - a.lending), estimatedHours,
      borrowAprBps: f.borrowAprBps,
      borrowDailyCarryEstimate: dollars(mulCeil(a.borrowed, f.borrowAprBps, 3_650_000)),
      borrowCarryEstimate: a.borrowed ? null : 0,
      feasible: rejections.length === 0, rejections, evidence, executionSupported: false,
      comparisonOnly: true,
      limitations: a.borrowed ? ['Borrowing is a hypothetical fixture comparison; no borrowing adapter is implemented.', 'Total carry cannot be estimated without a repayment horizon. Daily interest uses the fixture APR; the cash-arrival deadline is not a loan holding period.'] : []
    });
  };
  const desired = (amount, fixed, capacity) => amount > 0 ? Math.min(capacity, amount + fixed) : 0;
  const pairedLimit = Math.min(initialSol, initialShort);
  if (target === 0) add('no-action', 'No withdrawal needed', allocation(), 'hold');
  if (target > 0 && need === 0) {
    // Free wallet USDC covers the whole target: one route, nothing else to enumerate.
    add('wallet-usdc', 'Use USDC already in the wallet', allocation(), 'wallet');
  } else if (target > 0) {
  add('withdraw-lending', 'Withdraw lending USDC', allocation({ lending: desired(need, fixedLendingFee, lendingCapacity) }), 'lending');
  add('withdraw-hl', 'Withdraw free HL collateral', allocation({ hl: desired(need, fixedTransferFee, hlCapacity(0)) }), 'collateral');
  const pairedQuantity = minQuantity(pairedLimit, q => saleNet(q) >= need);
  add('paired-unwind', 'Sell SOL + reduce matching short', allocation({ sold: pairedQuantity, closed: pairedQuantity }), 'paired');
  const saleQuantity = minQuantity(initialSol, q => saleNet(q) >= need);
  add('sell-sol', 'Sell SOL without reducing short', allocation({ sold: saleQuantity }), 'sale');
  add('borrow-sol', 'Borrow against SOL (comparison only)', allocation({ borrowed: desired(need, fixedBorrowFee, borrowCapacity(0)) }), 'borrow');

  // Enumerate bounded hybrid grids, then size the final source to the target.
  // Every action is rechecked against all constraints; the grid makes no optimality claim.
  const fractions = [0, 0.25, 0.5, 0.75, 1];
  for (const [li, fraction] of fractions.entries()) {
    const l = Math.min(Math.floor(lendingCapacity * fraction), desired(need, fixedLendingFee, lendingCapacity));
    const base = allocation({ lending: l });
    const gap = Math.max(0, target - cash(base));
    const hOnly = desired(gap, fixedTransferFee, hlCapacity(0));
    add(`hybrid-lending-hl-${li}`, 'Lending + free HL collateral', { ...base, hl: hOnly }, 'hybrid', true);
    const borrowed = desired(gap, fixedBorrowFee, borrowCapacity(0));
    add(`hybrid-lending-borrow-${li}`, 'Lending + borrow (comparison only)', { ...base, borrowed }, 'hybrid', true);
    for (const [hi, share] of fractions.entries()) {
      const hl = Math.min(Math.floor(hlCapacity(0) * share), desired(gap, fixedTransferFee, hlCapacity(0)));
      const withHl = { ...base, hl };
      const q = minQuantity(pairedLimit, sold => cash({ ...withHl, sold, closed: sold }) >= target);
      add(`hybrid-paired-${li}-${hi}`, 'Lending + collateral + paired unwind', { ...withHl, sold: q, closed: q }, 'hybrid', true);
      const remainingGap = Math.max(0, target - cash(withHl));
      add(`hybrid-borrow-${li}-${hi}`, 'Lending + collateral + borrow (comparison only)', { ...withHl, borrowed: desired(remainingGap, fixedBorrowFee, borrowCapacity(0)) }, 'hybrid', true);
      // Explore debt-limited mixed routes without assuming an unrestricted loan.
      if (c.maxNewDebt > 0 && remainingGap > 0) {
        const debt = Math.min(cents(c.maxNewDebt), desired(remainingGap, fixedBorrowFee, borrowCapacity(0)));
        const mixed = { ...withHl, borrowed: debt };
        const mixedQuantity = minQuantity(pairedLimit, sold => cash({ ...mixed, sold, closed: sold }) >= target);
        add(`hybrid-mixed-${li}-${hi}`, 'Lending + collateral + paired sale + borrow (comparison only)', { ...mixed, sold: mixedQuantity, closed: mixedQuantity }, 'hybrid', true);
      }
    }
    // Recalculate collateral released by the reduced short; its notional is never cash.
    const withReleased = sold => {
      const a = { ...base, sold, closed: sold };
      a.hl = desired(Math.max(0, target - cash(a)), fixedTransferFee, hlCapacity(sold));
      return a;
    };
    const releasedQuantity = minQuantity(pairedLimit, q => cash(withReleased(q)) >= target);
    add(`hybrid-release-${li}`, 'Paired unwind + released collateral', withReleased(releasedQuantity), 'hybrid', true);
  }
  }

  // Maximum retaining both position quantities and creating no debt, independent of target.
  // Respect the same minimum buffer and fixture deadline; maximize over source subsets.
  for (const useLending of [false, true]) for (const useHl of [false, true]) {
    const a = allocation({ wallet: walletCents, lending: useLending ? lendingCapacity : 0, hl: useHl ? hlCapacity(0) : 0 });
    const duration = (a.lending ? t.lendingWithdrawHours : 0) + (a.hl ? t.hlTransferHours : 0);
    if (duration <= c.deadlineHours) result.maximumWithoutSelling = Math.max(result.maximumWithoutSelling, dollars(cash(a)));
  }
  result.feasible = result.plans.filter(plan => plan.feasible).sort((a, b) =>
    (a.id === 'no-action' ? -1 : b.id === 'no-action' ? 1 : 0)
    || cents(a.fees) - cents(b.fees) || cents(a.newDebt) - cents(b.newDebt) || units(a.solSold) - units(b.solSold)
    || a.steps.length - b.steps.length || a.id.localeCompare(b.id, 'en'));
  result.best = result.feasible[0] || null;
  return result;
}
