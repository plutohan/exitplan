# ExitPlan — cash goals, explicit tradeoffs

Private interactive proof of concept for comparing ways to source USDC across Solana and Hyperliquid without silently changing a user's debt or exposure constraints.

## Run checks and package

Requires Node.js 20+; no third-party runtime packages. DOM tests use the pinned development-only LinkeDOM dependency. Run `npm ci --ignore-scripts` before the tests in a fresh checkout.

```sh
npm ci --ignore-scripts
node --test tests/*.test.mjs
node scripts/assemble-worker.mjs
bash scripts/build.sh
node scripts/validate-artifact.mjs
```

The Site uses a single Cloudflare Worker assembled from `server/` and `web/`. `worker/index.js` and `dist/` are generated output. There are no signing keys, transaction-send endpoints, wallet permissions or custody features.

## What is real in this build

- Deterministic, executable JavaScript route enumeration and constraint checks, covered by tests
- A browser UI that changes constraints, compares acceptable/rejected routes and rehearses a sequence
- Optional public Hyperliquid market-data retrieval, explicitly separate from the synthetic portfolio
- A structured-output AI intent adapter with an independently validated schema and an explicit confirmation step

## What is not real / not verified

- All displayed portfolio balances, prices used for planning, fees, borrowing routes and margin parameters are labelled synthetic scenarios
- The route engine is not a deployed lending or trading protocol and does not evaluate actual Kamino obligations
- A rehearsal does not submit a transaction; it is not an RPC simulation, an executed bridge, or realized cash
- Hyperliquid calculations are a bounded model, not a complete replica of its risk engine
- The portfolio is not the user's wallet, and the app does not collect private keys or wallet addresses
- No AI inference is available until an approved server-side API setup is completed. The UI shows this explicitly rather than simulating an AI response
- Market-data receipt time is not a guarantee of exchange data freshness, and a perp midpoint is not an executable Solana swap quote
- Route ranking means best among the evaluated discrete candidates, not a globally optimal financial decision
- No production security audit, live cross-chain execution or browser visual QA is claimed

## AI configuration

The backend expects `OPENAI_API_KEY` and `OPENAI_MODEL` as server runtime secrets/configuration, never browser inputs or repository files. Configure through the approved hosting secret flow. The current build does not provision credentials, enable billing or call a live model. Mocked tests do not prove a live model integration.

Once configured, only the user's entered text and current explicit scenario constraints are sent to the OpenAI Responses API with storage disabled. The app does not send wallet addresses or live holdings. The UI must obtain user intent for any future extension to private portfolio data. The model receives no signing or arbitrary code tools. Responses are proposals, never execution instructions.

## Architecture

- `web/engine.mjs`: scenario portfolio, route candidates, post-action invariants
- `web/app.mjs`: condition editing, proposal confirmation, comparison and rehearsal
- `server/hyperliquid.mjs`: public market adapter and constrained offline normalization
- `server/intent.mjs`: intent extraction only, numeric/schema validation, failure closure
- `server/app.mjs`: same-origin authenticated AI endpoint and static asset delivery
- `scripts/assemble-worker.mjs`: deterministic self-contained Worker assembly

## Useful development gates

1. Pass the full final-code test suite and inspect scenario conservation and rejection reasons
2. Verify UI behavior for reset, double clicks, condition changes during AI requests and interrupted rehearsal
3. Verify an actual supported protocol's withdrawal calculation and transaction simulation before labelling any route executable
4. Verify Hyperliquid abstraction mode before reading balance sources; never sum unified spot and perp account values
5. Treat cross-chain steps as non-atomic; partial completion requires fresh state and a new plan
6. Keep review, approval and execution separate. No risk threshold may be silently relaxed to satisfy a cash goal

## Primary references

- https://hyperliquid.gitbook.io/hyperliquid-docs/trading/account-abstraction-modes
- https://hyperliquid.gitbook.io/hyperliquid-docs/trading/margining
- https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint
- https://developers.circle.com/cctp/howtos/withdraw-usdc-from-hypercore-to-solana
- https://developers.openai.com/api/docs/guides/structured-outputs

This is a product and engineering prototype, not an investment recommendation or an assurance that a real-world exit is safe or available.
