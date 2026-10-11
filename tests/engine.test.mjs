import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoPortfolio, defaultConstraints, planExit, requiredMarginCents } from '../web/engine.mjs';

const run = (constraints = {}, portfolio = createDemoPortfolio()) => planExit(portfolio, { ...defaultConstraints(), ...constraints });
const route = (result, id) => result.plans.find(plan => plan.id === id);
const cents = value => Math.round(value * 100);

test('default fixture raises exactly $2,000 from lending, with explicit fees and all remaining positions', () => {
  const result = run();
  assert.deepEqual(result.errors, []);
  assert.equal(result.best.id, 'withdraw-lending');
  assert.equal(result.best.netCash, 2000);
  assert.equal(result.best.grossProceeds, 2000.25);
  assert.equal(result.best.fees, 0.25);
  assert.equal(result.best.lendingAfter, 999.75);
  assert.equal(result.best.solAfter, 100);
  assert.equal(result.best.shortAfter, 100);
  assert.equal(result.best.netSolExposure, 0);
  assert.equal(result.best.hlCollateralAfter, 4000);
  assert.equal(result.best.hlRequiredMarginAfter, 1000);
  assert.equal(result.best.hlBufferAfter, 3000);
  assert.equal(result.best.newDebt, 0);
});

test('free HL collateral is capped by both the risk reserve and requested buffer', () => {
  const hl = route(run(), 'withdraw-hl');
  assert.equal(hl.grossProceeds, 1500);
  assert.equal(hl.netCash, 1499);
  assert.equal(hl.hlCollateralAfter, 2500);
  assert.equal(hl.hlRequiredMarginAfter, 1000);
  assert.equal(hl.hlBufferAfter, 1500);
  assert.equal(hl.feasible, false);
  assert.match(hl.rejections.join(' '), /below.*target/);
  assert.equal(route(run({ minHlBuffer: 0, target: 5000 }), 'withdraw-hl').grossProceeds, 3000);
});

test('unpaired SOL sale is rejected when preserving hedge, with precise exposure delta', () => {
  const sale = route(run(), 'sell-sol');
  assert.equal(sale.feasible, false);
  assert.match(sale.rejections.join(' '), /mismatched/);
  assert.equal(sale.solAfter, 79.9398);
  assert.equal(sale.shortAfter, 100);
  assert.equal(sale.netSolExposure, -20.0602);
  assert.equal(route(run({ preserveHedge: false }), 'sell-sol').feasible, true);
});

test('paired unwind sells and closes identical quantities without counting short notional as proceeds', () => {
  const paired = route(run(), 'paired-unwind');
  assert.equal(paired.solSold, 20.0602);
  assert.equal(paired.shortReduced, paired.solSold);
  assert.equal(paired.netSolExposure, 0);
  assert.equal(paired.netCash, 2000);
  assert.equal(paired.grossProceeds, 2006.02);
  assert.equal(paired.feesFromProceeds, 6.02);
  assert.equal(paired.feesFromCollateral, 1.01);
  assert.equal(paired.fees, 7.03);
  assert.equal(paired.hlCollateralAfter, 3998.99);
  assert.equal(paired.feasible, true);
});

test('preserve hedge retains the initial net exposure, including an imperfect starting hedge', () => {
  const p = createDemoPortfolio();
  p.hyperliquid.shortSol = 80;
  const result = run({}, p);
  for (const plan of result.feasible) assert.equal(plan.netSolExposure, 20);
  const paired = route(result, 'paired-unwind');
  assert.equal(Math.round((paired.solAfter - paired.shortAfter) * 1_000_000), 20_000_000);
});

test('no-debt default rejects borrowing and every accepted route obeys it', () => {
  const result = run();
  assert.match(route(result, 'borrow-sol').rejections.join(' '), /debt limit/);
  for (const plan of result.feasible) assert.equal(plan.newDebt, 0);
});

