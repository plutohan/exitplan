# Colosseum submission copy

**Product name:** ExitPlan

**One-liner:** ExitPlan is the pre-flight check for raising cash from a Solana–Hyperliquid hedge: routes that keep your exposure, margin and debt rules, with the Solana transactions simulated before you sign.

**Description (≤ 1,500 characters):**
ExitPlan is a read-only pre-flight check for the most common cross-chain position on Solana today: SOL spot and USDC (often in Kamino) on Solana, hedged by a SOL short on Hyperliquid. You enter a USDC target and the rules you refuse to break — new-debt cap, keep net SOL exposure, keep SOL quantity, minimum margin buffer. ExitPlan reads both chains by address or Phantom connect, verifies the Hyperliquid account mode on HyperCore, and evaluates dozens of routes: wallet USDC first, Kamino withdrawals capped by the pool's real liquidity, paired spot-and-short trims that keep exposure, short reductions that release margin, and borrowing as a comparison. Every route that fits is shown with fees and the liquidation price before and after; every route that fails says why, and the app proposes the smallest rule change that would work. The rehearsal builds the real unsigned transactions for the Solana legs — a Jupiter swap and a Kamino withdrawal via the SDK — runs Solana simulateTransaction on both and reports what would actually arrive. An AI panel turns natural language into a proposal that applies only after confirmation. Margin math matches the exchange to the cent on a live account. Deterministic integer-cent engine, fail-closed validation, MIT.

**Problem:** Phantom put Hyperliquid perps inside a Solana wallet, so a common SOL position now spans two chains: SOL and USDC (often in Kamino) on Solana, and a Hyperliquid short that hedges it and earns funding. When you need cash, every lever breaks something: sell SOL and you are net short, pull margin and your liquidation price drops, borrow and you carry debt you swore off. The state lives in three apps, so people unwind by feel, in the wrong order.

**Why now (verified 2026-10-11 unless marked):**
- The hedge is big and it pays: Hyperliquid's SOL perp holds about 5.73M SOL (~$642M) of open interest, and funding paid shorts about 8.8% annualized over Oct 4–11, positive in 158 of 168 hours (Hyperliquid info API).
- The cash path is one action: Circle documents withdrawing USDC from a HyperCore perp balance straight into a Solana token account through CCTP (`sendToEvmWithData`, destination domain 5).
- Exit liquidity is not guaranteed: Kamino's main-market USDC reserve was 93.2% utilized ($112.5M borrowed of $120.7M), leaving about $8.2M withdrawable (Kamino API).
- Third-party estimate: Phantom Perps has routed tens of billions of dollars of Hyperliquid volume since July 2025 (DefiLlama lists more than $50B cumulative).

**Wedge:** A read-only pre-flight for the most common hedged structure (SOL spot + wallet/Kamino USDC + Hyperliquid SOL short) on Standard Hyperliquid accounts, with explanations and real Solana simulations, before any execution product. Unified accounts are next.

**Target user:** Phantom Perps and Hyperliquid traders holding SOL on Solana; delta-neutral funding farmers.

**Business model:** The pre-flight is free. A route that passes pre-flight is the one you execute: a Hyperliquid builder code on the short leg and a Jupiter referral on the Solana leg, per executed route; a watch tier that alerts when a plan stops being feasible or liquidation gets close; and the same check embedded as a drop-in sheet in wallets and front-ends that already earn builder fees.

**Blockchains integrated:** Solana — mainnet RPC (getBalance, simulateTransaction), Kamino Lend main-market API (obligations, reserve liquidity) and Kamino SDK (unsigned withdraw transaction build, server side), Jupiter (quote, unsigned swap build, wallet balances), Phantom / OKX / any injected wallet (read-only connect for the Solana and EVM addresses). Hyperliquid — HyperCore info API (clearinghouseState, userAbstraction account-mode verification, allMids, liquidation price). Circle CCTP HyperCore→Solana is modelled, not executed. HyperEVM: not used.

**Tools:** Solana JSON-RPC via publicnode and the public mainnet RPC, Kamino API and @kamino-finance/klend-sdk, Jupiter lite API, Hyperliquid info API, Phantom provider (read-only), OpenAI Responses API (structured output, server side), Vercel Functions, Node test runner, LinkeDOM.

**Team:** Solo — Pluto Han, Solana tooling contributor (UAE).

**Pre-existing code disclosure:** Everything was built on 2026-10-11 (UTC+4), inside the window, by one person with AI coding assistants. The synthetic engine and UI were generated that morning with OpenAI's app tooling and imported as the first commit; the real-data adapters, deployment, English copy and three independent code reviews followed the same day. Nothing predates the window.

**Links:** Live https://exitplan-rouge.vercel.app · Repository https://github.com/plutohan/exitplan · Pitch video and demo video: attached in the form.
