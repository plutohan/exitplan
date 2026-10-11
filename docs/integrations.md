# ExitPlan integration boundaries

## Browser adapters (read-only)

`web/adapters/hyperliquid.mjs` — `importHyperliquid(address)` posts `clearinghouseState` and `allMids` to the public info API. Accepts a cross-margin SOL short or no SOL position; a SOL long or isolated-margin SOL is rejected. Other coins are allowed and their `marginUsed` is deducted from equity as locked. Equity below the 10% model reserve is rejected (`LEVERAGE_TOO_HIGH`). The mid is rounded to cents; the standard account mode is assumed, not verified.

`web/adapters/solana.mjs` — `importSolana(address)` runs `getBalance` on publicnode, reads Kamino main-market obligations and quotes 1 SOL → USDC on Jupiter. Only USDC-only obligations are accepted; any borrow is reported as debt and the engine rejects it. The sale fee is `max(30, 50 + priceImpact bps)`.

`web/adapters/rehearsal.mjs` — `simulateSellSol({ address, solAmount })` quotes the exact amount, builds an unsigned swap with Jupiter for the entered wallet and runs `simulateTransaction` with `sigVerify: false` and `replaceRecentBlockhash: true`. It reports success or the error, compute units and log count. It never calls `sendTransaction`.

All adapters: 8-second timeout, `redirect: 'error'`, `credentials: 'omit'`, no caching, bounded response size, and an `AdapterError` with a code on every failure. The UI never substitutes previous or scenario numbers when a load fails.

## Server (Vercel functions)


## Implemented: public Hyperliquid SOL reference

`server/hyperliquid.mjs` exports:

```js
import { getMarketSnapshot, HyperliquidDataError } from './server/hyperliquid.mjs';
const snapshot = await getMarketSnapshot();
```

The sole outbound request is an unauthenticated POST to `https://api.hyperliquid.xyz/info`, containing `{"type":"allMids"}`. There is no account address, credential, signature, trading request, or transaction. The request does not follow redirects or send cookies.

The response includes `evidence: "live-market"`, `source`, `url`, `requestedAt`, `observedAt`, `sourceTimestamp: null`, numeric `solUsd`, preserved textual `solPriceRaw`, `priceKind: "perpetual-mid-or-last-trade"`, `executable: false`, and human-readable caveats. `observedAt` is local receipt time, not proof that the upstream quote is recent. SOL identifies a native perpetual market reference, not an on-chain Solana swap or Hyperliquid spot pair. The endpoint can report a last trade when the book is empty. See the [official info endpoint documentation](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#retrieve-mids-for-all-coins).

Defaults are a 5-second deadline and the global `fetch`. Tests can inject `fetchImpl`, `now`, and `timeoutMs`. The deadline covers HTTP and body reading, aborts the fetch, and rejects even if an injected fetch ignores cancellation. HTTP failures, malformed JSON, wrong content types, oversized responses, and absent or invalid SOL prices are errors. Error codes are `HTTP_ERROR`, `NETWORK_ERROR`, `TIMEOUT`, `INVALID_RESPONSE`, `INVALID_JSON`, `MISSING_PRICE`, `INVALID_DATA`, or `INVALID_OPTIONS`. HTTP errors additionally expose `status`. The adapter never substitutes a scenario price.

## Implemented utility: offline standard-account import

`normalizeImportedAccount(payload, { now })` performs no network activity and stores nothing. It is an internal normalization utility, not a wallet connection or a shipped import interface. Its input envelope is:

```json
{
  "accountMode": "standard",
  "userAbstraction": "disabled",
  "dex": "",
  "clearinghouseState": {
    "time": 1791723599000,
    "marginSummary": { "accountValue": "1200", "totalMarginUsed": "0" },
    "withdrawable": "1200",
    "assetPositions": []
  },
  "spotClearinghouseState": {
    "balances": [{ "coin": "USDC", "token": 0, "total": "600", "hold": "100" }]
  }
}
```

This example is synthetic and not a user's account. The mode assertions are supplied by the importer and remain unverified. Unknown, missing, default, unified-account, portfolio-margin, and DEX-abstraction modes are rejected, as are missing or non-native DEX identifiers. Current documentation states that unified-account and portfolio-margin balances belong to the spot state, so treating them like separate standard spot/perp balances would be unsafe. [Account abstraction documentation](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/account-abstraction-modes)

The output is labeled `evidence: "imported-account"`. `perpsEquityUsd` is read once from `marginSummary.accountValue`. Position notional, unrealized PnL, cross equity, and withdrawable are not added to it. Negative equity is preserved. Position data are disclosures, not a recomputed risk model. [Perpetual-account response schema](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals#retrieve-users-perpetuals-account-summary)

Spot entries retain token IDs, totals, holds, and arithmetic unheld amounts. They have `valueUsd: null`; an absent spot export remains `null`, not zero. Tokens are not identified or priced from display names, and USDC is not silently assigned a guaranteed dollar value. Duplicate position symbols or token IDs are rejected. `combinedAccountValueUsd` is always `null`. Source and import timestamps remain distinct. No freshness, ownership, withdrawal ability, or liquidation outcome is guaranteed. [Spot-account response schema](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/spot)

## UI and service integration rules

- Keep market evidence separate from user-entered scenario holdings and assumptions
- A live reference price does not turn a hypothetical scenario into a verified portfolio
- Surface unavailable market data explicitly; never relabel a previous/scenario price as current live data
- Preserve reference-price caveats, source link, and receipt timestamp
- Do not add a combined total by summing the import's equity, PnL, margin, notional, spot totals, or withdrawable fields
- Imported data exclude other DEXs, vaults, staking, lending, subaccounts, and Solana holdings
- No Solana RPC, wallet adapter, quote router, trade execution, signing, or account-linking integration is implemented here
- Numbers use JavaScript floating point with strict finite/range validation. This is not exact decimal accounting or an execution-grade precision guarantee

## Verification

Run `node --test tests/hyperliquid.test.mjs` from the project root. All 17 tests passed on 2026-10-11, covering public request boundaries, evidence labels, invalid/missing prices, HTTP/JSON/body failures, network errors, both timeout paths, account-mode rejection, duplicate rejection, and non-double-counting.

One real unauthenticated request succeeded on 2026-10-11: the public endpoint returned SOL `109.475`, received at `2026-10-11T13:42:21.340Z`. This historical smoke-test observation is not a current quote, stored application default, verified holding, or execution result. No account data were requested.
