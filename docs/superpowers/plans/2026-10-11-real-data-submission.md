# Real-data mode and hackathon submission — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship ExitPlan as an English, Vercel-hosted, open-source submission that plans cash routes on a real Solana + Hyperliquid portfolio read by address and rehearses the Solana sell leg with a real `simulateTransaction`.

**Architecture:** The pure engine stays the single source of math; three browser adapters (`web/adapters/*.mjs`) normalise public API responses into the engine's portfolio shape and fail closed with reasons. Three Vercel functions in `api/` wrap the existing `server/*.mjs` handlers; static files are served from `web/`.

**Tech Stack:** Node 20+ (tests with `node --test`, LinkeDOM for DOM tests), plain ES modules in the browser, Vercel Functions (web `fetch` signature), public APIs: Hyperliquid info, publicnode Solana RPC, Kamino lending API, Jupiter lite API, OpenAI Responses API (server only).

**Spec:** `docs/superpowers/specs/2026-10-11-real-data-submission-design.md`

## Global Constraints

- All content (UI, README, docs, code comments, commit messages) in English (hackathon rules §12).
- No private keys, signing, sending, or wallet connection anywhere. Every adapter is read-only.
- Engine numeric contract unchanged: currency values ≤ 2 decimals, SOL quantities ≤ 6 decimals, rates in integer bps.
- No new runtime dependencies. `linkedom` stays the only (dev) dependency.
- Every external call: explicit timeout (8 s browser, 5 s server market), `redirect: 'error'`, `credentials: 'omit'`, `cache: 'no-store'`.
- Fail closed: an adapter failure never substitutes cached or scenario numbers; the UI shows the reason and leaves the current portfolio untouched.
- Deadline: Vercel URL answering `/api/status` with `aiConfigured: true` and public repo `plutohan/exitplan` before 2026-10-13 06:59 UTC.

## Review Focus

1. Hyperliquid account with a SOL short on >10× leverage: equity below the 10% model reserve → adapter must reject with `LEVERAGE_TOO_HIGH`, not feed the engine a portfolio it will reject with a cryptic message. (Task 5 test "rejects when equity is below the 10% reserve".)
2. Hyperliquid `allMids.SOL` has 3+ decimals (e.g. `109.695`): must round to cents before the engine, otherwise the engine errors on precision. (Task 5 test "rounds mark price to cents".)
3. Solana wallet with a Kamino USDC borrow (any obligation with `borrows.length > 0`): engine rejects existing debt by design → adapter reports `debt` and the UI shows the engine error, not a blank screen. (Task 6 test "reports debt when any obligation has borrows"; Task 7 test "import with debt shows engine error and keeps scenario".)
4. Address typo (wrong length / bad characters): must be rejected before any network call. (Task 5/6 tests "rejects malformed address without fetching".)
5. Late import response after the user resets or edits: must be ignored like late AI responses. (Task 7 test "late import response is ignored after reset".)

---

### Task 1: Engine accepts imported portfolios

**Files:**
- Modify: `web/engine.mjs` (validate(), result object, BASE_WARNINGS)
- Test: `tests/engine.test.mjs`

**Interfaces:**
- Produces: `planExit(portfolio, constraints)` now accepts `portfolio.evidence === 'imported'` with `portfolio.synthetic === false`; result and every plan carry `evidence` equal to the portfolio's. New export `requiredMarginCents(shortSol, markPrice, marginRate)` returning integer cents using the engine's own rounding, for adapters.

- [ ] **Step 1: Write the failing tests** (append to `tests/engine.test.mjs`)

```js
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
  assert.equal(requiredMarginCents(1.234567, 109.69, 0.1), 1355); // ceil(1.234567×109.69×0.1 = 13.5417…) cents
});
```
Add `requiredMarginCents` to the import line at the top of the test file.

- [ ] **Step 2: Run to verify failure** — `node --test tests/engine.test.mjs` → fails: `requiredMarginCents` is not exported; evidence tests fail on `errors`.