test('borrowing remains explicitly comparison-only and carries separate interest estimate', () => {
  const plan = route(run({ maxNewDebt: 2500 }), 'borrow-sol');
  assert.equal(plan.feasible, true);
  assert.equal(plan.newDebt, 2000.5);
  assert.equal(plan.netCash, 2000);
  assert.equal(plan.fees, 0.5);
  assert.equal(plan.borrowCarryEstimate, null);
  assert.equal(plan.borrowDailyCarryEstimate, 0.44);
  assert.equal(plan.borrowAprBps, 800);
  assert.equal(plan.solAfter, 100);
  assert.equal(plan.executionSupported, false);
  assert.equal(plan.comparisonOnly, true);
  assert.match(plan.limitations.join(' '), /no borrowing adapter/);
});

test('cash deadline never becomes the loan holding period or changes estimated daily interest', () => {
  const oneDay = route(run({ maxNewDebt: 2500, deadlineHours: 24 }), 'borrow-sol');
  const twoDays = route(run({ maxNewDebt: 2500, deadlineHours: 48 }), 'borrow-sol');
  assert.equal(oneDay.borrowDailyCarryEstimate, twoDays.borrowDailyCarryEstimate);
  assert.equal(oneDay.borrowCarryEstimate, null);
  assert.equal(twoDays.borrowCarryEstimate, null);
  assert.match(twoDays.limitations.join(' '), /repayment horizon/);
});

test('hybrid withdrawal meets $4,000 while preserving asset quantity, hedge, debt and buffer', () => {
  const result = run({ target: 4000, preserveSolQuantity: true });
  const plan = result.best;
  assert.equal(plan.id, 'hybrid-lending-hl-4');
  assert.equal(plan.netCash, 4000);
  assert.equal(plan.fees, 1.25);
  assert.equal(plan.newDebt, 0);
  assert.equal(plan.solAfter, 100);
  assert.equal(plan.shortAfter, 100);
  assert.equal(plan.lendingAfter, 0);
  assert.equal(plan.hlCollateralAfter, 2998.75);
  assert.equal(plan.hlBufferAfter, 1998.75);
});

test('maximumWithoutSelling retains both positions and creates no debt', () => {
  assert.equal(run().maximumWithoutSelling, 4498.75);
  assert.equal(run({ maxNewDebt: 3000 }).maximumWithoutSelling, 4498.75);
  const feasible = run({ target: 4498.75, preserveSolQuantity: true });
  assert.equal(feasible.best.netCash, 4498.75);
  assert.equal(feasible.best.solAfter, 100);
  const infeasible = run({ target: 4498.76, preserveSolQuantity: true });
  assert.equal(infeasible.best, null);
  assert.equal(infeasible.feasible.length, 0);
});

test('paired hybrid models newly released margin and exact fee-funded collateral changes', () => {
  const result = run({ target: 6000 });
  const plan = result.best;
  assert.equal(plan.id, 'hybrid-release-4');
  assert.equal(plan.netCash, 6000);
  assert.equal(plan.solAfter, plan.shortAfter);
  assert.equal(plan.netSolExposure, 0);
  assert.equal(plan.hlBufferAfter, 1500);
  assert.equal(plan.newDebt, 0);
  assert.equal(plan.lendingAfter, 0);
  assert.ok(plan.hlRequiredMarginAfter < 1000);
  assert.equal(cents(plan.hlCollateralAfter - plan.hlRequiredMarginAfter), cents(plan.hlBufferAfter));
});

test('mixed hybrid route applies the debt cap together with hedge, sale and risk limits', () => {
  const result = run({ target: 8000, maxNewDebt: 1000 });
  const mixed = result.feasible.filter(plan => plan.newDebt > 0 && plan.solSold > 0 && plan.lendingAfter < 3000);
  assert.ok(mixed.length > 0);
  for (const plan of mixed) {
    assert.ok(plan.newDebt <= 1000);
    assert.equal(plan.netSolExposure, 0);
    assert.ok(plan.hlBufferAfter >= 1500);
    assert.ok(plan.netCash >= 8000);
    assert.ok(plan.newDebt <= plan.solAfter * 100 * 0.3 + 0.001);
  }
});

