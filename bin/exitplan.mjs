#!/usr/bin/env node
/** Terminal pre-flight: the same read-only import, route engine and report as the web app. Never signs or sends. */
import { pathToFileURL } from 'node:url';
import { importSolana, isSolanaAddress } from '../web/adapters/solana.mjs';
import { importHyperliquid } from '../web/adapters/hyperliquid.mjs';
import { defaultConstraints, planExit } from '../web/engine.mjs';
import { buildImportedPortfolio, buildReport } from '../web/report.mjs';

export const USAGE = `exitplan --sol <solana wallet> --hl <0x hyperliquid address> [--target 2000] [--max-debt 0] [--min-buffer 1500] [--deadline 24] [--keep-sol] [--no-hedge] [--select <route id>] [--json]
Read-only pre-flight check for unwinding a Solana–Hyperliquid SOL hedge. Prints the plain-text report (or JSON). Nothing is signed or sent.
`;
const SITE = 'https://exitplan-rouge.vercel.app';

export function parseArgs(argv) {
  const args = { target: 2000, maxDebt: 0, minBuffer: 1500, deadline: 24, keepSol: false, noHedge: false, json: false, help: false, select: null, sol: '', hl: '' };
  const numeric = { '--target': 'target', '--max-debt': 'maxDebt', '--min-buffer': 'minBuffer', '--deadline': 'deadline' };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--help' || flag === '-h') args.help = true;
    else if (flag === '--keep-sol') args.keepSol = true;
    else if (flag === '--no-hedge') args.noHedge = true;
    else if (flag === '--json') args.json = true;
    else if (flag === '--sol' || flag === '--hl' || flag === '--select') { args[flag.slice(2)] = String(argv[i + 1] ?? ''); i += 1; }
    else if (flag in numeric) { const value = Number(argv[i + 1]); if (!Number.isFinite(value)) throw new Error(`${flag} needs a number`); args[numeric[flag]] = value; i += 1; }
    else throw new Error(`Unknown option ${flag}`);
  }
  return args;
}

export async function run(argv, { fetchImpl = globalThis.fetch, write = (text) => process.stdout.write(text), now = () => new Date() } = {}) {
  let args;
  try { args = parseArgs(argv); } catch (error) { write(`${error.message}\n${USAGE}`); return 2; }
  if (args.help) { write(USAGE); return 0; }
  if (!isSolanaAddress(args.sol)) { write(`Invalid or missing Solana wallet address.\n${USAGE}`); return 2; }
  if (!/^0x[0-9a-fA-F]{40}$/.test(args.hl)) { write(`Invalid or missing Hyperliquid address (0x + 40 hex).\n${USAGE}`); return 2; }
  for (const [flag, value, min] of [['--target', args.target, 0], ['--max-debt', args.maxDebt, 0], ['--min-buffer', args.minBuffer, 0], ['--deadline', args.deadline, 0.01]]) {
    if (!Number.isFinite(value) || value < min) { write(`${flag} must be a number of at least ${min}.\n${USAGE}`); return 2; }
  }
  let solana, hyperliquid;
  try {
    [solana, hyperliquid] = await Promise.all([importSolana(args.sol, { fetchImpl }), importHyperliquid(args.hl, { fetchImpl })]);
  } catch (error) {
    write(`Could not load positions: ${error.code ? `${error.code}: ` : ''}${error.message}\n`);
    return 1;
  }
  const imported = { solana, hyperliquid };
  const portfolio = buildImportedPortfolio(solana, hyperliquid);
  const constraints = { ...defaultConstraints(), target: args.target, maxNewDebt: args.maxDebt, minHlBuffer: args.minBuffer, deadlineHours: args.deadline, preserveHedge: !args.noHedge, preserveSolQuantity: args.keepSol };
  const result = planExit(portfolio, constraints);
  if (args.select && !result.plans.some((plan) => plan.id === args.select)) { write(`Unknown route id "${args.select}". Known: ${result.plans.map((plan) => plan.id).join(', ')}\n`); return 2; }
  const selectedId = args.select ?? result.best?.id ?? null;
  const params = new URLSearchParams({ sol: args.sol, hl: args.hl });
  for (const key of ['target', 'maxNewDebt', 'minHlBuffer', 'deadlineHours', 'preserveHedge', 'preserveSolQuantity']) params.set(key, String(constraints[key]));
  const link = `${SITE}/#${params.toString()}`;
  if (args.json) {
    write(`${JSON.stringify({ readOnly: true, executionSupported: false, constraints, portfolio, result, link, assumptions: { solana: solana.assumptions, hyperliquid: hyperliquid.assumptions } }, null, 2)}\n`);
  } else {
    write(`${buildReport({ imported, portfolio, result, constraints, selectedId, link, now })}\n`);
  }
  return result.errors.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).then((code) => process.exit(code), (error) => { process.stderr.write(`${error.message}\n`); process.exit(1); });
}