- [ ] **Step 3: Implement** in `web/engine.mjs`:
  - Replace the evidence check with: `const scenario = p.evidence === 'scenario' && p.synthetic === true; const imported = p.evidence === 'imported' && p.synthetic === false; if (!scenario && !imported) errors.push('Portfolio evidence must be scenario (synthetic) or imported (synthetic: false).');`
  - Export `export const requiredMarginCents = (shortSol, markPrice, rate) => feeFor(mulCeil(units(shortSol), cents(markPrice), UNITS), Math.round(rate * 10_000));` and use it inside `validate` and `requiredMargin`.
  - Result: `evidence: p?.evidence === 'imported' ? 'imported' : 'scenario'` (compute before validation errors return), set each plan's `evidence` to the same value, and when imported replace the first warning with `'Imported snapshot: balances and positions were read from public APIs at load time; fees, reserve rate, timings and borrowing terms remain model assumptions.'`
  - Note `shortSol: 0` already passes validation; confirm the test passes without extra code.

- [ ] **Step 4: Run** `node --test tests/engine.test.mjs tests/conservation.test.mjs` → all pass (24 + 1 + new).

- [ ] **Step 5: Commit** `git add web/engine.mjs tests/engine.test.mjs && git commit -m "engine: accept imported portfolios and expose reserve helper"`

---

### Task 2: Server on Vercel (IP limiter, host-based origin check, api/ functions, vercel.json)

**Files:**
- Modify: `server/app.mjs`, `server/intent.mjs` (English error strings), `package.json`
- Create: `api/status.js`, `api/market.js`, `api/intent.js`, `vercel.json`
- Delete: `.openai/hosting.json`, `worker/index.js`, `scripts/assemble-worker.mjs`, `scripts/build.sh`, `scripts/validate-artifact.mjs`
- Test: `tests/server.test.mjs`, `tests/intent.test.mjs`

**Interfaces:**
- Produces: `createApp(assets, options)` unchanged signature; `/api/intent` identity = first hop of `x-forwarded-for` or `'shared'`; origin accepted when `new URL(origin).host` equals `x-forwarded-host` → `host` header → `url.host` (first present).
- `api/*.js` each `export default { fetch(request) { return app.fetch(request, process.env); } }`.

- [ ] **Step 1: Update tests.** In `tests/server.test.mjs`:
  - `intentRequest({ ip = '203.0.113.7', ... })` sets `'x-forwarded-for': ip` instead of the OpenAI header; `user: null` cases become `ip: null` (header absent).
  - Replace test `'intent requires an authenticated identity'` with:
```js
test('intent without a forwarded address shares one limiter bucket', async () => {
  let calls = 0;
  const app = createApp(assets, { interpretIntentImpl: async () => { calls++; return noopIntent(); } });
  for (let i = 0; i < 10; i++) assert.equal((await app.fetch(intentRequest({ ip: null }))).status, 200);
  assert.equal((await app.fetch(intentRequest({ ip: null }))).status, 429);
  assert.equal(calls, 10);
});
test('intent accepts an origin whose host matches x-forwarded-host on a proxied URL', async () => {
  const app = createApp(assets, { interpretIntentImpl: noopIntent });
  const request = new Request('http://127.0.0.1:3000/api/intent', { method: 'POST', body: intentBody, headers: { origin: 'https://exitplan.vercel.app', 'x-forwarded-host': 'exitplan.vercel.app', 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.2' } });
  assert.equal((await app.fetch(request)).status, 200);
});
```
  - Rate-limit tests: `user: 'another-user'` → `ip: '198.51.100.9'`; the 1000-identity test uses `ip: \`10.0.${Math.floor(i / 256)}.${i % 256}\`` and `'overflow-user'` → `'192.0.2.1'`, `'user-0'` → `'10.0.0.0'`.
  - The 502 market test keeps `/unavailable/`; English message in app: `'Public market price is unavailable'`.
  - In `tests/intent.test.mjs` and `tests/server.test.mjs` the mocked explanation `'조건 유지'` → `'Keep current conditions'`.

- [ ] **Step 2: Run** `node --test tests/server.test.mjs` → failing: 401 path, header names.

- [ ] **Step 3: Implement** `server/app.mjs`:
```js
const identity = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'shared';
const expectedHost = request.headers.get('x-forwarded-host') || request.headers.get('host') || url.host;
let originHost = null; try { originHost = new URL(request.headers.get('origin') ?? '').host; } catch {}
if (!originHost || originHost !== expectedHost) return json({ error: 'Origin rejected' }, 403);
```
  Replace the 401 block and the old origin check; use `identity` as the limiter key. English messages: `'Please try again in a moment'` (429), `'Public market price is unavailable'` (502). In `server/intent.mjs` translate the five Korean strings: `'AI is not configured — compare with the conditions below instead'` (503), `'Request must be 1–2,000 characters'`, `'Check the current conditions'`, `'AI did not answer. Adjust the conditions directly'`, `'AI output failed validation. Adjust the conditions directly'`; constraint validation errors `'Invalid constraints'` / `` `Invalid constraint: ${key}` ``. Change the system instruction's `"Explain only the requested constraint changes in Korean"` → `"in English"` and keep "Korean or English cash goals" as accepted input.

