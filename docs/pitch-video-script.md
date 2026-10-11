# Pitch video script (2:30 target, 3:00 hard limit)

Record with Loom or screen + webcam. Hook first, bio second. Show the live site from 1:00. Say every number as "as of October 12".

**0:00 – 0:20 · Hook** *(Phantom showing a SOL balance and a SOL short in Perps)*
"Long SOL in Phantom, short SOL on Hyperliquid: a hedge that has paid shorts about 9% a year in funding. Tonight you need $5,000." *(0:08)* "Pull margin and your liquidation price drops. Sell SOL and you're net short. Kamino's USDC pool is 93% lent out." *(0:14, ExitPlan loading both chains)* "ExitPlan is the pre-flight check: both chains, your rules, your fees, and every leg rehearsed read-only before you sign: two Solana simulations and the Hyperliquid order built on the live book."

**0:20 – 0:30 · Who**
"I'm Pluto. I contribute to Solana developer tooling, and I built this alone during the hackathon."

**0:30 – 0:55 · Problem and why now**
"Phantom put Hyperliquid perps inside a Solana wallet, so this position is now mainstream: SOL and USDC, often in Kamino, on Solana; a Hyperliquid short on the other side. The state lives in three apps, so people unwind by feel, in the wrong order. Hyperliquid's SOL perp carries about 5.7 million SOL of open interest, Unified accounts now let one spot balance back every perp, and Circle's CCTP sends USDC from HyperCore straight to a Solana token account. Opening the hedge is one tap. Unwinding it is still three apps and a guess."

**0:55 – 1:10 · What it does**
"ExitPlan takes a cash goal and the rules you refuse to break: no new debt, keep net exposure, keep my SOL, keep a margin floor. It reads both chains by address, verifies the Hyperliquid account mode on HyperCore, evaluates dozens of routes sized in the exchange's own lot, prices each one with your own taker fee and the carry it gives up, shows the ones that fit, explains the ones that don't, simulates the Solana legs and builds the Hyperliquid order before you sign."

**1:10 – 2:00 · Demo clip** (from the demo video)
- Two addresses, or a read-only wallet connect → the pre-flight readout: "account mode verified", net exposure, liquidation distance, margin buffer against your floor next to the exchange's own withdrawable, Kamino pool cash, wallet USDC, carry.
- Keep-SOL with no debt: no route. "What would make it work" → trim both legs → a route appears, net exposure unchanged, "carry given up $14 a year" on the card.
- One rejection reason read aloud.
- Rehearsal, three legs: the Hyperliquid step walks the live order book and shows the exact unsigned reduce-only order you would sign, with the cost against the plan. The Kamino step: "Kamino's SDK built the real withdrawal, Solana simulated it, and it would deliver exactly the planned USDC." The sell step: "Jupiter built the exact swap; it succeeds within a fraction of a percent of the plan. Nothing was signed or sent."
- Margin math: "On live Standard and Unified accounts the model's withdrawable matches Hyperliquid's own number within a dollar, to the cent on the standard example."
- Copy the pre-flight report; AI prompt for ten seconds, confirmed before anything applies.

**2:00 – 2:25 · Market and business**
"Who: Phantom Perps and Hyperliquid traders holding SOL on Solana, and funding farmers running delta-neutral books. Free planner. First revenue is a watch tier: a standing pre-flight that alerts when a plan stops being feasible, carry flips or liquidation gets close. Then the same check embedded in wallets and front-ends that already earn builder fees, and once execution exists, a Hyperliquid builder code on the short leg and a Jupiter integrator fee on the Solana leg."

**2:25 – 2:45 · What is real, what is next**
"Read-only today, by design: real positions, a verified account mode, exchange-matching margin math, your own fees, carry, lot-sized routes, two real Solana simulations and the Hyperliquid order built but never sent. Standard and Unified accounts. Next: one-click execution. Phantom signs the Solana leg, a builder code routes the short, CCTP brings the USDC home. Everything is MIT, and the route engine is a pure module anyone can import."

**2:45 – 2:55 · Close**
"ExitPlan: the pre-flight check before you unwind. Link in the submission. Thanks."

Do not say "safe", "real-time" or "audited". Say "read at load time", "nothing is signed", and, if you mention reviews, call them AI-assisted (Claude, Codex and Claude Opus), not independent.
