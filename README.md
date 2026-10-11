# ExitPlan — the cash you need, planned

**Live:** https://exitplan-rouge.vercel.app · **Hackathon:** Crypto World's Fair 2026 (Solana and Hyperliquid tracks) · **License:** MIT

You hold SOL on Solana, some USDC in Kamino, and a SOL short on Hyperliquid that hedges it. You need $5,000 in a Solana wallet by tomorrow. Which legs do you unwind? Selling spot breaks the hedge. Pulling margin risks the short. Borrowing adds debt you said you did not want.

ExitPlan takes a **cash goal plus the limits you refuse to break** (new-debt cap, keep net SOL exposure, keep-SOL-quantity, minimum margin buffer, planning window), enumerates the ways to raise the cash across both venues, and shows every route that fits, every route that does not, and **why**. It then rehearses the chosen route step by step. Nothing is signed or sent.

## What is real in this build

- **Real positions by address.** Enter a Solana wallet and a Hyperliquid address. The browser reads them read-only from public APIs: SOL balance (publicnode RPC), Kamino main-market USDC deposits and borrows (Kamino API), the SOL short, equity, withdrawable and other positions on Hyperliquid (public info API), the HyperCore account mode (`userAbstraction`), and a live Jupiter quote for SOL → USDC.
- **Real transaction simulation.** In the rehearsal, the Solana sell leg builds an unsigned Jupiter swap for the entered wallet and runs Solana `simulateTransaction` (signature verification off, fresh blockhash). You see success or the exact error, compute units and the quoted output. The transaction is never sent.
- **Deterministic route engine** with integer-cent arithmetic, fail-closed validation and 159 automated tests, including a 650-plan conservation grid.
- **AI intent with confirmation.** Describe the goal in your own words; a server function turns it into a constraint proposal (OpenAI structured output, validated against a schema), and nothing applies until you confirm.
- **Public Hyperliquid market reference** (SOL perp mid) shown next to the planning price, never silently substituted.

## What is not real (yet)

- No execution. No wallet connection, signing, sending, bridging, borrowing or trading.
- Hyperliquid order and withdrawal steps and the Kamino withdrawal step are listed but not simulated (they need signed exchange requests or a withdrawal transaction builder).
- Fees other than the Jupiter-quoted sale, the 10% margin reserve, durations and borrowing terms are model assumptions and are labelled as such in the app.
- The Hyperliquid account mode is verified on HyperCore: standard accounts (abstraction `disabled` or `default`) are accepted; unified-account, portfolio-margin and DEX-abstraction accounts are rejected with the reason, because their perp state is not meaningful on its own. Margin used by other open positions is treated as locked.
- Only Kamino obligations that hold USDC alone are supported; mixed-asset obligations and any existing borrow are rejected with a reason.
- The 10% margin reserve mirrors Hyperliquid's 10%-of-notional withdrawal floor, not its maintenance margin; the liquidation price is read from the exchange but not re-modelled after a route.
- The minimum margin buffer only blocks routes that lower the Hyperliquid buffer; an account that already sits under the floor can still raise cash on Solana. On import, a floor above the current buffer is lowered to half the buffer and the app says so.
- Ranking means lowest upfront fees among a bounded set of evaluated candidates (dozens, not all), not a global optimum or financial advice.

## Try it

1. Open the live site. The default is a synthetic scenario (100 SOL, 3,000 USDC deposited, 100 SOL short). Walk the three guided scenarios.
2. Switch **Portfolio source** to *Import by address*, paste a Solana wallet and a Hyperliquid address (public examples in `docs/demo-addresses.md`) and load.
3. Set a target, compare routes, open a rejected route to read why, select a route and open the rehearsal. On the sell step, press *Simulate on Solana (read-only)*.

## Run locally

Requires Node.js 20+. The only dependency is LinkeDOM for DOM tests.

```sh
npm ci --ignore-scripts
npm test                       # 159 tests: engine, adapters, server, UI
npx vercel dev                 # serves web/ and the api/ functions
```

AI needs two server-side environment variables, never in the browser: `OPENAI_API_KEY` and `OPENAI_MODEL`. Without them the AI panel says it is offline and everything else works.

## Architecture

```
browser (web/)                                     Vercel functions (api/)
  engine.mjs        pure route enumeration           status.js   capability flags
  adapters/         read-only public API clients     market.js   Hyperliquid SOL mid
    hyperliquid.mjs info API → engine shape          intent.js   OpenAI structured output
    solana.mjs      RPC + Kamino + Jupiter → shape    server/     shared handlers + tests
    rehearsal.mjs   Jupiter swap → simulateTransaction
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
