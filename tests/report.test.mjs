import test from 'node:test';
import assert from 'node:assert/strict';
import { importSolana } from '../web/adapters/solana.mjs';
import { importHyperliquid } from '../web/adapters/hyperliquid.mjs';
import { defaultConstraints, planExit, createDemoPortfolio } from '../web/engine.mjs';
import { buildImportedPortfolio, buildReport, preflightChecks, planName, stepName, rejectionText, carryText, initialHlBuffer } from '../web/report.mjs';
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
