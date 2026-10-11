# Pitch video script (2:30 target, 3:00 hard limit)

Record with Loom or screen + webcam. Hook first, bio second. Show the live site from 1:00. Say every number as "as of October 11".

**0:00 – 0:20 · Hook** *(Phantom showing a SOL balance and a SOL short in Perps)*
"Long SOL in Phantom, short SOL on Hyperliquid: a hedge that has paid shorts about 9% a year in funding. Tonight you need $5,000." *(0:08)* "Pull margin and your liquidation price drops. Sell SOL and you're net short. Kamino's USDC pool is 93% lent out." *(0:14, ExitPlan loading both chains)* "ExitPlan is the pre-flight check: both chains, your rules, and the Solana transactions simulated before you sign." On-screen caption: "Hyperliquid and Kamino APIs, Oct 11."

**0:20 – 0:30 · Who**
"I'm Pluto. I contribute to Solana developer tooling, and I built this alone during the hackathon."

**0:25 – 0:55 · Problem and why now**
"Phantom put Hyperliquid perps inside a Solana wallet, so this position is now mainstream: SOL and USDC, often in Kamino, on Solana; a Hyperliquid short on the other side. The state lives in three apps, so people unwind by feel, in the wrong order. Hyperliquid's SOL perp carries about 5.7 million SOL of open interest, and Circle's CCTP now sends USDC from HyperCore straight to a Solana token account. The hedge went mainstream. The exit tooling didn't."

**0:55 – 1:10 · What it does**
"ExitPlan takes a cash goal and the rules you refuse to break: no new debt, keep net exposure, keep my SOL, keep a margin floor. It reads both chains by address, verifies the Hyperliquid account mode on HyperCore, evaluates dozens of routes, shows the ones that fit, explains the ones that don't, and simulates the Solana leg on-chain before you sign."

**1:10 – 2:00 · Demo clip** (from the demo video)
- Two addresses, or Phantom connect → the pre-flight readout: "account mode verified: standard", net exposure, wallet USDC, Kamino deposit and the pool's real liquidity, liquidation price.
- Keep-SOL with no debt: no route. "What would make it work" → trim both legs → a route appears, net exposure unchanged.
- One rejection reason read aloud.
- Rehearsal: "Simulate" on the Kamino step → "Not a mock. Kamino's SDK built the real withdrawal, Solana simulated it, and it would deliver exactly the planned USDC." Then the sell step: "Jupiter built the exact swap; it succeeds within a fraction of a percent of the plan. Nothing was signed or sent."
- Margin math: "On a live four-position account the model's withdrawable equals Hyperliquid's own number to the cent."
- AI prompt: ten seconds, confirmed before anything applies.

**2:00 – 2:25 · Market and business**
"Who: Phantom Perps and Hyperliquid traders holding SOL on Solana, and funding farmers running delta-neutral books. Free planner. Revenue from what comes after a plan: a Hyperliquid builder code on the short leg, a Jupiter integrator fee on the Solana leg, and a watch tier that alerts when a plan stops being feasible or liquidation gets close. Then automatic rebalancing of self-custodied delta-neutral positions, which is where the recurring volume is."

**2:25 – 2:45 · What is real, what is next**
"Read-only today, by design: real positions, a verified account mode, exchange-matching margin math, two real Solana simulations. Standard Hyperliquid accounts now, Unified next. Then one-click execution: Phantom signs the Solana leg, a Hyperliquid builder code routes the short, CCTP brings the USDC home. Everything is MIT, and the route engine is a pure module anyone can import."

**2:45 – 2:55 · Close**
"ExitPlan: the pre-flight check before you unwind. Link in the submission. Thanks."

Do not say "safe", "real-time" or "audited". Say "read at load time", "nothing is signed", and name the reviews that were done.
