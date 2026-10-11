import test from 'node:test';
import assert from 'node:assert/strict';
import { run, parseArgs, USAGE } from '../bin/exitplan.mjs';
import { publicStub, WALLET, HL } from './helpers/public-stub.mjs';

const capture = () => { const chunks = []; return { write: text => chunks.push(text), text: () => chunks.join('') }; };

test('the terminal command prints the same pre-flight report from the same adapters and engine, read-only', async () => {
  const { fetchImpl, calls } = await publicStub();
  const out = capture();
  const code = await run(['--sol', WALLET, '--hl', HL, '--target', '500'], { fetchImpl, write: out.write, now: () => new Date('2026-10-12T00:00:00Z') });
  assert.equal(code, 0);
  const text = out.text();
  assert.match(text, /^# ExitPlan pre-flight report · 2026-10-12 00:00 UTC/);
  assert.match(text, /Account mode: ok/);
  assert.match(text, /## Routes \(ranked by upfront fees\)/);
  assert.match(text, /1\. \[selected\] .* — net \$5\d\d\.\d\d/);
  assert.match(text, /carry given up/);
  assert.match(text, /Plan link: https:\/\/exitplan-rouge\.vercel\.app\/#sol=DrED/);
  assert.match(text, /target=500/);
  assert.ok(calls.every(call => call.host !== 'api.hyperliquid.xyz' || call.path === '/info'), 'only the read-only info endpoint');
  assert.ok(!calls.some(call => call.type === 'sendTransaction'));
});

test('--json returns the engine result with the read-only flags, and constraint flags map onto the engine', async () => {
  const { fetchImpl } = await publicStub();
  const out = capture();
  const code = await run(['--sol', WALLET, '--hl', HL, '--target', '500', '--keep-sol', '--no-hedge', '--min-buffer', '100', '--json'], { fetchImpl, write: out.write });
  assert.equal(code, 0);
  const payload = JSON.parse(out.text());
  assert.equal(payload.readOnly, true);
  assert.equal(payload.executionSupported, false);
  assert.deepEqual([payload.constraints.preserveSolQuantity, payload.constraints.preserveHedge, payload.constraints.minHlBuffer], [true, false, 100]);
  assert.ok(Array.isArray(payload.result.feasible));
  assert.equal(payload.portfolio.evidence, 'imported');
  assert.equal(payload.portfolio.hyperliquid.lotSize, 0.01);
});

test('bad input exits with usage, and an adapter failure exits non-zero with the reason', async () => {
  const out = capture();
  assert.equal(await run(['--sol', 'nope', '--hl', HL], { write: out.write }), 2);
  assert.match(out.text(), /Invalid or missing Solana wallet address/);
  const out2 = capture();
  assert.equal(await run(['--sol', WALLET, '--hl', HL, '--target', 'abc'], { write: out2.write }), 2);
  assert.match(out2.text(), /--target needs a number/);
  const out3 = capture();
  assert.equal(await run(['--help'], { write: out3.write }), 0);
  assert.equal(out3.text(), USAGE);
  const failing = async () => new Response('down', { status: 503 });
  const out4 = capture();
  assert.equal(await run(['--sol', WALLET, '--hl', HL], { fetchImpl: failing, write: out4.write }), 1);
  assert.match(out4.text(), /Could not load positions/);
  assert.deepEqual(parseArgs(['--sol', WALLET, '--hl', HL]).target, 2000);
});

test('constraint ranges are validated before any network call, an unknown --select is refused, and engine errors reach the report', async () => {
  const noNetwork = async () => { throw new Error('must not fetch'); };
  const bad = capture();
  assert.equal(await run(['--sol', WALLET, '--hl', HL, '--target', '-5'], { fetchImpl: noNetwork, write: bad.write }), 2);
  assert.match(bad.text(), /--target must be/);
  const { fetchImpl } = await publicStub();
  const unknown = capture();
  assert.equal(await run(['--sol', WALLET, '--hl', HL, '--select', 'nope'], { fetchImpl, write: unknown.write }), 2);
  assert.match(unknown.text(), /unknown route id/i);
});

test('the report lists each rejected route name once, keeping the attempt closest to the target', async () => {
  const { fetchImpl } = await publicStub();
  const out = capture();
  assert.equal(await run(['--sol', WALLET, '--hl', HL, '--target', '3000', '--no-hedge'], { fetchImpl, write: out.write }), 0);
  const section = out.text().split('## Rejected routes')[1].split('\n\n')[0];
  const names = section.split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2).split(' — ')[0]);
  assert.ok(names.length > 0);
  assert.equal(new Set(names).size, names.length, 'duplicate rejected names: ' + names.join(' | '));
});

test('--select of a rejected route exits with its reason instead of a report with nothing selected', async () => {
  const { fetchImpl } = await publicStub();
  const out = capture();
  assert.equal(await run(['--sol', WALLET, '--hl', HL, '--target', '500', '--select', 'sell-sol'], { fetchImpl, write: out.write }), 2);
  assert.match(out.text(), /not feasible/i);
  assert.match(out.text(), /net SOL exposure/);
});