test('infeasible target produces rejected candidates with no invented winner', () => {
  const result = run({ target: 100000 });
  assert.equal(result.best, null);
  assert.equal(result.feasible.length, 0);
  assert.ok(result.plans.length > 0);
  assert.ok(result.plans.every(plan => !plan.feasible && plan.rejections.length));
});

test('short inventory limits paired unwind even when more spot SOL is held', () => {
  const p = createDemoPortfolio();
  p.hyperliquid.shortSol = 5;
  const result = run({ target: 6000 }, p);
  for (const plan of result.plans) assert.ok(plan.shortAfter >= 0);
  assert.equal(route(result, 'paired-unwind').solSold, 5);
  assert.equal(route(result, 'paired-unwind').feasible, false);
});

test('preserveSolQuantity rejects every sale, including a perfectly paired sale', () => {
  const result = run({ preserveSolQuantity: true });
  assert.match(route(result, 'paired-unwind').rejections.join(' '), /preserve-SOL-quantity/);
  assert.ok(result.feasible.every(plan => plan.solAfter === 100));
});

test('deadline rejects fixture sequences and reduces the no-sale maximum, without claiming delivery', () => {
  const result = run({ deadlineHours: 0.1 });
  assert.equal(result.maximumWithoutSelling, 2999.75);
  assert.match(route(result, 'withdraw-hl').rejections.join(' '), /deadline/);
  assert.equal(run({ deadlineHours: 0.01 }).best, null);
});

test('missing and stale snapshots block all candidate generation', () => {
  for (const modify of [p => { delete p.snapshot; }, p => { p.snapshot.complete = false; }, p => { p.snapshot.ageSeconds = 301; }]) {
    const p = createDemoPortfolio(); modify(p);
    const result = run({}, p);
    assert.ok(result.errors.length > 0);
    assert.deepEqual(result.plans, []);
    assert.equal(result.best, null);
    assert.equal(result.maximumWithoutSelling, 0);
  }
});

test('unsupported account and margin modes fail closed rather than extrapolating risk', () => {
  for (const mode of ['portfolioMargin', 'portfolio', 'isolated', undefined]) {
    const p = createDemoPortfolio(); p.hyperliquid.accountMode = mode;
    assert.match(run({}, p).errors.join(' '), /account mode/);
  }
  for (const mode of ['isolated', 'strict-isolated', 'strictIsolated', undefined]) {
    const p = createDemoPortfolio(); p.hyperliquid.marginMode = mode;
    assert.match(run({}, p).errors.join(' '), /margin mode/);
  }
});

test('invalid numeric inputs, missing data and unsupported constraints are never coerced', () => {
  for (const value of [NaN, Infinity, -1, '2000', null, 0.001]) assert.ok(run({ target: value }).errors.length);
  for (const value of [NaN, -1, undefined]) {
    const p = createDemoPortfolio(); p.hyperliquid.collateral = value;
    assert.ok(run({}, p).errors.length);
  }
  assert.ok(run({ preserveHedge: 'true' }).errors.length);
  assert.match(run({ stressMultiplier: 2 }).errors.join(' '), /Unsupported constraint/);
  assert.ok(planExit(null).errors.length);
});

test('impossible withdrawal capacities, unsupported existing debt and real-data claims fail closed', () => {
  const cases = [
    p => { p.solana.lending.withdrawCapacity = 3001; },
    p => { p.hyperliquid.freeWithdrawable = 3001; },
    p => { p.hyperliquid.collateral = 500; },
    p => { p.solana.lending.debt = 1; },
    p => { p.synthetic = false; },
    p => { p.evidence = 'live'; },
    p => { p.solana.solPrice = 0; }
  ];
  for (const modify of cases) {
    const p = createDemoPortfolio(); modify(p);
    const result = run({}, p);
    assert.ok(result.errors.length, 'invalid state should fail closed');
    assert.equal(result.plans.length, 0);
  }
});

