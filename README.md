# ExitPlan — the pre-flight check for unwinding a Solana–Hyperliquid hedge

**Live:** https://exitplan-rouge.vercel.app · **Hackathon:** Crypto World's Fair 2026 (Solana and Hyperliquid tracks) · **License:** MIT

ExitPlan is the pre-flight check for raising cash from a Solana–Hyperliquid hedge: it finds the routes that keep your exposure, margin and debt rules, explains the routes that fail, and simulates the Solana transactions before you sign.

Phantom put Hyperliquid perps one tap away from Solana spot, so a common position now spans two chains: SOL and USDC (often in Kamino) on Solana, and a Hyperliquid short that hedges it and earns funding. When you need cash, every lever breaks something: sell SOL and you are net short; pull margin and your liquidation price drops; withdraw from Kamino and you depend on a pool that is 93% lent out. No app sees both sides, so people unwind by feel and learn what broke after they sign.

You give ExitPlan a **cash goal plus the limits you refuse to break** (new-debt cap, keep net SOL exposure, keep-SOL-quantity, minimum margin buffer). It reads both chains by address, evaluates dozens of routes, shows every route that fits and every route that does not, with the reason, and rehearses the chosen route with real `simulateTransaction` runs for the Solana legs. Nothing is signed or sent. Standard Hyperliquid accounts today; Unified accounts next.

## What is real in this build

- **Real positions by address, Phantom connect, or a deep link.** Enter a Solana wallet and a Hyperliquid address, press *Connect wallet (read-only)* (Phantom, OKX or any injected wallet: it reads the Solana address and the EVM address used on Hyperliquid, never signs), open a `#sol=…&hl=…&target=…` link, or press *Load public example*. The browser reads them read-only from public APIs: SOL balance (publicnode RPC), Kamino main-market USDC deposits and borrows (Kamino API), the SOL short, equity, withdrawable and other positions on Hyperliquid (public info API), the HyperCore account mode (`userAbstraction`), USDC already sitting in the wallet (Jupiter balances, used first at zero fee), and a live Jupiter quote for SOL → USDC.
- **Real transaction simulation, two legs.** In the rehearsal, the Solana sell leg builds an unsigned Jupiter swap for the entered wallet and runs Solana `simulateTransaction` (signature verification off, fresh blockhash). The Kamino withdrawal leg builds the real unsigned withdraw transaction with Kamino's SDK in a server function (create ATA if needed, refresh reserve, refresh obligation, withdraw and redeem), simulates it the same way, and reads the wallet's USDC token account from the simulation to report **what would actually arrive** against the plan. You see success or the exact program error, compute units and the instruction list. Nothing is ever sent.
- **Margin math that matches the exchange.** For a live four-position account the model's withdrawable equals Hyperliquid's reported withdrawable to the cent, and the mark comes from the position's own value; the liquidation estimate is anchored on the exchange's number.
- **Deterministic route engine** that enumerates withdrawals, sales, paired unwinds, short-only reductions with released margin, and borrowing comparisons, with integer-cent arithmetic, fail-closed validation and 193 automated tests, including a 650-plan conservation grid.
- **AI intent with confirmation.** Describe the goal in your own words; a server function turns it into a constraint proposal (OpenAI structured output, validated against a schema), and nothing applies until you confirm.
- **Liquidation price before and after.** The exchange's own liquidation price is shown at load, and after a route an estimate anchored on that price (maintenance margin = 1 / (2 × max leverage)) shows where it would move. It is labelled an estimate.
- **Kamino withdraw capacity capped by reserve liquidity** read from Kamino's reserve metrics at load.
- **Public Hyperliquid market reference** (SOL perp mid) shown next to the planning price, never silently substituted.

## What is not real (yet)

- No execution. No wallet connection, signing, sending, bridging, borrowing or trading.
- Hyperliquid order and withdrawal steps are listed but not simulated (they need signed exchange requests).
- Fees other than the Jupiter-quoted sale, the 10% margin reserve, durations and borrowing terms are model assumptions and are labelled as such in the app.
- **Standard Hyperliquid accounts today.** The account mode is verified on HyperCore: `disabled` or `default` import; Unified and portfolio-margin accounts keep USDC in the spot balance, which this version does not read, so they are rejected with that explanation. Unified support is the first item on the roadmap. Vault addresses (for example HLP) are rejected as not being user accounts. Margin used by other open positions is treated as locked.
- Only Kamino obligations that hold USDC alone are supported; mixed-asset obligations and any existing borrow are rejected with a reason.
- The 10% margin reserve mirrors Hyperliquid's 10%-of-notional withdrawal floor, not its maintenance margin. The after-route liquidation price is a model estimate for the SOL position alone, anchored on the exchange's number, with other positions held constant.
- Carry is not modelled: closing part of the short gives up funding and withdrawing from Kamino gives up supply yield; routes are ranked by upfront model fees only.
- The minimum margin buffer only blocks routes that lower the Hyperliquid buffer; an account that already sits under the floor can still raise cash on Solana. On import, a floor above the current buffer is lowered to half the buffer and the app says so.
- Ranking means lowest upfront fees among a bounded set of evaluated candidates (dozens, not all), not a global optimum or financial advice.