- [ ] **Step 4: Create functions and config**
```js
// api/intent.js  (api/status.js and api/market.js are identical except the file name)
import { createApp } from '../server/app.mjs';
const app = createApp({});
export default { fetch(request) { return app.fetch(request, process.env); } };
```
```json
// vercel.json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "outputDirectory": "web",
  "framework": null,
  "headers": [{ "source": "/(.*)", "headers": [
    { "key": "X-Content-Type-Options", "value": "nosniff" },
    { "key": "Referrer-Policy", "value": "no-referrer" },
    { "key": "Cache-Control", "value": "no-store" },
    { "key": "Content-Security-Policy", "value": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://api.hyperliquid.xyz https://solana-rpc.publicnode.com https://api.kamino.finance https://lite-api.jup.ag; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'" }
  ]}]
}
```
  `package.json`: remove `build`/`validate` scripts, keep `test`; add `"engines": { "node": ">=20" }`. Delete `.openai/`, `worker/`, the three scripts; update `.gitignore` (drop `dist/`, `site.tar.gz`).

- [ ] **Step 5: Run** `node --test tests/*.test.mjs` → all pass (UI tests still Korean at this point; they pass because the UI is untouched).

- [ ] **Step 6: Commit** `git add -A && git commit -m "server: Vercel functions, IP limiter, host-based origin check"`

---

### Task 3: First Vercel deploy (user sets secrets)

**Files:** none (deployment).

- [ ] **Step 1:** `npx vercel@63.1.2 link --yes` (creates `.vercel/`, ignored) then `npx vercel@63.1.2 deploy --prod --yes`. Record the production URL.
- [ ] **Step 2:** `curl -s https://<url>/api/status` → `{"aiConfigured":false,...}`; `curl -s https://<url>/api/market | head -c 200` → `evidence: live-market`; `curl -sI https://<url>/` → CSP header present.
- [ ] **Step 3:** Ask the user to add `OPENAI_API_KEY` and `OPENAI_MODEL` in Vercel → Settings → Environment Variables (Production), then redeploy (`npx vercel@63.1.2 deploy --prod --yes`) and confirm `aiConfigured: true`.
- [ ] **Step 4:** Verify the origin check on the real host: `curl -s -X POST https://<url>/api/intent -H 'origin: https://<host>' -H 'content-type: application/json' -d '{"text":"I need 2000 USDC","currentConstraints":{"target":2000,"maxNewDebt":0,"minHlBuffer":1500,"deadlineHours":24,"preserveHedge":true,"preserveSolQuantity":false}}'` → 200 with `mode: 'ai'` (after secrets) or 503 (before).

---

### Task 4: English UI and tests

**Files:**
- Modify: `web/index.html`, `web/app.mjs`, `tests/ui.test.mjs`

**Interfaces:** DOM ids unchanged. Text contract used by tests (exact strings):
- `#ai-status`: `AI offline` / `AI connected`
- `#intent-feedback` offline: `AI offline — adjust the conditions above directly`
- `.demo-label`: `Synthetic portfolio · No real transactions`
- `#route-count`: `` `Feasible ${feasible} / ${plans}` ``
- `#result-banner` no route: contains `No route satisfies the current conditions` and `` `up to ${money(maximumWithoutSelling)}` ``; invalid input: `Check your inputs`
- `#guide-title` after manual edit: `Comparing your adjusted conditions`
- `#dialog-title` rejected: `Why this route was excluded`; rehearsal done: `Rehearsal complete`; rehearsal body contains `Synthetic rehearsal` (scenario) or `Read-only rehearsal` (imported) and `does not change`
- `#decision-content` no route: `No selectable route`
- AI proposal heading: `Apply these changes?`; clarification: `Needs confirmation first`; applied: `Applied the confirmed conditions`
- Market: `` `Public SOL perp mid ${money(solUsd,true)} · ${time} UTC. Not an execution price; the synthetic scenario was not repriced` `` and failure `Public market price unavailable. The synthetic scenario still assumes SOL $100`
- `#portfolio-caption` contains `Net SOL exposure 0 SOL`
- Plan names: `Keep current positions`, `Withdraw deposits + borrow more`, `Borrow against SOL`, `Withdraw deposits + trim spot and short`, `Trim spot and short together`, `Sell SOL only`, `Split withdrawal: Solana + HL`, `Withdraw Solana deposit USDC`, `Withdraw free HL collateral`, `Cash route`
- Step names: `Withdraw deposited USDC`, `Sell SOL spot`, `Reduce SOL short by the same amount`, `Borrow against SOL (comparison)`, `Withdraw HL collateral → Solana`

