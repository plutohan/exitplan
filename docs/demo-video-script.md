# Technical demo video script (2:50 target, 3:00 limit)

Colosseum's guidance: the pitch video explains the **why**, the technical demo explains the **how**: the core features you built, the stack, the reasoning behind what you prioritised, and exactly how Solana (and here, Hyperliquid) is used. Direct and implementation-specific; not a second pitch.

Evidence from 7 winning technical demos: median 178 s at about 155 words per minute; five of seven say name and role in one line and are inside the product within 8 seconds; narration is first person, as actions ("I'll approve the transaction"), with decisions framed as challenge → solution; the stack comes near the end; none narrates a test run, and terminals appear only when the terminal is the product.

**Data:** your own 1:1 hedge (`docs/launch-checklist.md`, section 1). Fall back to the public pair only if the hedge is not importing cleanly 10 hours before the deadline, and then say "two unrelated public accounts" on camera.

**Recording rules:** 1440×900; record in segments, each within 3 minutes of pressing *Load positions* (a snapshot older than 5 minutes blocks planning on purpose); retake any segment that shows a fallback warning (Jupiter 503) or a stale book; 145–155 words per minute; keep the cursor visible; no jump cuts inside the proof take; captions optional. Record the proof take first and reuse it in the pitch video. Fill `docs/recording-evidence.md` right after.

**0:00 – 0:15 · Start inside the product, already loaded** (no title card)
"I'm Pluto; I built ExitPlan alone. This is my own hedge: two SOL in my wallet, two SOL short on Hyperliquid, a hundred dollars in Kamino. I need three hundred dollars out without breaking it. Here's what ExitPlan checks." (amounts must match the hedge you actually opened)

**0:15 – 1:20 · One uninterrupted proof take**
- Point at: net exposure **0 SOL**; HL withdrawable next to the model buffer, "same figure, to the cent"; "Account mode: Standard, verified on HyperCore". Say once: "public APIs, no keys, no custody."
- Keep-SOL on, target $300: "no route". Read the rejection sentence on the sell-only card.
- Click "Allow selling SOL (keep net exposure)": the paired route appears. Point at net exposure still 0, the liquidation price before and after, "carry given up".
- Rehearsal, Hyperliquid step → *Preview fill on the Hyperliquid book*: average price, your taker fee, cost against the plan, book age, then the inner unsigned reduce-only IOC order. Say "built, never sent."
- Kamino step → "would deliver $X, plan $X". Solana step → simulation passes; **click the Explorer inspector link** and show the decoded unsigned transaction.

**1:20 – 2:20 · How it is built** (architecture diagram from the README on screen; narrate as challenge → solution, first person)
- "Everything runs in the browser against public endpoints: Solana RPC, the Kamino API, Jupiter, the Hyperliquid info API. No keys, no custody. Two small Vercel functions: one builds the Kamino withdrawal with Kamino's SDK and simulates it; one turns plain English into a constraint proposal."
- Challenge 1, margin: "Hyperliquid's withdrawable is not equity minus maintenance margin. I reserve margin with the exchange's transfer rule, the larger of initial margin and 10% of notional per position, and check it against the exchange's own withdrawable. Unified accounts keep the equity in the spot USDC balance, so I read that too."
- Challenge 2, placeable routes: "A route the exchange would reject is worthless. Reductions are sized in the 0.01 SOL lot from `meta`, priced at your `userFees` taker rate, checked against the $10 minimum, and the rehearsal walks `l2Book` to build the inner order in the exchange's wire shape."
- Challenge 3, Solana legs that are real: "The sell leg is the real Jupiter swap, built for your wallet and run through `simulateTransaction` with signature verification off. The Kamino leg is the real withdraw instruction set, simulated the same way, and I read the USDC token account out of the simulation to report what would arrive."
- Decisions: "Read-only by design: the first version must be right before it is allowed to act. Integer-cent arithmetic and fail-closed validation: a bad or stale input stops planning instead of guessing. Every number carries its evidence label, scenario or imported."

**2:20 – 2:40 · The same engine from the terminal**
`node bin/exitplan.mjs --sol … --hl … --target 300` prints the same report as the site: "the engine and the report are modules; a bot or a CI job can run the pre-flight." Flash "262 tests" on screen for two seconds; do not narrate a test run.

**2:40 – 2:55 · Next and close on status**
"Next is execution behind the same check: Phantom signs the Solana legs, a Hyperliquid builder code routes the short, CCTP brings the USDC home. Today nothing is signed or sent."

**Cut:** the AI panel (pitch only, and only if it answers within five seconds), the plan-link round trip, the evidence dialog, target fiddling, the synthetic scenario, any title card.
