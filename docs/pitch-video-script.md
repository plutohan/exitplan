# Pitch video script (2:30 target, 3:00 hard limit)

Record with Loom or screen + webcam. Speak plainly. Show the live site at 1:10.

**0:00 – 0:15 · Who**
"Hi, I'm Pluto, a Solana tooling contributor based in the UAE. I build and audit Solana programs and client tooling. ExitPlan is a solo build from this hackathon."

**0:15 – 0:50 · Problem**
"If you hedge SOL — spot on Solana, deposits in Kamino, a short on Hyperliquid — you have a problem every time you need cash: *which legs do I unwind?* Selling spot breaks the hedge. Pulling margin can liquidate the short. Borrowing adds debt. Every dashboard shows balances. None of them answer the question: how much can I take out without breaking the rules I set for myself?"

**0:50 – 1:10 · Insight**
"ExitPlan treats cash as a goal and your limits as hard constraints: no new debt, keep the hedge, keep my SOL, keep a margin buffer, done within a day. It enumerates the routes across both venues, shows the ones that fit, and explains exactly why the others don't. Then it rehearses the chosen route before you touch anything."

**1:10 – 2:00 · Demo clip** (from the demo video, muted or narrated)
- Paste a Solana wallet and a Hyperliquid address → real positions load, labelled IMPORTED.
- Target $5,000 with keep-SOL on → no route; open a rejected route: "$2,001 short of the target".
- Relax keep-SOL, keep the hedge → a paired route appears: sell 2.7 SOL, reduce the short by 2.7 SOL, net exposure unchanged.
- Rehearsal: "Simulate on Solana" → real `simulateTransaction` on the unsigned Jupiter swap: success, 91k compute units, quoted USDC.
- AI panel: "I need $3,000, no new debt" → proposal shown, applied only after confirming.

**2:00 – 2:25 · Market and business**
"Who needs this: Phantom now ships Hyperliquid perps inside the wallet, so 'Solana spot plus a Hyperliquid short' is a mainstream position. Delta-neutral farmers, treasuries and anyone borrowing against SOL face the same unwind question. The planner is free; the business is in what comes after a plan: alerts when a plan stops being feasible, and execution through partners — Jupiter, Kamino, Hyperliquid, Circle's CCTP route back to Solana — with a routing fee."

**2:25 – 2:45 · What is real, what is next**
"Today: real positions, real quotes, real Solana simulation, no execution. Next: wallet connect, simulating the Kamino and Hyperliquid legs, multi-asset hedges, and a watch mode. Everything is open source under MIT."

**2:45 – 2:55 · Close**
"ExitPlan: the cash you need, planned — without silently breaking your hedge. Link in the submission. Thanks."