- [ ] **Step 1: Update assertions in `tests/ui.test.mjs`** to the strings above (38 lines). Korean intent inputs may stay (they are user text), but change the mocked 503 body to `'AI is not configured — compare with the conditions below instead'`, `aiProposal` explanation to `'Please confirm before applying'`, and the clarification question to `'Allow borrowing? <script>bad()</script>'`.
- [ ] **Step 2: Run** `node --test tests/ui.test.mjs` → fails on text.
- [ ] **Step 3: Translate `web/index.html`** (`lang="en"`, title `ExitPlan — the cash you need, planned`, all labels; keep ids/classes) and **`web/app.mjs`** (planName, stepName, rejectionText, renderPlans, renderPositions, renderDecision, updateControls, guides, toasts, dialogs, rehearsal, AI panel, market). Date formatting: `toLocaleString('en-GB', { timeZone: 'UTC', hour12: false })`.
- [ ] **Step 4: Run** `node --test tests/*.test.mjs` → all pass. `grep -nP '[\x{AC00}-\x{D7A3}]' web/*.{html,mjs} server/*.mjs` → no output.
- [ ] **Step 5: Commit** `git commit -am "ui: English copy"`

---

### Task 5: Hyperliquid adapter

**Files:**
- Create: `web/adapters/hyperliquid.mjs`, `tests/fixtures/hl-sol-short.json`, `tests/fixtures/hl-no-position.json`
- Test: `tests/adapters.hyperliquid.test.mjs`

**Interfaces:**
- Produces:
```js
export class AdapterError extends Error { constructor(code, message) }  // codes: INVALID_ADDRESS, HTTP_ERROR, NETWORK_ERROR, TIMEOUT, INVALID_RESPONSE, UNSUPPORTED_POSITION, ISOLATED_MARGIN, LEVERAGE_TOO_HIGH
export async function importHyperliquid(address, { fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 8000 } = {})
// → { evidence: 'imported', venue: 'hyperliquid', address, observedAt, source: 'Hyperliquid public info API',
//     state: { accountMode: 'standard', marginMode: 'cross', asset: 'SOL', shortSol, markPrice, collateral, conservativeMarginRate: 0.1, freeWithdrawable },
//     reported: { accountValue, withdrawable, marginUsed, entryPrice, liquidationPrice, leverage, otherPositions: [{ coin, marginUsed }] },
//     assumptions: ['Standard account assumed; account mode is not verified by the API', 'Reserve is 10% of short notional, a model assumption, not the exchange maintenance margin', 'Margin used by other open positions is treated as locked and deducted from equity'] }
```
- Consumes: `requiredMarginCents` from `../engine.mjs`.

- [ ] **Step 1: Capture fixtures** with the public address found in research (`docs/demo-addresses.md`): `curl -s -X POST https://api.hyperliquid.xyz/info -H 'Content-Type: application/json' -d '{"type":"clearinghouseState","user":"<ADDR>"}' > tests/fixtures/hl-sol-short.json` and the zero address → `hl-no-position.json`. Trim nothing; fixtures are data.

