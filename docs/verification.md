# Verification — 2026-10-11

`node --test tests/*.test.mjs`: 209 tests passed, 0 failed.

- 27 engine tests (deterministic planner, imported evidence, zero-short account, reserve helper) and 1 conservation grid over 650 feasible scenario plans
- Hyperliquid, Solana and rehearsal adapter tests on captured real API responses in `tests/fixtures/`, plus server-side Kamino simulation tests with an injected fake SDK that pins the exact build and simulate calls
- 17 legacy server-side Hyperliquid market tests, 9 intent unit tests, 39 server security tests (origin host check, per-IP limiter, body caps, model-output validation)
- 30 LinkeDOM tests that run the real app module: guided scenarios, controls and reset, AI proposals and late-response races, rehearsal, import by address, import failure and debt cases, import races (reset, source switch, constraint edit), read-only simulation in the rehearsal, guide hiding

Live checks on 2026-10-11 (read-only): the Solana and Hyperliquid demo addresses in `docs/demo-addresses.md` imported through the real adapters; the paired-unwind route was feasible at a $300 target; `simulateSellSol` on the unsigned Jupiter swap succeeded (about 80–92k compute units, 48 log lines). All four public hosts answered browser CORS preflights. Production at https://exitplan-rouge.vercel.app served the UI and adapters with the CSP from `vercel.json`; `/api/status` reported `aiConfigured: true` after the secrets were set, and two live `/api/intent` calls returned proposals: a clear request mapped to `target 3000, preserveSolQuantity true` in 2.8 s, and an ambiguous request returned four clarifying questions instead of a guess (the UI withholds the apply button while questions remain).

Real-browser check on 2026-10-11 21:40 UTC+4 (Playwright driving the installed Google Chrome, headless, against production): page load 1.8 s, no console errors or failed requests, public example imported (account mode verified, wallet USDC detected), paired route selected, liquidation card rendered, sell-leg simulation succeeded (75,547 CU, quoted $164.44 vs plan estimate $163.61), AI proposal returned and applied after confirmation, plan link copied with every constraint, phone width (390 px) without horizontal overflow, deep link loaded positions.

Not performed: a production security audit, simulation of the Hyperliquid legs, or any transaction submission.
