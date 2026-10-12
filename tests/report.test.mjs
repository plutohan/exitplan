import test from 'node:test';
import assert from 'node:assert/strict';
import { importSolana } from '../web/adapters/solana.mjs';
import { importHyperliquid } from '../web/adapters/hyperliquid.mjs';
import { defaultConstraints, planExit, createDemoPortfolio } from '../web/engine.mjs';
import { buildImportedPortfolio, buildReport, preflightChecks, planName, stepName, rejectionText, carryText, initialHlBuffer, money, positionCell } from '../web/report.mjs';
import { publicStub, WALLET, HL } from './helpers/public-stub.mjs';

test('report helpers are pure: names, rejection reasons, carry text and the buffer work without a DOM', async () => {
  const demo = planExit(createDemoPortfolio(), defaultConstraints());
  const paired = demo.plans.find(p => p.id === 'paired-unwind');
  assert.equal(planName(paired), 'Trim spot and short together');
  assert.equal(stepName(paired.steps[0]), 'Reduce SOL short by the same amount');
  assert.deepEqual(carryText(paired), ['Carry given up', '$160.48/yr']);
  const sale = demo.plans.find(p => p.id === 'sell-sol');
  assert.match(rejectionText(sale, defaultConstraints(), initialHlBuffer(createDemoPortfolio())), /changes net SOL exposure/);
  assert.equal(initialHlBuffer(createDemoPortfolio()), 3000);
});

test('the pre-flight checks and the report come from the imported state alone', async () => {
  const { fetchImpl } = await publicStub();
  const [solana, hyperliquid] = await Promise.all([importSolana(WALLET, { fetchImpl }), importHyperliquid(HL, { fetchImpl })]);
  const portfolio = buildImportedPortfolio(solana, hyperliquid);
  assert.equal(portfolio.fees.hlCloseBps, 4, 'taker rate from the account');
  assert.equal(portfolio.fees.hlSlippageBps, 10, 'a 10 bps execution allowance on short reductions for imported routes');
  const constraints = { ...defaultConstraints(), target: 500 };
  const checks = preflightChecks({ imported: { solana, hyperliquid }, portfolio, constraints });
  assert.ok(checks.find(c => c.label === 'Account mode' && c.status === 'ok'));
  assert.ok(checks.find(c => c.label === 'Carry' && /7-day average/.test(c.detail)));
  const result = planExit(portfolio, constraints);
  const text = buildReport({ imported: { solana, hyperliquid }, portfolio, result, constraints, selectedId: result.best.id, link: 'https://example.test/#x', now: () => new Date('2026-10-12T01:02:00Z') });
  assert.match(text, /^# ExitPlan pre-flight report · 2026-10-12 01:02 UTC/);
  assert.match(text, /- Account mode: ok · verified on HyperCore/);
  assert.match(text, /Plan link: https:\/\/example\.test\/#x/);
  assert.equal(text.split('\n').filter(line => /^\d+\. /.test(line)).length, result.feasible.length);
});

test('route names say which venue the cash comes from, rejection reasons read as plain English, and money always shows cents when there are any', () => {
  const base = { id: 'x', family: 'hybrid', walletUsed: 0, newDebt: 0, solSold: 1, shortReduced: 1 };
  const hl = { venue: 'Hyperliquid → Solana (fixture)', action: 'Withdraw and transfer USDC collateral', amount: 10, unit: 'USDC' };
  const lend = { venue: 'Solana lending (fixture)', action: 'Withdraw lending USDC', amount: 10, unit: 'USDC' };
  assert.equal(planName({ ...base, steps: [hl] }), 'HL collateral + trim spot and short');
  assert.equal(planName({ ...base, steps: [lend] }), 'Withdraw deposits + trim spot and short');
  assert.equal(planName({ ...base, steps: [lend, hl] }), 'Withdraw deposits + HL collateral + trim spot and short');
  const c = { ...defaultConstraints(), preserveSolQuantity: true };
  const plan = { netCash: 2000, solSold: 1, shortReduced: 1, newDebt: 0, hlBufferAfter: 100, estimatedHours: 1 };
  const text = rejectionText(plan, c, 3000);
  assert.match(text, /Sells SOL while keep-SOL-quantity is on/);
  assert.match(text, /Leaves the Hyperliquid buffer below your \$1,500 floor/);
  assert.equal(rejectionText({ netCash: 2000, solSold: 0, shortReduced: 0, newDebt: 0, hlBufferAfter: 3000, estimatedHours: 1 }, defaultConstraints(), 3000), 'Needs more than the available balance, collateral or position allows');
  assert.equal(money(336.4), '$336.40');
  assert.equal(money(500), '$500');
  assert.equal(money(500, true), '$500.00');
  assert.equal(money(1234.5), '$1,234.50');
});

test('engine errors are printed in the report instead of a plausible empty route list', async () => {
  const { fetchImpl } = await publicStub();
  const [solana, hyperliquid] = await Promise.all([importSolana(WALLET, { fetchImpl }), importHyperliquid(HL, { fetchImpl })]);
  const portfolio = buildImportedPortfolio(solana, hyperliquid);
  const constraints = { ...defaultConstraints(), target: -1 };
  const result = planExit(portfolio, constraints);
  assert.ok(result.errors.length > 0);
  const text = buildReport({ imported: { solana, hyperliquid }, portfolio, result, constraints, link: 'x' });
  assert.match(text, /## Errors/);
  assert.match(text, new RegExp(result.errors[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('the carry check labels a short funding history by its real span', async () => {
  const hour = 3_600_000, start = 1_791_000_000_000;
  const { fetchImpl } = await publicStub({ funding: Array.from({ length: 10 }, (_, i) => ({ coin: 'SOL', fundingRate: '0.00001', premium: '0', time: start + i * hour })) });
  const [solana, hyperliquid] = await Promise.all([importSolana(WALLET, { fetchImpl }), importHyperliquid(HL, { fetchImpl })]);
  const portfolio = buildImportedPortfolio(solana, hyperliquid);
  const carry = preflightChecks({ imported: { solana, hyperliquid }, portfolio, constraints: defaultConstraints() }).find(c => c.label === 'Carry');
  assert.match(carry.detail, /10-hour average/);
  assert.doesNotMatch(carry.detail, /7-day/);
});


test('a position cell never renders a missing value as $0', () => {
  assert.equal(positionCell(null, true), '—');
  assert.equal(positionCell(undefined, false), '—');
  assert.equal(positionCell(NaN, true), '—');
  assert.equal(positionCell(0, true), '$0');
  assert.equal(positionCell(123.456, true), '$123.46');
  assert.match(positionCell(1.5, false), /1\.5/);
});
