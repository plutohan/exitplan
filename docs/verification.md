# Verification — 2026-10-11

`node --test tests/*.test.mjs`: 296 tests passed, 0 failed (2026-10-13; the dated entries below record the count at the time).

- 27 engine tests (deterministic planner, imported evidence, zero-short account, reserve helper) and 1 conservation grid over 650 feasible scenario plans
- Hyperliquid, Solana and rehearsal adapter tests on captured real API responses in `tests/fixtures/`, plus server-side Kamino simulation tests with an injected fake SDK that pins the exact build and simulate calls
- 17 legacy server-side Hyperliquid market tests, 9 intent unit tests, 39 server security tests (origin host check, per-IP limiter, body caps, model-output validation)
- 30 LinkeDOM tests that run the real app module: guided scenarios, controls and reset, AI proposals and late-response races, rehearsal, import by address, import failure and debt cases, import races (reset, source switch, constraint edit), read-only simulation in the rehearsal, guide hiding

Live checks on 2026-10-11 (read-only): the Solana and Hyperliquid demo addresses in `docs/demo-addresses.md` imported through the real adapters; the paired-unwind route was feasible at a $300 target; `simulateSellSol` on the unsigned Jupiter swap succeeded (about 80–92k compute units, 48 log lines). All four public hosts answered browser CORS preflights. Production at https://exitplan-rouge.vercel.app served the UI and adapters with the CSP from `vercel.json`; `/api/status` reported `aiConfigured: true` after the secrets were set, and two live `/api/intent` calls returned proposals: a clear request mapped to `target 3000, preserveSolQuantity true` in 2.8 s, and an ambiguous request returned four clarifying questions instead of a guess (the UI withholds the apply button while questions remain).

Real-browser check on 2026-10-11 21:40 UTC+4 (Playwright driving the installed Google Chrome, headless, against production): page load 1.8 s, no console errors or failed requests, public example imported (account mode verified, wallet USDC detected), paired route selected, liquidation card rendered, sell-leg simulation succeeded (75,547 CU, quoted $164.44 vs plan estimate $163.61), AI proposal returned and applied after confirmation, plan link copied with every constraint, phone width (390 px) without horizontal overflow, deep link loaded positions.

Not performed: a production security audit, simulation of the Hyperliquid legs, or any transaction submission.

## Additions on 2026-10-12 (UTC+4, overnight improvement loop)

`node --test tests/*.test.mjs`: 279 tests passed, 0 failed, including the terminal command (`tests/cli.test.mjs`), the shared report module (`tests/report.test.mjs`), a lot-size and minimum-order property grid, and the public-API stub in `tests/helpers/public-stub.mjs` that fails on any host or endpoint the adapters are not allowed to call.

Live, read-only, in headless Google Chrome against production after each deploy: the standard public account's model free collateral equalled Hyperliquid's reported withdrawable within a cent ($5,444.93 vs $5,444.94) and the unified public account's to the cent ($15,436.60); the pre-flight readout rendered ten checks; the reduce-short rehearsal step walked the live SOL book ("buying back 1.48 SOL walks 1 level to an average $111.28 … taker fee $0.06 at 3.825 bps … book age 1s") and showed the unsigned reduce-only IOC order; the Kamino and Jupiter simulations still succeeded; the pre-flight report copied at 1280 px and 390 px with no horizontal overflow; `node bin/exitplan.mjs` produced the same 31-line report from both public accounts. Only the public `info` endpoint of Hyperliquid was ever called (request log checked in Chrome).

Independent reviews applied during the loop: Claude Opus (two rounds) and Codex at maximum reasoning (one round; a second was blocked by the account's usage limit). Findings fixed are listed in the commit messages from d54e98d onward.

Later on 2026-10-12 (UTC+4), after each deploy, in headless Google Chrome against production: every deep link in `docs/demo-addresses.md` behaved as documented (rejections render in about 1.1 s and no further requests follow); the Kamino simulation's Solana Explorer inspector link deserialized the unsigned transaction (829 bytes); the reduce-short preview reported the live walk against the 10 bps allowance and showed the inner unsigned order with canonical strings; the AI panel returned a confirmable proposal in 4.0 s; the pre-flight report copied at 1280 px and 390 px with no horizontal overflow; the account owner's own `default`-mode account loaded and was flagged as not establishable (no perps equity yet). `node --test tests/*.test.mjs`: 279 tests passed.

Reviews applied during the loop: Claude Opus (two code reviews and one cold judge pass) and Codex at maximum reasoning (two rounds). Findings and fixes are in the commit messages from d54e98d onward.

Final checks on 2026-10-12 around 03:00 UTC+4, after the last code change (fb1c855): `node --test tests/*.test.mjs` 271 passed; in headless Chrome against production the hero button imported the public example at a $500 goal with the paired route selected, one click opened the rehearsal, the Hyperliquid book walk reported the limit at 9.9 bps above mark (inside the 10 bps allowance) with the inner unsigned order, the Kamino and Jupiter simulations succeeded with Explorer inspector links, the dialog did not clip at 390 px, every documented example deep link behaved as documented, and the account owner's own `default`-mode address loaded with the mode flagged as not establishable. During one check Jupiter's swap-quote service returned 503; the import now falls back to Jupiter's price endpoint and says so.

Reviews applied during the night: Claude Opus (two code reviews, one cold judge pass, one final review) and Codex at maximum reasoning (three rounds). Findings and fixes are in the commit messages from d54e98d onward.

## 2026-10-12 · public example rotated

- The public Hyperliquid example `0x7b7f72a28fe109fa703eeed7984f2a8a68fedee2` held a **SOL long** (76.02 SOL) at 13:30 UTC+4, so the hero button failed with `UNSUPPORTED_POSITION`. The app now probes `web/examples.mjs` in order with one `clearinghouseState` read per candidate (`hasSolShort`) and loads the first account that still holds a cross-margin SOL short; `0x31dea2516beee92135b96f464eeec3cf292a13f2` imported with routes `withdraw-lending`, `withdraw-hl`, `paired-unwind` feasible at $500 via `bin/exitplan.mjs`. Tests: 279 passing (`npm test`).
- Same day, later: the Solana side of the public example is probed too (`hasKaminoUsdcAndSol`: balance plus Kamino obligations, two reads) across three Kamino USDC suppliers, so a withdrawn deposit or an emptied wallet rotates the example instead of weakening the demo. 279 tests.