test('zero cash target selects no action, with no fee, new debt or negative-zero values', () => {
  const result = run({ target: 0 });
  assert.equal(result.best.id, 'no-action');
  assert.deepEqual(result.best.steps, []);
  assert.equal(result.best.netCash, 0);
  assert.equal(result.best.fees, 0);
  assert.equal(result.best.borrowCarryEstimate, 0);
});

test('planning is deterministic and does not mutate the snapshot or constraints', () => {
  const p = createDemoPortfolio(), c = defaultConstraints();
  const originalP = structuredClone(p), originalC = structuredClone(c);
  const first = planExit(p, c), second = planExit(p, c);
  assert.deepEqual(first, second);
  assert.deepEqual(p, originalP);
  assert.deepEqual(c, originalC);
  first.warnings.push('local mutation');
  assert.notDeepEqual(first.warnings, planExit(p, c).warnings);
});

test('every candidate has auditable cent-denominated cash, fees and collateral conservation', () => {
  for (const patch of [{}, { target: 6000 }, { target: 8000, maxNewDebt: 1000 }, { target: 4000, preserveHedge: false }]) {
    const p = createDemoPortfolio(), result = run(patch, p);
    for (const plan of result.plans) {
      assert.equal(cents(plan.grossProceeds) - cents(plan.feesFromProceeds), cents(plan.netCash));
      assert.equal(cents(plan.feesFromProceeds) + cents(plan.feesFromCollateral), cents(plan.fees));
      assert.equal(Object.values(plan.feeBreakdown).reduce((sum, fee) => sum + cents(fee), 0), cents(plan.fees));
      const hlWithdrawal = plan.steps.find(step => step.action === 'Withdraw and transfer USDC collateral')?.amount || 0;
      assert.equal(400000 - cents(hlWithdrawal) - cents(plan.feesFromCollateral), cents(plan.hlCollateralAfter));
      assert.equal(cents(plan.hlCollateralAfter) - cents(plan.hlRequiredMarginAfter), cents(plan.hlBufferAfter));
      assert.equal(plan.evidence, 'scenario');
      assert.equal(plan.executionSupported, false);
      assert.equal(plan.feasible, plan.rejections.length === 0);
      for (const key of ['netCash', 'fees', 'newDebt', 'hlCollateralAfter', 'hlRequiredMarginAfter', 'hlBufferAfter', 'lendingAfter']) {
        assert.ok(Number.isFinite(plan[key]));
        assert.ok(Math.abs(plan[key] * 100 - cents(plan[key])) < 1e-6);
      }
      // No short notional is added to equity: collateral is already marked equity.
      const after = plan.netCash + plan.solAfter * 100 + plan.lendingAfter + plan.hlCollateralAfter - plan.newDebt;
      assert.ok(Math.abs(17000 - plan.fees - after) <= 0.011, `${plan.id} fails equity conservation`);
    }
  }
});

test('imported portfolios are accepted and labelled, scenario flag mismatches are rejected', () => {
  const imported = { ...createDemoPortfolio(), evidence: 'imported', synthetic: false };
  const result = planExit(imported, defaultConstraints());
  assert.deepEqual(result.errors, []);
  assert.equal(result.evidence, 'imported');
  assert.ok(result.plans.every(plan => plan.evidence === 'imported'));
  assert.ok(result.warnings[0].startsWith('Imported snapshot'));
  for (const bad of [{ evidence: 'imported', synthetic: true }, { evidence: 'scenario', synthetic: false }, { evidence: 'live', synthetic: false }]) {
    assert.ok(planExit({ ...createDemoPortfolio(), ...bad }, defaultConstraints()).errors.length > 0, JSON.stringify(bad));
  }
});

test('an account with no short is accepted and paired routes size to zero', () => {
  const portfolio = { ...createDemoPortfolio(), evidence: 'imported', synthetic: false };
  portfolio.hyperliquid = { ...portfolio.hyperliquid, shortSol: 0, freeWithdrawable: 3000 };
  const result = planExit(portfolio, { ...defaultConstraints(), preserveHedge: false, target: 2000 });
  assert.deepEqual(result.errors, []);
  assert.equal(result.plans.find(p => p.id === 'paired-unwind').solSold, 0);
  assert.ok(result.best);
});

