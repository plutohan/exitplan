# ExitPlan — real-data mode and hackathon submission (design)

Date: 2026-10-11. Deadline: Crypto World's Fair, 11:59 PM PT, 2026-10-12 (06:59 UTC / 10:59 GST on 2026-10-13).

## Goal

Turn the synthetic-only proof of concept into a submission that (1) plans cash routes on a **real** Solana + Hyperliquid portfolio read by address, (2) rehearses the Solana sell leg with a **real** `simulateTransaction`, (3) runs on a public Vercel URL with the AI intent endpoint live, in English, from a public GitHub repository, and (4) ships with pitch/demo video scripts and submission copy.

Out of scope (named as "next steps" in the pitch only): wallet connection or signing, Kamino withdraw transaction simulation, Hyperliquid order or withdrawal execution, multi-asset portfolios, Korean UI.

## Architecture

```
browser                                   Vercel
┌──────────────────────────────────┐      ┌────────────────────────┐
│ index.html / app.mjs (English)   │      │ api/intent.js  ──► OpenAI (server secret)
│  source toggle: scenario|import  │──────│ api/market.js  ──► Hyperliquid allMids
│ engine.mjs (pure, unchanged math)│      │ api/status.js          │
│ adapters/hyperliquid.mjs ─────────────► api.hyperliquid.xyz/info (CORS *)
│ adapters/solana.mjs ──────────────────► solana-rpc.publicnode.com, api.kamino.finance, lite-api.jup.ag
│ adapters/rehearsal.mjs ───────────────► lite-api.jup.ag/swap + simulateTransaction
└──────────────────────────────────┘      └────────────────────────┘
```

### engine.mjs (core, minimal change)
- `portfolio.evidence` may be `'scenario'` or `'imported'`; `synthetic` must be `true` for scenario and `false` for imported. Every other validation stays fail-closed.
- `hyperliquid.shortSol` may be `0` (account with no SOL short). Required margin is then 0 and paired candidates size to 0.
- Result carries `evidence` through from the portfolio so the UI can label plans.

### adapters/hyperliquid.mjs (new, browser + tests)
- Input: EVM address. Calls `clearinghouseState` and `allMids` (two POSTs, 8 s timeout each).
- Accepts: cross-margin SOL short (`szi < 0`) or no SOL position. Other coins' positions are allowed; their `marginUsed` is deducted from equity and treated as locked (stated assumption). Rejects a SOL long, isolated-margin SOL, missing fields, non-finite numbers, and equity below the 10% model reserve, each with a reason code.
- Output: `{ accountMode: 'standard', marginMode: 'cross', asset: 'SOL', shortSol, markPrice, collateral: accountValue − Σ marginUsed(non-SOL positions), conservativeMarginRate: 0.10 (stated assumption), freeWithdrawable: min(withdrawable, collateral − required), observedAt, source }`.
- Does not sum spot and perp balances. No account mode is proven; the UI says "assumed standard account".

### adapters/solana.mjs (new, browser + tests)
- Input: Solana address. Calls `getBalance` (publicnode), Kamino main-market obligations, Jupiter quote for 1 SOL → USDC.
- Lending: for each Kamino main-market obligation, non-empty `state.deposits[]` (reserve ≠ system program) must all be the USDC reserve `D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59`; then `usdc += Number(refreshedStats.userTotalDeposit)`. A mixed-asset obligation is rejected (`UNSUPPORTED_OBLIGATION`). Any non-empty `state.borrows[]` or `refreshedStats.userTotalBorrow !== '0'` → `debt > 0` → engine rejects with the existing-debt rule. `withdrawCapacity = usdc` (no reserve-utilisation check; labelled).
- Price: `solPrice` = Jupiter out/in for 1 SOL; `solSaleBps` = max(30, round(priceImpactPct × 10 000) + slippage 50) so the fee is never below the fixture.
- Fees/timings not quoted by any API keep the fixture values and are labelled "assumption".
- Output: `{ sol, solPrice, lending: { usdc, debt, withdrawCapacity }, borrow: { enabled: true, capacity: fixture rule 30% LTV of SOL value, maxLtv: 0.3 } }` plus `observedAt`, `sources`.

### adapters/rehearsal.mjs (new, browser + tests)
- For the selected plan's `Sell SOL for USDC` step only: Jupiter quote with the exact lamport amount → `/swap` with `userPublicKey = entered address` → `simulateTransaction` (`sigVerify: false`, `replaceRecentBlockhash: true`, base64) on publicnode.
- Shows: success/failure, error string if any, compute units consumed, number of log lines, quoted out amount vs engine estimate. Never sends a transaction.
- Other steps display "not simulated" with a one-line reason (HL withdrawal needs a signed exchange request; Kamino withdraw not built).

### app.mjs / index.html
- Source toggle: **Synthetic scenario** (default, unchanged) / **Import by address** (Solana address + Hyperliquid address inputs, "Load" button). Import failure keeps the previous state untouched and shows the reason; it never reprices the scenario.
- All copy in English. Evidence badge on every plan card: `SCENARIO` or `IMPORTED · <time>`.
- Rehearsal step card for the sell leg gains a "Simulate on Solana" action with the result inline.

### Server on Vercel
- `api/status.js`, `api/market.js`, `api/intent.js` import `server/*.mjs` unchanged except: the `oai-authenticated-user-id` requirement is replaced by a best-effort per-IP limiter (`x-forwarded-for` first hop, 10 requests / minute, isolate-local). Origin and `sec-fetch-site` checks stay.
- `vercel.json`: `outputDirectory: "web"`, security headers for static files (same CSP as before but `connect-src` widened to the four public APIs), no build command.
- Remove `.openai/`, `worker/`, `scripts/assemble-worker.mjs`, `scripts/build.sh`, `scripts/validate-artifact.mjs`.

## Error handling
- Every adapter rejects with `{ code, message }`; the UI shows the message and leaves the current portfolio in place. No fallback to cached or scenario numbers.
- Timeouts: 8 s per request; the UI disables the Load button while a request is in flight and ignores late responses after a reset (same revision pattern as the AI panel).

## Testing
- New: `tests/adapters.test.mjs` with captured real responses as fixtures (SOL short account, no-position account, isolated margin, non-SOL position, Kamino obligation with and without borrows, Jupiter quote). Covers acceptance, each rejection, timeout, malformed JSON.
- Updated: `tests/ui.test.mjs` assertions in English; new cases for the source toggle (load success, load failure keeps scenario, late response ignored). `tests/server.test.mjs` auth cases become IP-limiter cases. `tests/engine.test.mjs` adds imported-evidence and zero-short cases.
- Done when `node --test tests/*.test.mjs` passes and the Vercel URL answers `/api/status` with `aiConfigured: true`.

## Submission package (English)
- README: what is real / not real, how to run, architecture, disclosure that the synthetic PoC was built on 2026-10-11 before this work.
- `docs/pitch-video-script.md` (2–3 min), `docs/demo-video-script.md` (≤ 3 min), `docs/submission-copy.md` (one-liner, problem, wedge, target user, business model, chains integrated: Solana + Hyperliquid, tools: Jupiter, Kamino API, Hyperliquid info API, OpenAI).
- MIT license.

## Schedule (GST)
- Sun 23:30: spec, git, English UI, Vercel scaffold, tests green, first deploy; user logs in to Vercel and sets `OPENAI_API_KEY`, `OPENAI_MODEL`.
- Mon 07:00: adapters, source toggle, rehearsal simulation, tests.
- Mon 13:00: README, docs, scripts, submission copy.
- Mon afternoon–evening: user records videos and submits. Tuesday morning is buffer only.