- [ ] **Step 2: Write failing tests**
```js
import test from 'node:test'; import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { importHyperliquid, AdapterError } from '../web/adapters/hyperliquid.mjs';
import { planExit, defaultConstraints, createDemoPortfolio } from '../web/engine.mjs';
const fixture = async name => JSON.parse(await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const mids = { SOL: '109.695', BTC: '70000' };
const fetchFor = (state, options = {}) => async (url, init) => {
  const body = JSON.parse(init.body);
  if (body.type === 'allMids') return Response.json(options.mids ?? mids);
  if (body.type === 'clearinghouseState') { assert.equal(body.user, ADDR); return Response.json(state); }
  assert.fail('unexpected request ' + init.body);
};
const ADDR = '0x' + 'a'.repeat(40);
test('normalises a cross-margin SOL short into the engine shape', async () => {
  const state = await fixture('hl-sol-short');
  const result = await importHyperliquid(ADDR, { fetchImpl: fetchFor(state), now: () => 1_791_731_274_640 });
  assert.equal(result.evidence, 'imported');
  assert.equal(result.state.markPrice, 109.7);              // rounded to cents
  assert.ok(result.state.shortSol > 0);
  assert.equal(String(result.state.shortSol).split('.')[1]?.length ?? 0 <= 6, true);
  const portfolio = { ...createDemoPortfolio(), evidence: 'imported', synthetic: false, hyperliquid: result.state };
  assert.deepEqual(planExit(portfolio, defaultConstraints()).errors, []);
});
test('other coins are allowed and their margin is deducted from equity', async () => {
  const state = await fixture('hl-sol-short');
  const others = state.assetPositions.filter(a => a.position.coin !== 'SOL');
  assert.ok(others.length > 0, 'fixture should hold other positions');
  const locked = others.reduce((sum, a) => sum + Number(a.position.marginUsed), 0);
  const result = await importHyperliquid(ADDR, { fetchImpl: fetchFor(state) });
  assert.equal(result.state.collateral, Math.round((Number(state.marginSummary.accountValue) - locked) * 100) / 100);
  assert.deepEqual(result.reported.otherPositions.map(p => p.coin), others.map(a => a.position.coin));
});
test('an account with no positions imports as a zero short', async () => {
  const result = await importHyperliquid(ADDR, { fetchImpl: fetchFor(await fixture('hl-no-position')) });
  assert.equal(result.state.shortSol, 0);
  assert.equal(result.state.freeWithdrawable, Math.min(result.reported.withdrawable, result.state.collateral));
});
test('rejects malformed address without fetching', async () => {
  await assert.rejects(importHyperliquid('0x123', { fetchImpl: () => assert.fail('must not fetch') }), e => e.code === 'INVALID_ADDRESS');
});
for (const [name, mutate, code] of [
  ['a long SOL position', s => { s.assetPositions[0].position.szi = '12.5'; }, 'UNSUPPORTED_POSITION'],
  ['isolated margin', s => { s.assetPositions[0].position.leverage.type = 'isolated'; }, 'ISOLATED_MARGIN'],
  ['equity below the 10% reserve', s => { s.marginSummary.accountValue = '1'; s.withdrawable = '0'; }, 'LEVERAGE_TOO_HIGH'],
  ['missing margin summary', s => { delete s.marginSummary; }, 'INVALID_RESPONSE'],
]) test(`rejects ${name}`, async () => {
  const state = await fixture('hl-sol-short'); mutate(state);
  await assert.rejects(importHyperliquid(ADDR, { fetchImpl: fetchFor(state) }), e => e instanceof AdapterError && e.code === code);
});
test('HTTP failure, bad JSON and timeout are distinct errors', async () => {
  await assert.rejects(importHyperliquid(ADDR, { fetchImpl: async () => new Response('x', { status: 500 }) }), e => e.code === 'HTTP_ERROR');
  await assert.rejects(importHyperliquid(ADDR, { fetchImpl: async () => new Response('{bad', { status: 200, headers: { 'content-type': 'application/json' } }) }), e => e.code === 'INVALID_RESPONSE');
  await assert.rejects(importHyperliquid(ADDR, { fetchImpl: () => new Promise(() => {}), timeoutMs: 5 }), e => e.code === 'TIMEOUT');
});
```
- [ ] **Step 3: Run** → fails: module missing.
- [ ] **Step 4: Implement** `web/adapters/hyperliquid.mjs`: shared helpers `postJson(url, body, { fetchImpl, timeoutMs })` (AbortController + timer, status check, content-type check, 1 MB cap, JSON parse) and `decimal(value, name)` (string or number → finite number, else INVALID_RESPONSE). Logic: validate address `/^0x[0-9a-fA-F]{40}$/`; run both requests with `Promise.all`; `accountValue = decimal(marginSummary.accountValue)`; reject negative; positions: `assetPositions.map(a => a.position)`; `sol = positions.find(p => p.coin === 'SOL')`; if `sol && Number(sol.szi) > 0` → UNSUPPORTED_POSITION (long is not a hedge); if `sol && sol.leverage.type !== 'cross'` → ISOLATED_MARGIN; `locked = Σ decimal(p.marginUsed)` over non-SOL positions; `shortSol = sol ? round6(-szi) : 0`; `markPrice = round2(mids.SOL)`; `collateral = round2(accountValue - locked)` (reject if < 0); `required = requiredMarginCents(shortSol, markPrice, 0.1)`; if `required > Math.round(collateral*100)` → LEVERAGE_TOO_HIGH; `freeWithdrawable = Math.max(0, Math.min(round2(withdrawable), (Math.round(collateral*100) - required) / 100))`.
- [ ] **Step 5: Run** `node --test tests/adapters.hyperliquid.test.mjs` → pass. **Commit** `git add -A && git commit -m "adapters: Hyperliquid read-only import"`