test('requiredMarginCents matches the engine reserve', () => {
  assert.equal(requiredMarginCents(100, 100, 0.1), 100_000);
  assert.equal(requiredMarginCents(0, 109.69, 0.1), 0);
  assert.equal(requiredMarginCents(1.234567, 109.69, 0.1), 1355);
});

test('routes that leave Hyperliquid untouched are not rejected by the HL floor when the account already sits below it', () => {
  const p = createDemoPortfolio();
  p.hyperliquid = { ...p.hyperliquid, collateral: 1100, freeWithdrawable: 100 }; // reserve 1,000 → buffer 100, under the 1,500 floor
  const result = run({ target: 1000 }, p);
  assert.deepEqual(result.errors, []);
  assert.equal(route(result, 'withdraw-lending').feasible, true);
  assert.equal(route(result, 'withdraw-hl').feasible, false);
  assert.equal(result.maximumWithoutSelling, 2999.75);
  assert.ok(result.best);
  assert.ok(result.feasible.every(plan => plan.steps.every(step => !step.action.startsWith('Withdraw and transfer'))), 'nothing may be withdrawn from HL under the floor');
});

test('USDC already in the wallet is used first, at zero fee, and counts toward the no-sale maximum', () => {
  const p = createDemoPortfolio();
  p.solana = { ...p.solana, wallet: { usdc: 500 } };
  const small = run({ target: 300 }, p);
  assert.deepEqual(small.errors, []);
  assert.equal(small.best.fees, 0);
  assert.equal(small.best.netCash, 300);
  assert.deepEqual(small.best.steps.map(step => step.action), ['Use USDC already in the wallet']);
  assert.equal(small.best.walletUsed, 300);
  const larger = run({ target: 2000 }, p);
  assert.equal(larger.best.walletUsed, 500);
  assert.equal(larger.best.netCash, 2000);
  assert.equal(larger.best.fees, 0.25);
  assert.equal(larger.maximumWithoutSelling, 4998.75);
  const missing = createDemoPortfolio(); delete missing.solana.wallet;
  assert.ok(run({}, missing).errors.some(error => /wallet/.test(error)));
});

test('paired routes list the leveraged short reduction before the spot sale', () => {
  const paired = route(run({ target: 2000 }), 'paired-unwind');
  assert.deepEqual(paired.steps.map(step => step.action), ['Reduce SOL short by the paired quantity', 'Sell SOL for USDC']);
});

test('reducing the short alone and withdrawing the released margin is evaluated, and only allowed when net exposure may change', () => {
  // Lending (3,000) plus free collateral (1,500 under the floor) cannot reach 5,000 while keeping every SOL;
  // buying back part of the short frees 10% of its notional as withdrawable margin.
  const blocked = run({ target: 5000, preserveSolQuantity: true, preserveHedge: true });
  const blockedClose = blocked.plans.filter(plan => plan.shortReduced > 0 && plan.solSold === 0);
  assert.ok(blockedClose.length > 0, 'close-short candidates must be enumerated');
  assert.ok(blockedClose.every(plan => !plan.feasible && /net SOL exposure/.test(plan.rejections.join(' '))));
  const allowed = run({ target: 5000, preserveSolQuantity: true, preserveHedge: false });
  const closeOnly = allowed.feasible.filter(plan => plan.shortReduced > 0 && plan.solSold === 0);
  assert.ok(closeOnly.length > 0, 'a close-short route must be feasible once exposure may change');
  const best = closeOnly[0];
  assert.equal(best.solAfter, 100);
  assert.ok(best.shortAfter < 100);
  assert.ok(best.netCash >= 5000);
  assert.ok(best.steps.some(step => step.action === 'Reduce SOL short'));
  assert.ok(best.steps.some(step => step.action.startsWith('Withdraw and transfer')));
  assert.ok(best.hlBufferAfter >= 1500);
  assert.ok(route(allowed, 'close-short'), 'a stable baseline id exists');
});

