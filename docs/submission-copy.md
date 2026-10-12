# Colosseum submission copy

**Product name:** ExitPlan

**One-liner:** ExitPlan is a read-only pre-flight check for raising cash from a Solana–Hyperliquid SOL hedge: it finds the routes that keep your exposure, margin and debt rules, prices them with your own fees and funding, and simulates the Solana transactions before you sign.

**Description (≤ 1,500 characters):**
Hedged SOL in Phantom, short on Hyperliquid, need cash? ExitPlan shows which unwind keeps you hedged, within your margin floor and debt-free, and rehearses every leg on both chains before you sign. Read-only. Enter a USDC target and the rules you won't break: debt cap, keep net exposure, keep SOL, minimum margin buffer. ExitPlan reads both chains by address and verifies the Hyperliquid account mode: Standard and Unified accounts are supported; portfolio margin is rejected. It evaluates every route from wallet USDC and liquidity-capped Kamino withdrawals to paired spot-and-short trims sized in the exchange's 0.01 SOL lot, short reductions that release margin, and borrowing as a comparison. Margin follows Hyperliquid's transfer rule, and on the live accounts we tested the model's withdrawable matched the exchange's within a dollar, to the cent on the standard example. Each route shows fees at your own taker rate, the yearly carry it gives up, and the liquidation price before and after. The rehearsal simulates the Jupiter swap and the Kamino withdrawal with simulateTransaction, links each unsigned transaction to Solana Explorer's inspector, and walks the live Hyperliquid order book to build the inner reduce-only order for the buy-back. An AI panel turns plain English into constraints you confirm. Nothing is signed or sent.

**Problem:** Phantom put Hyperliquid perps inside a Solana wallet, so a common SOL position now spans two chains: SOL and USDC (often in Kamino) on Solana, and a Hyperliquid short that hedges it and earns funding. When you need cash, every lever breaks something: sell SOL and you are net short, pull margin and your liquidation price drops, borrow and you carry debt you swore off. The state lives in three apps, so people unwind by feel, in the wrong order.

**Why now (verified 2026-10-11 unless marked):**
- The hedge is big and it pays: Hyperliquid's SOL perp holds about 5.73M SOL (~$642M) of open interest, and funding paid shorts about 8.8% annualized over Oct 4–11, positive in 158 of 168 hours (Hyperliquid info API).
- Unified accounts (Hyperliquid, 2026) let one spot USDC balance back every perp, which makes "how much can I take out?" harder to read, not easier; ExitPlan reads the spot state and matches the exchange's withdrawable on a live unified account (verified 2026-10-12).
- The cash path exists but its price is not quoted here: Circle documents withdrawing USDC from a HyperCore perp balance straight into a Solana token account through CCTP (`sendToEvmWithData`, destination domain 5).
- Exit liquidity is not guaranteed: Kamino's main-market USDC reserve was 93.2% utilized ($112.5M borrowed of $120.7M), leaving about $8.2M withdrawable (Kamino API).

**Wedge:** A read-only pre-flight for the most common hedged structure (SOL spot + wallet/Kamino USDC + Hyperliquid SOL short) on Standard and Unified Hyperliquid accounts, with explanations and real Solana simulations, before any execution product.

**Target user:** Funding farmers running a SOL delta-neutral book across Phantom and Hyperliquid, roughly $5k–$500k per book; then any Hyperliquid trader whose collateral and spot live on Solana.

**Business model:** The pre-flight is free. Stage one, a watch tier at $10/month: a standing pre-flight on a position that alerts when the plan stops being feasible, carry flips or liquidation gets close (the recurring need is the watch, not the unwind). Stage two, the same check embedded as a drop-in sheet in wallets and front-ends that already earn builder fees, on a revenue share. Stage three, once execution ships, a Hyperliquid builder code of a few bps on the short leg plus a Jupiter platform fee on the Solana leg (a $10k unwind at 5 bps is $5; a thousand unwinds a month is $5k, a floor, not the plan). Thirty-day milestone: twenty watch-tier sign-ups and one wallet or front-end integration conversation.

**Why it fits the Hyperliquid track:** ExitPlan reads a Hyperliquid account through the public info API, confirms its Standard or Unified mode with `userAbstraction` (and establishes a `default` setting from the balances), and on the live accounts we tested its free-collateral figure came within a dollar of the exchange's own withdrawable, to the cent on the standard example. Every short reduction is sized in the 0.01 SOL lot read from `meta`, priced at the user's own `userFees` taker rate plus a 10 bps execution allowance, and checked against the $10 minimum. The rehearsal then walks the live `l2Book` and shows the inner unsigned reduce-only IOC order (asset index, size, tick-rounded limit) the user would sign, withholds it when the book is stale, and never sends it.

**Why it fits the Solana track:** Positions come from Solana RPC, the Kamino API and Jupiter by address; the rehearsal builds the real Kamino withdrawal with the Kamino SDK and the real Jupiter swap, runs both through `simulateTransaction`, reports what would arrive against the plan, and links each unsigned transaction to Solana Explorer's inspector. The route engine and report are dependency-free modules that also run from the terminal.

**Blockchains integrated:** Solana — mainnet RPC (getBalance, simulateTransaction), Kamino Lend main-market API (obligations, reserve liquidity and supply APY) and Kamino SDK (unsigned withdraw transaction build, server side), Jupiter (quote, unsigned swap build, wallet balances), a read-only wallet connect for the Solana and EVM addresses (addresses only; no signing). Hyperliquid — HyperCore info API (clearinghouseState, spotClearinghouseState for unified accounts, userAbstraction account-mode verification, vaultDetails, allMids, fundingHistory, userFees, meta, l2Book, liquidation price). Circle CCTP HyperCore→Solana is modelled, not executed. HyperEVM: not used.

**Tools:** Solana JSON-RPC via publicnode and the public mainnet RPC, Kamino API and @kamino-finance/klend-sdk, Jupiter lite API, Hyperliquid info API, Phantom provider (read-only), OpenAI Responses API (structured output, server side), Vercel Functions, Node test runner, LinkeDOM.

**Team:** Solo — Pluto Han, Solana tooling contributor (UAE).

**Pre-existing code disclosure:** Everything was built on 2026-10-11 and 2026-10-12 (UTC+4), inside the window, by one person with AI coding assistants. The synthetic engine and UI were generated on the morning of the 11th with OpenAI's app tooling and imported as the first commit; the real-data adapters, deployment, English copy and several rounds of AI-assisted code review (Claude, Codex, Claude Opus) followed over the two days. Nothing predates the window.

**Links:** Live https://exitplan-rouge.vercel.app · Repository https://github.com/plutohan/exitplan · Pitch video and demo video: attached in the form.