---

### Task 6: Solana adapter (balance, Kamino, Jupiter)

**Files:**
- Create: `web/adapters/solana.mjs`, `tests/fixtures/kamino-obligations.json`, `tests/fixtures/jupiter-quote.json`
- Test: `tests/adapters.solana.test.mjs`

**Interfaces:**
- Produces:
```js
export const SOLANA_RPC_URL = 'https://solana-rpc.publicnode.com';
export const KAMINO_MAIN_MARKET = '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', SOL_MINT = 'So11111111111111111111111111111111111111112';
export function isSolanaAddress(value)  // /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
export async function importSolana(address, { fetchImpl, now, timeoutMs } = {})
// → { evidence: 'imported', venue: 'solana', address, observedAt,
//     state: { sol, solPrice, lending: { usdc, debt, withdrawCapacity }, borrow: { enabled: true, capacity, maxLtv: 0.3 } },
//     quote: { outUsdcPerSol, priceImpactPct, solSaleBps }, sources: ['publicnode RPC getBalance', 'Kamino main-market obligations', 'Jupiter quote 1 SOL → USDC'],
//     assumptions: ['Withdraw capacity equals supplied USDC; reserve utilisation is not checked', 'Borrow capacity is 30% of SOL value, a model rule, not a Kamino quote'] }
```
- Fee rule: `solSaleBps = Math.max(30, 50 + Math.round(Number(priceImpactPct) * 10_000))` and it is also exported as `solSaleBpsFromQuote(quote)` so the UI can show it.

- [ ] **Step 1: Capture fixtures.** `curl -s "https://api.kamino.finance/kamino-market/7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF/users/<WALLET>/obligations" > tests/fixtures/kamino-obligations.json` using the wallet from `docs/demo-addresses.md`; `curl -s "https://lite-api.jup.ag/swap/v1/quote?inputMint=So111…112&outputMint=EPjF…t1v&amount=1000000000&slippageBps=50" > tests/fixtures/jupiter-quote.json`. Kamino response shape (verified 2026-10-11): array of obligations; `state.deposits[]` has 8 slots, empty slot = `depositReserve` `11111111111111111111111111111111`; USDC reserve = `D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59`; `state.borrows[]` has 5 slots, empty = `borrowReserve` system program; `refreshedStats.userTotalDeposit` / `userTotalBorrow` are fresh human-decimal USD strings (use these, never `marketValueSf`, which can be stale). `[]` means no obligation in that market. Parser: an obligation whose non-empty deposits are all the USDC reserve contributes `Number(refreshedStats.userTotalDeposit)`; any other reserve → `UNSUPPORTED_OBLIGATION`; any non-empty borrow or `userTotalBorrow !== '0'` → `debt += Number(userTotalBorrow) || 0.01`.
- [ ] **Step 2: Write failing tests** (same style as Task 5): normalises balance + deposits + quote into the engine shape and the engine accepts it; `reports debt when any obligation has borrows` (mutate fixture: set `state.borrows[0].borrowReserve` to the USDC reserve and `refreshedStats.userTotalBorrow` to `'100'`); `rejects a mixed-asset obligation` (set `state.deposits[1].depositReserve` to the SOL reserve `d4A2prbA2whesmvHaL88BH6Ewn5N4bTSU2Ze8P6Bc4Q`) → `state.lending.debt > 0` and `planExit` returns the existing-debt error; empty obligations `[]` → `lending.usdc === 0`; `rejects malformed address without fetching`; `fee never below 30 bps` (quote with `priceImpactPct: '0'` → 30... note 50+0=50 ≥ 30 so assert 50; with `'-0.01'` → 30); RPC error object `{ error: { message } }` → `HTTP_ERROR`; quote missing `outAmount` → `INVALID_RESPONSE`.
- [ ] **Step 3–5:** implement, run `node --test tests/adapters.solana.test.mjs`, commit `"adapters: Solana read-only import (balance, Kamino, Jupiter)"`. Rounding: `sol = round6(lamports / 1e9)`, `solPrice = round2(outAmount / 1e6)`, `usdc = round2(sum)`, `capacity = round2(sol * solPrice * 0.3)`.

