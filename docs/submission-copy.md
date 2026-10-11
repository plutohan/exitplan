# Colosseum submission copy

**Product name:** ExitPlan

**One-liner:** Raise cash from a SOL hedge split across Solana and Hyperliquid without breaking your own rules. ExitPlan reads both chains by address, finds the routes that keep your net exposure, margin floor and debt limit, explains the routes that fail, and simulates the Solana leg on-chain before you sign.

**Description (≤ 1,500 characters):**
ExitPlan answers one question for people who hedge SOL across Solana and Hyperliquid: how do I raise cash without silently breaking my own rules? You enter a USDC target and constraints — new-debt cap, keep net SOL exposure (sell spot and cut the short equally), keep SOL quantity, minimum margin buffer, planning window. The engine enumerates withdrawal, sale, short-reduction and borrowing combinations across both venues, accepts only routes that satisfy every constraint, and explains each rejection in plain words. Positions are imported read-only by address: SOL balance and Kamino deposits on Solana, the SOL short and equity on Hyperliquid, and a live Jupiter quote. The rehearsal builds an unsigned Jupiter swap for the sell leg and runs Solana simulateTransaction, showing the real result without sending anything. An AI panel turns natural language into a constraint proposal that applies only after confirmation. Deterministic integer-cent math, fail-closed validation, 175 tests, MIT.

**Problem:** Phantom put Hyperliquid perps inside a Solana wallet, so a common SOL position now spans two chains: SOL and USDC (often in Kamino) on Solana, and a Hyperliquid short that hedges it and earns funding. When you need cash, every lever breaks something: sell SOL and you are net short, pull margin and your liquidation price drops, borrow and you carry debt you swore off. The state lives in three apps, so people unwind by feel, in the wrong order.

**Why now:** Phantom Perps has routed roughly $37B of Hyperliquid volume since July 2025 (third-party builder-fee data). Circle's CCTP now sends USDC from HyperCore straight to a Solana token account. Hyperliquid's SOL perp carried about 5.7M SOL (~$640M) of open interest on 2026-10-11. The hedge went mainstream; the exit tooling did not.

**Wedge:** Read-only planning for the most common hedged structure (SOL spot + Kamino USDC + Hyperliquid SOL short), with explanations and a real simulation, before any execution product.

**Target user:** Phantom Perps and Hyperliquid traders holding SOL on Solana; delta-neutral funding farmers.

**Business model:** Free planner. Paid: feasibility alerts (a plan stops working when prices or funding move), and execution through partner routes (Jupiter, Kamino, Hyperliquid, Circle CCTP to Solana) with a routing fee.

**Blockchains integrated:** Solana — mainnet RPC (getBalance, simulateTransaction), Kamino Lend main-market API (obligations, reserve liquidity), Jupiter (quote, unsigned swap build, wallet balances), Phantom (read-only connect for the Solana and Perps addresses). Hyperliquid — HyperCore info API (clearinghouseState, userAbstraction account-mode verification, allMids, liquidation price). Circle CCTP HyperCore→Solana is modelled, not executed. HyperEVM: not used.

**Tools:** Solana JSON-RPC via publicnode, Kamino API, Jupiter lite API, Hyperliquid info API, Phantom provider (read-only), OpenAI Responses API (structured output, server side), Vercel Functions, Node test runner, LinkeDOM.

**Team:** Solo — Pluto Han, Solana tooling contributor (UAE).

**Pre-existing code disclosure:** Everything was built on 2026-10-11 (UTC+4), inside the window, by one person with AI coding assistants. The synthetic engine and UI were generated that morning with OpenAI's app tooling and imported as the first commit; the real-data adapters, deployment, English copy and three independent code reviews followed the same day. Nothing predates the window.

**Links:** Live https://exitplan-rouge.vercel.app · Repository https://github.com/plutohan/exitplan · Pitch video and demo video: attached in the form.
