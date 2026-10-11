# Verification — 2026-10-11

`node --test tests/*.test.mjs`: 147 tests passed, 0 failed.

- 27 engine tests (deterministic planner, imported evidence, zero-short account, reserve helper) and 1 conservation grid over 650 feasible scenario plans
- 13 Hyperliquid adapter tests, 7 Solana adapter tests, 4 rehearsal simulation tests, all on captured real API responses in `tests/fixtures/`
- 17 legacy server-side Hyperliquid market tests, 9 intent unit tests, 39 server security tests (origin host check, per-IP limiter, body caps, model-output validation)
- 30 LinkeDOM tests that run the real app module: guided scenarios, controls and reset, AI proposals and late-response races, rehearsal, import by address, import failure and debt cases, import races (reset, source switch, constraint edit), read-only simulation in the rehearsal, guide hiding

Live checks on 2026-10-11 (read-only): the Solana and Hyperliquid demo addresses in `docs/demo-addresses.md` imported through the real adapters; the paired-unwind route was feasible at a $300 target; `simulateSellSol` on the unsigned Jupiter swap succeeded (about 80–92k compute units, 48 log lines). All four public hosts answered browser CORS preflights. Production at https://exitplan-rouge.vercel.app served the UI and adapters with the CSP from `vercel.json`; `/api/status` reported `aiConfigured: true` after the secrets were set.

Not performed: browser visual QA by automation, a production security audit, verification of Hyperliquid account modes, or any transaction submission.
