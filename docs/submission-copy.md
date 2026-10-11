# Colosseum submission copy

**Product name:** ExitPlan

**One-liner:** ExitPlan is a read-only pre-flight check for raising cash from a Solana–Hyperliquid SOL hedge: it finds the routes that keep your exposure, margin and debt rules, prices them with your own fees and funding, and simulates the Solana transactions before you sign.

**Description (≤ 1,500 characters):**
ExitPlan is a read-only pre-flight check for a position many Phantom users now hold: SOL and USDC (often in Kamino) on Solana, hedged by a SOL short on Hyperliquid. Enter a USDC target and the rules you won't break: debt cap, keep net exposure, keep SOL, minimum margin buffer. ExitPlan reads both chains by address and verifies the Hyperliquid account mode: Standard and Unified accounts are supported; portfolio margin is rejected. It evaluates dozens of routes, from wallet USDC and liquidity-capped Kamino withdrawals to paired spot-and-short trims sized in the exchange's 0.01 SOL lot, short reductions that release margin, and borrowing as a comparison. Margin follows Hyperliquid's transfer rule, and on the live accounts we tested the model's withdrawable equalled the exchange's to the cent. Each route shows fees at your own taker rate, the yearly carry it gives up, and the liquidation price before and after. The rehearsal simulates the Jupiter swap and the Kamino withdrawal with simulateTransaction and walks the live Hyperliquid order book for the buy-back. An AI panel turns plain English into constraints you confirm. Nothing is signed or sent.

**Problem:** Phantom put Hyperliquid perps inside a Solana wallet, so a common SOL position now spans two chains: SOL and USDC (often in Kamino) on Solana, and a Hyperliquid short that hedges it and earns funding. When you need cash, every lever breaks something: sell SOL and you are net short, pull margin and your liquidation price drops, borrow and you carry debt you swore off. The state lives in three apps, so people unwind by feel, in the wrong order.

**Why now (verified 2026-10-11 unless marked):**
- The hedge is big and it pays: Hyperliquid's SOL perp holds about 5.73M SOL (~$642M) of open interest, and funding paid shorts about 8.8% annualized over Oct 4–11, positive in 158 of 168 hours (Hyperliquid info API).
- Unified accounts (Hyperliquid, 2026) let one spot USDC balance back every perp, which makes "how much can I take out?" harder to read, not easier; ExitPlan reads the spot state and matches the exchange's withdrawable on a live unified account (verified 2026-10-12).
- The cash path is one action: Circle documents withdrawing USDC from a HyperCore perp balance straight into a Solana token account through CCTP (`sendToEvmWithData`, destination domain 5).
- Exit liquidity is not guaranteed: Kamino's main-market USDC reserve was 93.2% utilized ($112.5M borrowed of $120.7M), leaving about $8.2M withdrawable (Kamino API).
- Third-party estimate: Phantom Perps has routed tens of billions of dollars of Hyperliquid volume since July 2025 (DefiLlama lists more than $50B cumulative).

**Wedge:** A read-only pre-flight for the most common hedged structure (SOL spot + wallet/Kamino USDC + Hyperliquid SOL short) on Standard and Unified Hyperliquid accounts, with explanations and real Solana simulations, before any execution product.

**Target user:** Phantom Perps and Hyperliquid traders holding SOL on Solana; delta-neutral funding farmers.

**Business model:** The pre-flight is free. A route that passes pre-flight is the one you execute: a Hyperliquid builder code on the short leg and a Jupiter referral on the Solana leg, per executed route; a watch tier that alerts when a plan stops being feasible or liquidation gets close; and the same check embedded as a drop-in sheet in wallets and front-ends that already earn builder fees.

**Blockchains integrated:** Solana — mainnet RPC (getBalance, simulateTransaction), Kamino Lend main-market API (obligations, reserve liquidity and supply APY) and Kamino SDK (unsigned withdraw transaction build, server side), Jupiter (quote, unsigned swap build, wallet balances), Phantom / OKX / any injected wallet (read-only connect for the Solana and EVM addresses). Hyperliquid — HyperCore info API (clearinghouseState, spotClearinghouseState for unified accounts, userAbstraction account-mode verification, vaultDetails, allMids, fundingHistory, userFees, meta, l2Book, liquidation price). Circle CCTP HyperCore→Solana is modelled, not executed. HyperEVM: not used.

**Tools:** Solana JSON-RPC via publicnode and the public mainnet RPC, Kamino API and @kamino-finance/klend-sdk, Jupiter lite API, Hyperliquid info API, Phantom provider (read-only), OpenAI Responses API (structured output, server side), Vercel Functions, Node test runner, LinkeDOM.

**Team:** Solo — Pluto Han, Solana tooling contributor (UAE).

**Pre-existing code disclosure:** Everything was built on 2026-10-11 and 2026-10-12 (UTC+4), inside the window, by one person with AI coding assistants. The synthetic engine and UI were generated on the morning of the 11th with OpenAI's app tooling and imported as the first commit; the real-data adapters, deployment, English copy and several rounds of independent code review (Claude, Codex, Claude Opus) followed over the two days. Nothing predates the window.

**Links:** Live https://exitplan-rouge.vercel.app · Repository https://github.com/plutohan/exitplan · Pitch video and demo video: attached in the form.