## Try it

1. Open the live site. The default is a synthetic scenario (100 SOL, 3,000 USDC deposited, 100 SOL short). Walk the three guided scenarios.
2. Switch **Portfolio source** to *Import by address*, paste a Solana wallet and a Hyperliquid address (public examples in `docs/demo-addresses.md`) and load.
3. Set a target, compare routes, open a rejected route to read why. If nothing fits, the banner offers concrete relaxations that do ("Allow selling SOL (keep net exposure) → $5,000 route"). Select a route and open the rehearsal. On the sell step, press *Simulate on Solana (read-only)*. *Copy plan link* gives a shareable deep link.

## Run locally

Requires Node.js 20+. The browser app has no dependencies; the Kamino simulation function uses `@kamino-finance/klend-sdk` and `@solana/kit` on the server, and LinkeDOM powers the DOM tests.

```sh
npm ci --ignore-scripts
npm test                       # 193 tests: engine, adapters, server, UI
npx vercel dev                 # serves web/ and the api/ functions
```

AI needs two server-side environment variables, never in the browser: `OPENAI_API_KEY` and `OPENAI_MODEL`. Without them the AI panel says it is offline and everything else works. The Kamino simulation uses the public Solana RPC by default; set `SOLANA_RPC_URL` to use your own. `package.json` pins `uuid@9` under `rpc-websockets` (an `@solana/web3.js` 1.x dependency of the SDK) because the serverless runtime cannot `require()` the ESM-only `uuid@14`.

## Use the engine as a library

`web/engine.mjs` is a dependency-free ES module (Node 20+ or any browser) with no I/O: give it a portfolio and constraints, get every evaluated route back with the reasons it was accepted or rejected.

```js
import { createDemoPortfolio, defaultConstraints, planExit } from './web/engine.mjs';

const result = planExit(createDemoPortfolio(), { ...defaultConstraints(), target: 5000, preserveHedge: false });
console.log(result.best.id, result.best.netCash, `${result.feasible.length} of ${result.plans.length} routes fit`);
for (const plan of result.plans.filter(p => !p.feasible)) console.log(plan.id, plan.rejections);
```

The portfolio shape is documented in `docs/engine.md`; the adapters in `web/adapters/` show how to build one from public APIs.

## Architecture

```mermaid
flowchart LR
  A[Solana address] --> S[adapters/solana.mjs<br/>RPC balance · Kamino obligations + liquidity · Jupiter quote + wallet balances]
  B[Hyperliquid address] --> H[adapters/hyperliquid.mjs<br/>clearinghouseState · allMids · userAbstraction]
  S --> P[imported portfolio]
  H --> P
  P --> E[engine.mjs<br/>pure route enumeration + constraint checks]
  E --> U[app.mjs<br/>compare · reject reasons · suggestions · rehearsal]
  U --> R[adapters/rehearsal.mjs<br/>Jupiter swap build → simulateTransaction]
  U --> K[api/kamino-withdraw.js<br/>Kamino SDK → unsigned withdraw → simulateTransaction]
  U --> I[api/intent.js<br/>OpenAI structured output → proposal → confirm]
```


```
browser (web/)                                     Vercel functions (api/)
  engine.mjs        pure route enumeration           status.js   capability flags
  adapters/         read-only public API clients     market.js   Hyperliquid SOL mid
    hyperliquid.mjs info API → engine shape          intent.js   OpenAI structured output
    solana.mjs      RPC + Kamino + Jupiter → shape    server/     shared handlers + tests
    rehearsal.mjs   Jupiter swap → simulateTransaction; Kamino withdraw via api/
                                                       kamino-withdraw.js  Kamino SDK → unsigned withdraw → simulateTransaction
  app.mjs           constraints, comparison, rehearsal, AI confirmation
```

Every adapter fails closed with a reason code; the UI never substitutes cached or scenario numbers when a load fails. The engine accepts `evidence: 'scenario'` or `'imported'` and carries that label onto every plan card.

## Disclosure

All commits are dated 2026-10-11 (UTC+4), inside the hackathon window, by a solo builder working with AI coding assistants. The synthetic engine and UI were generated that morning with OpenAI's app tooling and imported as the first commit, which is why the history starts from a complete snapshot; the real-data adapters, Vercel deployment, English copy and three independent reviews (one Claude, one Codex, one Claude Opus) followed the same day. No code predates the window. Public addresses listed in `docs/demo-addresses.md` belong to other people; they are read-only examples and are not ours.

## Documents

- `docs/engine.md` — route engine contract and verified examples
- `docs/integrations.md` — API boundaries and what each adapter does and does not claim
- `docs/demo-addresses.md` — public example addresses
- `docs/pitch-video-script.md`, `docs/demo-video-script.md`, `docs/submission-copy.md`
- `docs/superpowers/specs/` and `docs/superpowers/plans/` — design spec and implementation plan

This is a planning prototype, not investment, lending or tax advice, and not an assurance that any real exit is safe or available.