---

### Task 7: Portfolio source toggle in the UI

**Files:**
- Modify: `web/index.html` (new `<section class="source-panel">` above the planner grid), `web/app.mjs`
- Test: `tests/ui.test.mjs` (mount gains `externalResponse` hook)

**Interfaces:**
- DOM: `#source-scenario` / `#source-import` (radio inputs, name `source`), `#solana-address`, `#hl-address`, `#load-positions` (button), `#import-status` (aria-live), `.evidence-badge` on each plan card with text `SCENARIO` or `IMPORTED · HH:MM UTC`.
- State: `let portfolio = createDemoPortfolio(); let imported = null;` `applyImport({ solana, hyperliquid })` builds `portfolio = { evidence: 'imported', synthetic: false, snapshot: { complete: true, ageSeconds: 0, maxAgeSeconds: 300 }, solana: solana.state, hyperliquid: hyperliquid.state, fees: { ...fixture fees, solSaleBps: solana.quote.solSaleBps }, timing: fixture }`, then `recalculate()`.
- Guard: `importSequence` counter; a response is applied only if `sequence === importSequence && version === revision`.

- [ ] **Step 1: Tests** in `tests/ui.test.mjs` (mount: `externalResponse = (call) => ...` used by `fetchMock` for any non-`/api` URL; default `assert.fail`):
  - `import by address loads both venues, labels plans IMPORTED and keeps SOL price from the quote` — stub HL and Solana responses using the fixtures; after `#load-positions` click: `#sol-price` matches the quote price, `.evidence-badge` text starts with `IMPORTED`, `#import-status` contains `Loaded`.
  - `import failure keeps the scenario and shows the reason` — Solana RPC returns 500 → `#import-status` contains `could not load`, `.evidence-badge` is `SCENARIO`, `#plans` innerHTML unchanged.
  - `import with debt shows engine error and keeps scenario` — Kamino fixture with a borrow → `#import-status` contains `existing lending debt`, plans unchanged.
  - `late import response is ignored after reset` — deferred responses; click reset; resolve; badge stays `SCENARIO`.
  - `switching back to scenario restores fixture values` — after a successful import, click `#source-scenario` → `#sol-price` is `SOL $100.00`.
  - Update `assertNoExecutionCalls` to allow the four public API hosts.
- [ ] **Step 2: Run** → fails (no controls).
- [ ] **Step 3: Implement** HTML + app.mjs: radio toggle shows/hides the address row; `#load-positions` disabled while loading; status messages: `Loading positions…`, `` `Loaded · Solana ${num(sol)} SOL · HL short ${num(shortSol)} SOL` ``, `` `Could not load positions: ${message}` ``; engine errors after import → `` `Imported portfolio is not supported: ${errors[0]}` `` and revert to the previous portfolio. Position cards: `bar: before > 0 ? after/before : 1`. Evidence dialog: when imported, replace the synthetic paragraph with the sources list, `observedAt`, and the assumptions from both adapters.
- [ ] **Step 4: Run** `node --test tests/*.test.mjs` → pass. **Commit** `"ui: import portfolio by address"`.

---

### Task 8: Rehearsal with a real Solana simulation

**Files:**
- Create: `web/adapters/rehearsal.mjs`
- Modify: `web/app.mjs` (renderRehearsal)
- Test: `tests/adapters.rehearsal.test.mjs`, `tests/ui.test.mjs`

