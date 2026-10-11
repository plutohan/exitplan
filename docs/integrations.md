# ExitPlan integration boundaries

Everything here is read-only. No adapter signs, sends, bridges, borrows or trades.

## Browser adapters (`web/adapters/`)

`hyperliquid.mjs` — `importHyperliquid(address)` posts `clearinghouseState` and `allMids` to the public info API (`https://api.hyperliquid.xyz/info`). Accepts a cross-margin SOL short or no SOL position; a SOL long or isolated-margin SOL is rejected. Other coins are allowed and their `marginUsed` is deducted from equity as locked. Equity below the 10% model reserve is rejected (`LEVERAGE_TOO_HIGH`). The mid is rounded to cents. The account mode is verified with `userAbstraction`: `disabled` (standard) and `default` import; `unifiedAccount`, `portfolioMargin`, `dexAbstraction` and unknown values are rejected (`UNSUPPORTED_ACCOUNT_MODE`). When the exchange reports less withdrawable than the model headroom, the import says so in its assumptions and the rehearsal repeats it on the withdrawal step.

`solana.mjs` — `importSolana(address)` runs `getBalance` on `https://solana-rpc.publicnode.com`, reads Kamino main-market obligations from `https://api.kamino.finance` and quotes 1 SOL → USDC on `https://lite-api.jup.ag`. Only USDC-only obligations are accepted; any borrow is reported as debt and the engine rejects it with its existing-debt rule. The sale fee is `max(30, 50 + price impact in bps)`. Wallet-held USDC outside Kamino is not read.

`rehearsal.mjs` — `simulateSellSol({ address, solAmount })` quotes the exact amount, builds an unsigned swap with Jupiter for the entered wallet and runs `simulateTransaction` with `sigVerify: false` and `replaceRecentBlockhash: true`. It reports success or the error, compute units and log count. It never calls `sendTransaction`. Hyperliquid order and withdrawal steps and the Kamino withdrawal are listed but not simulated.

Shared rules (`http.mjs`): 8-second timeout, `redirect: 'error'`, `credentials: 'omit'`, no caching, bounded response size, and an `AdapterError` with a code on every failure (`INVALID_ADDRESS`, `HTTP_ERROR`, `NETWORK_ERROR`, `TIMEOUT`, `INVALID_RESPONSE`, `UNSUPPORTED_POSITION`, `ISOLATED_MARGIN`, `LEVERAGE_TOO_HIGH`, `UNSUPPORTED_OBLIGATION`, `INVALID_AMOUNT`). The UI never substitutes previous or scenario numbers when a load fails; a load that completes after a reset, a source switch or a constraint edit is discarded and says so.

## Server (Vercel functions, `api/`)

- `GET /api/status` — capability flags only (`aiConfigured`, `executionEnabled: false`). No secrets.
- `GET /api/market` — SOL perpetual mid from Hyperliquid `allMids`, labelled `live-market`, `executable: false`, with receipt time. Never substituted into planning.
- `POST /api/intent` — same-origin only (Origin host must match the request host), per-IP best-effort limiter (10 per minute per isolate), 8 KB body cap, JSON only. Sends only the user's text and current constraints to the OpenAI Responses API with `store: false` and a strict JSON schema; the model has no tools. The result is a proposal that the UI applies only after the user confirms. Keys live in Vercel environment variables, never in the browser or the repository.

## Verified public endpoints (2026-10-11)

All four public hosts answer browser requests with `Access-Control-Allow-Origin: *` (including the JSON POST preflights on Hyperliquid, publicnode and Jupiter `/swap`), and the production CSP's `connect-src` lists exactly those hosts plus `'self'`.