test('sales never size to the full SOL balance: 0.01 SOL stays for rent and fees', () => {
  const p = createDemoPortfolio();
  p.solana = { ...p.solana, sol: 2, lending: { usdc: 0, debt: 0, withdrawCapacity: 0 } };
  p.hyperliquid = { ...p.hyperliquid, shortSol: 0 };
  const result = run({ target: 100000, preserveHedge: false }, p);
  assert.ok(result.plans.every(plan => plan.solSold <= 1.99), 'no plan may sell the last 0.01 SOL');
  const sale = route(run({ target: 190, preserveHedge: false }, p), 'sell-sol');
  assert.equal(sale.feasible, true);
  assert.ok(sale.solAfter >= 0.01);
});

test('a unified Hyperliquid account mode is accepted alongside standard', () => {
  const portfolio = createDemoPortfolio();
  portfolio.hyperliquid.accountMode = 'unified';
  const result = planExit(portfolio, defaultConstraints());
  assert.deepEqual(result.errors, []);
  assert.ok(result.feasible.length > 0);
  portfolio.hyperliquid.accountMode = 'portfolio-margin';
  assert.ok(planExit(portfolio, defaultConstraints()).errors.some(line => /account mode/.test(line)));
});

test('each route reports the yearly carry it gives up: funding on the short reduced plus supply yield on the deposit withdrawn', () => {
  const result = planExit(createDemoPortfolio(), defaultConstraints());
  const byId = Object.fromEntries(result.plans.map(p => [p.id, p]));
  assert.equal(byId['withdraw-lending'].carryPerYear, 100.01); // $2,000.25 × 5% supply APY
  assert.deepEqual(byId['withdraw-lending'].carryBreakdown, { funding: 0, lendingYield: 100.01 });
  assert.equal(byId['paired-unwind'].carryPerYear, 160.48); // 20.0602 SOL × $100 × 8% funding
  assert.deepEqual(byId['paired-unwind'].carryBreakdown, { funding: 160.48, lendingYield: 0 });
  assert.equal(byId['withdraw-hl'].carryPerYear, 0);
  assert.equal(result.best.id, 'withdraw-lending', 'ranking stays by upfront fees');
  const negative = createDemoPortfolio(); negative.hyperliquid.fundingApr = -0.05;
  assert.equal(planExit(negative, defaultConstraints()).plans.find(p => p.id === 'paired-unwind').carryPerYear, -100.3, 'negative funding: reducing the short saves carry');
  const unknown = createDemoPortfolio(); unknown.hyperliquid.fundingApr = null;
  const plans = planExit(unknown, defaultConstraints()).plans;
  assert.equal(plans.find(p => p.id === 'paired-unwind').carryPerYear, null);
  assert.equal(plans.find(p => p.id === 'paired-unwind').carryBreakdown.funding, null);
  assert.equal(plans.find(p => p.id === 'withdraw-lending').carryPerYear, 100.01, 'a route that leaves the short alone keeps its carry figure');
  assert.equal(plans.find(p => p.id === 'withdraw-hl').carryPerYear, 0);
});

test('carry rates are validated: finite, funding within ±500%, supply APY within 0–500%, and may be absent', () => {
  for (const [path, value] of [['hyperliquid.fundingApr', 'abc'], ['hyperliquid.fundingApr', 7], ['hyperliquid.fundingApr', -7], ['solana.lending.supplyApy', -0.1], ['solana.lending.supplyApy', Infinity]]) {
    const p = createDemoPortfolio(); const [root, ...rest] = path.split('.'); let o = p[root]; for (const k of rest.slice(0, -1)) o = o[k]; o[rest.at(-1)] = value;
    assert.ok(planExit(p, defaultConstraints()).errors.some(e => e.includes(path)), `${path}=${value} should be rejected`);
  }
  const p = createDemoPortfolio(); delete p.hyperliquid.fundingApr; delete p.solana.lending.supplyApy;
  const r = planExit(p, defaultConstraints());
  assert.deepEqual(r.errors, []);
  assert.equal(r.plans.find(x => x.id === 'paired-unwind').carryPerYear, null);
  assert.equal(r.plans.find(x => x.id === 'withdraw-lending').carryPerYear, null);
});