**Interfaces:**
```js
export async function simulateSellSol({ address, solAmount, fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 8000 })
// → { ok: boolean, error: string | null, unitsConsumed: number | null, logCount: number, quotedUsdc: number, observedAt, calls: ['quote', 'swap', 'simulateTransaction'] }
```
Flow: quote (`amount = Math.round(solAmount * 1e9)`, `slippageBps=50`) → POST `https://lite-api.jup.ag/swap/v1/swap` `{ quoteResponse, userPublicKey: address, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true }` → RPC `simulateTransaction [swapTransaction, { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'processed' }]`. `ok = result.value.err === null`; `error = JSON.stringify(err)` when not null; never sends.

- [ ] **Step 1: Tests:** success path with three stubbed responses in order; simulation `err` → `ok: false` with error text; swap endpoint 400 → rejects `HTTP_ERROR`; `address` not base58 → `INVALID_ADDRESS` without fetch; `solAmount <= 0` → `INVALID_AMOUNT`.
- [ ] **Step 2–3:** implement; run `node --test tests/adapters.rehearsal.test.mjs`.
- [ ] **Step 4: UI:** in `renderRehearsal`, when `portfolio.evidence === 'imported'` and the current step action starts with `Sell SOL`, render a `#simulate-step` button (`Simulate on Solana (read-only)`); result line `Simulation succeeded · ${units} CU · quoted ${money(quotedUsdc)}` or `Simulation failed: ${error}`. Other steps show `Not simulated: needs a signed exchange request` (HL) / `Not simulated: withdrawal transaction not built` (Kamino). Scenario mode keeps today's behaviour. UI test: imported rehearsal shows the button, clicking calls the three external endpoints, never `/api/*`, and the dialog shows `Simulation succeeded`.
- [ ] **Step 5: Run all tests; commit** `"rehearsal: simulate the Solana sell leg"`.

---

### Task 9: Submission package

**Files:**
- Modify: `README.md`, `docs/engine.md`, `docs/integrations.md`, `docs/verification.md`
- Create: `LICENSE` (MIT, "Copyright (c) 2026 Pluto Han"), `docs/pitch-video-script.md`, `docs/demo-video-script.md`, `docs/submission-copy.md`, `docs/demo-addresses.md`
- Delete: `docs/demo-script-ko.md`

- [ ] **Step 1: README** sections: one-paragraph pitch; "What is real in this build" (imported positions, Jupiter quote, simulateTransaction, live HL mid, AI intent with confirmation) / "What is not" (no execution, no Kamino withdraw simulation, model fees/reserve, HL account mode assumed); Run locally (`npm ci --ignore-scripts && npm test`, `npx vercel dev`); Deploy; Architecture; Disclosure: "The synthetic engine and UI were written on 2026-10-11 (inside the hackathon window) before the real-data work; no code predates the window."; Links: live URL, videos.
- [ ] **Step 2: Scripts.** Pitch (≤ 3 min): 0:00 who I am (Solana tooling contributor, UAE), 0:20 problem (hedged positions across Solana + Hyperliquid; "how much cash can I pull without breaking my hedge or taking debt?"), 0:50 insight (cash goal + constraints, rejected routes explained), 1:20 demo clip, 2:10 market (Phantom Perps users, delta-neutral farmers, treasuries), 2:35 business (free planner → paid alerts/execution via partners), 2:50 ask. Demo (≤ 3 min): scenario guide → import by address → compare → rejected reason → rehearsal with real simulation → AI intent proposal → confirm.
- [ ] **Step 3: Submission copy:** name, one-liner, description (≤ 1,500 chars), problem, wedge, target user, business model, chains integrated (Solana, Hyperliquid), tools (Jupiter, Kamino API, Hyperliquid info API, publicnode RPC, OpenAI, Vercel), team (solo), disclosure text, links.
- [ ] **Step 4: Commit** `"docs: README, license, video scripts, submission copy"`.

---

### Task 10: Publish and final verification

- [ ] **Step 1:** `gh repo create plutohan/exitplan --public --source . --remote origin --push` (user approved pushing `main`).
- [ ] **Step 2:** `npx vercel@63.1.2 deploy --prod --yes`; confirm `/api/status` → `aiConfigured: true`; open the URL in a browser: import the demo addresses, run a rehearsal simulation, send one AI request; check the console for CSP violations (none expected).
- [ ] **Step 3:** `node --test tests/*.test.mjs` final count recorded in `docs/verification.md`; commit and push.
- [ ] **Step 4:** Hand the user the checklist: register entry, upload videos, paste submission copy, add repo + live URL, submit before Tuesday 10:59 GST.
