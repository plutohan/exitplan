# Colosseum submission copy

**Product name:** ExitPlan

**One-liner:** Cash-goal planner for hedged Solana + Hyperliquid positions: tell it how much USDC you need and which limits you refuse to break, and it shows every route that fits, why the others fail, and rehearses the winner with a real Solana simulation.

**Description (≤ 1,500 characters):**
ExitPlan answers one question for people who hedge SOL across Solana and Hyperliquid: how do I raise cash without silently breaking my own rules? You enter a USDC target and constraints — new-debt cap, keep net SOL exposure (sell spot and cut the short equally), keep SOL quantity, minimum margin buffer, planning window. The engine enumerates withdrawal, sale, short-reduction and borrowing combinations across both venues, accepts only routes that satisfy every constraint, and explains each rejection in plain words. Positions are imported read-only by address: SOL balance and Kamino deposits on Solana, the SOL short and equity on Hyperliquid, and a live Jupiter quote. The rehearsal builds an unsigned Jupiter swap for the sell leg and runs Solana simulateTransaction, showing the real result without sending anything. An AI panel turns natural language into a constraint proposal that applies only after confirmation. Deterministic integer-cent math, fail-closed validation, 142 tests, MIT.

**Problem:** Dashboards show balances; nobody shows which legs to unwind under constraints. Mistakes break hedges, trigger liquidations or create unwanted debt.

**Wedge:** Read-only planning for the most common hedged structure (SOL spot + Kamino USDC + Hyperliquid SOL short), with explanations and a real simulation, before any execution product.

**Target user:** Phantom Perps and Hyperliquid users who hold SOL on Solana, delta-neutral farmers, and small treasuries borrowing against SOL.

**Business model:** Free planner. Paid: feasibility alerts (a plan stops working when prices or funding move), and execution through partner routes (Jupiter, Kamino, Hyperliquid, Circle CCTP to Solana) with a routing fee.

**Blockchains integrated:** Solana (RPC balance, Kamino lending API, Jupiter quote and swap build, simulateTransaction), Hyperliquid (HyperCore public info API: positions, equity, mids).

**Tools:** @solana JSON-RPC via publicnode, Kamino API, Jupiter lite API, Hyperliquid info API, OpenAI Responses API (structured output, server side), Vercel Functions, Node test runner, LinkeDOM.

**Team:** Solo — Pluto Han, Solana tooling contributor (UAE).

**Pre-existing code disclosure:** The synthetic engine and UI were written on the morning of 2026-10-11 with AI coding assistance; the real-data adapters, Vercel deployment and English copy were added the same day and the next. All work is inside the hackathon window.

**Links:** Live https://exitplan-rouge.vercel.app · Repository https://github.com/plutohan/exitplan · Pitch video and demo video: attached in the form.