test('a Hyperliquid lot size snaps every short reduction (and its paired sale) to placeable quantities', () => {
  const plain = planExit(createDemoPortfolio(), defaultConstraints());
  assert.equal(plain.plans.find(p => p.id === 'paired-unwind').shortReduced, 20.0602, 'no lot size: micro-SOL precision as before');
  const lots = createDemoPortfolio(); lots.hyperliquid.lotSize = 0.01;
  const result = planExit(lots, defaultConstraints());
  const paired = result.plans.find(p => p.id === 'paired-unwind');
  assert.equal(paired.shortReduced, 20.07, 'the smallest 0.01 multiple whose sale nets the target');
  assert.equal(paired.solSold, 20.07);
  assert.ok(paired.feasible);
  for (const p of result.plans) {
    if (p.shortReduced > 0) assert.equal(Math.round(p.shortReduced * 100) / 100, p.shortReduced, `${p.id}: short reduction ${p.shortReduced} is not a 0.01 multiple`);
  }
  const closeOnly = planExit(lots, { ...defaultConstraints(), preserveHedge: false }).plans.find(p => p.id === 'close-short');
  assert.equal(Math.round(closeOnly.shortReduced * 100) / 100, closeOnly.shortReduced);
  assert.ok(closeOnly.shortReduced > 0);
});

test('a minimum order value rejects short reductions the exchange would not accept, without hiding other routes', () => {
  const p = createDemoPortfolio(); p.solana.wallet.usdc = 1995; p.hyperliquid.lotSize = 0.01; p.hyperliquid.minOrderUsd = 10;
  const result = planExit(p, defaultConstraints());
  const paired = result.plans.find(x => x.id === 'paired-unwind');
  assert.equal(paired.shortReduced, 0.06);
  assert.equal(paired.feasible, false);
  assert.ok(paired.rejections.some(r => /\$10\.00 minimum order/.test(r)), paired.rejections.join(' | '));
  assert.ok(result.plans.find(x => x.id === 'withdraw-lending').feasible);
  const noMinimum = planExit({ ...p, hyperliquid: { ...p.hyperliquid, minOrderUsd: 0 } }, defaultConstraints());
  assert.ok(noMinimum.plans.find(x => x.id === 'paired-unwind').feasible);
});

test('lot size and minimum order value are validated when present', () => {
  for (const [key, value] of [['lotSize', 0], ['lotSize', -0.01], ['lotSize', 2], ['lotSize', 0.0000005], ['lotSize', 'x'], ['minOrderUsd', -1], ['minOrderUsd', Infinity]]) {
    const p = createDemoPortfolio(); p.hyperliquid[key] = value;
    assert.ok(planExit(p, defaultConstraints()).errors.some(e => e.includes(`hyperliquid.${key}`)), `${key}=${value} should be rejected`);
  }
});

test('lot size and minimum order hold across a grid of lots, targets and constraints: placeable quantities, no NaN, feasible routes meet the target', () => {
  let feasibleCount = 0;
  for (const lotSize of [0.000001, 0.001, 0.01, 0.1, 1]) {
    for (const target of [50, 500, 2000, 4498.75, 6000]) {
      for (const preserveHedge of [true, false]) {
        for (const wallet of [0, 1995]) {
          const p = createDemoPortfolio(); p.hyperliquid.lotSize = lotSize; p.hyperliquid.minOrderUsd = 10; p.solana.wallet.usdc = wallet;
          const result = planExit(p, { ...defaultConstraints(), target, preserveHedge });
          assert.deepEqual(result.errors, [], `${lotSize}/${target}/${preserveHedge}/${wallet}: ${result.errors.join(' | ')}`);
          const units = Math.round(lotSize * 1e6);
          for (const plan of result.plans) {
            for (const [key, value] of Object.entries(plan)) if (typeof value === 'number') assert.ok(Number.isFinite(value), `${plan.id}.${key} is ${value}`);
            const reduced = Math.round(plan.shortReduced * 1e6);
            assert.equal(reduced % units, 0, `${plan.id}: short reduction ${plan.shortReduced} is not a ${lotSize} multiple (lot ${lotSize}, target ${target})`);
            if (plan.shortReduced > 0 && plan.feasible) assert.ok(plan.shortReduced * p.hyperliquid.markPrice >= 10 - 1e-9, `${plan.id}: feasible reduction below the minimum order`);
            if (plan.feasible) { assert.ok(plan.netCash >= target, `${plan.id}: net ${plan.netCash} < target ${target}`); feasibleCount += 1; }
          }
        }
      }
    }
  }
  assert.ok(feasibleCount > 100, `grid produced ${feasibleCount} feasible plans`);
});

test('routes that collapse to the same allocation are listed once, whichever family produced them', () => {
  const result = planExit(createDemoPortfolio(), { ...defaultConstraints(), target: 1000 });
  const signatures = result.plans.map(p => JSON.stringify([p.walletUsed, p.lendingAfter, p.hlCollateralAfter, p.solSold, p.shortReduced, p.newDebt]));
  assert.equal(new Set(signatures).size, signatures.length, 'duplicate allocations: ' + signatures.filter((s, i) => signatures.indexOf(s) !== i).join(' | '));
  assert.ok(!result.plans.some(p => p.id === 'close-short'), 'a zero-size short reduction is the plain HL withdrawal, not a second route');
  assert.ok(result.plans.some(p => p.id === 'withdraw-hl' && p.feasible));
  const bigger = planExit(createDemoPortfolio(), { ...defaultConstraints(), target: 2000, preserveHedge: false });
  assert.ok(bigger.plans.some(p => p.id === 'close-short' && p.shortReduced > 0), 'a real reduction stays its own route');
});

test('carry keeps parts-per-million precision instead of rounding the rate to whole basis points', () => {
  const p = createDemoPortfolio(); p.hyperliquid.fundingApr = 0.00005; // 0.005% a year
  const paired = planExit(p, defaultConstraints()).plans.find(x => x.id === 'paired-unwind');
  assert.equal(paired.carryBreakdown.funding, 0.1); // 2,006.02 × 0.00005 = $0.10, not $0.20 from a 1 bps rounding
});

test('a slippage allowance on short reductions is charged to HL collateral like the close fee and shown in the breakdown', () => {
  const base = planExit(createDemoPortfolio(), defaultConstraints()).plans.find(p => p.id === 'paired-unwind');
  assert.equal(base.feeBreakdown.shortSlippage, 0);
  const p = createDemoPortfolio(); p.fees.hlSlippageBps = 10;
  const withSlip = planExit(p, defaultConstraints()).plans.find(x => x.id === 'paired-unwind');
  const allowance = Math.ceil(20.0602 * 100 * 0.001 * 100) / 100; // $2.01 on $2,006.02 of notional
  assert.equal(withSlip.feeBreakdown.shortSlippage, allowance);
  assert.equal(withSlip.feesFromCollateral, Math.round((base.feesFromCollateral + allowance) * 100) / 100);
  assert.equal(withSlip.hlCollateralAfter, Math.round((base.hlCollateralAfter - allowance) * 100) / 100);
  assert.equal(withSlip.fees, Math.round((base.fees + allowance) * 100) / 100);
  assert.equal(withSlip.netCash, base.netCash, 'slippage comes out of collateral, not cash');
  for (const value of [-1, 10001, 1.5, 'x']) {
    const bad = createDemoPortfolio(); bad.fees.hlSlippageBps = value;
    assert.ok(planExit(bad, defaultConstraints()).errors.some(err => err.includes('fees.hlSlippageBps')), `${value} rejected`);
  }
  const absent = createDemoPortfolio(); delete absent.fees.hlSlippageBps;
  assert.deepEqual(planExit(absent, defaultConstraints()).errors, []);
});
