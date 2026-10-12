# Technical demo video script (2:30–3:00)

Colosseum's guidance: the pitch video explains the **why**, the technical demo explains the **how**. Judges want the core features you built, the stack, the reasoning behind what you prioritised, and exactly how Solana (and here, Hyperliquid) is used. Direct and implementation-specific; not a second pitch.

**Data:** your own 1:1 hedge (see `docs/launch-checklist.md`, section 1). Fall back to the public pair only if the hedge is not importing cleanly 10 hours before the deadline, and then say "two unrelated public accounts" on camera.

**Recording rules:** 1440×900; record in segments, each within 3 minutes of pressing *Load positions* (a snapshot older than 5 minutes blocks planning on purpose); retake any segment that shows a fallback warning (Jupiter 503) or a stale book; 125–135 words per minute; burn in captions; keep the cursor visible; no jump cuts inside the proof take. Record the proof take first and reuse it in the pitch video.

**0:00–0:10 · Title.** "ExitPlan: a read-only pre-flight check for unwinding a SOL hedge split across Solana and Hyperliquid. Here is how it works."

**0:10–1:20 · One uninterrupted proof take.**
- Open the deep link to your own accounts. Point at: net exposure **0 SOL**; HL withdrawable next to the model buffer, "same figure, to the cent"; "Account mode: Standard, verified on HyperCore".
- Keep-SOL on, target $300: "no route". Read the rejection sentence on the sell-only card.
- Click "Allow selling SOL (keep net exposure)": the paired route appears. Point at net exposure still 0, the liquidation price before and after, "carry given up".
- Rehearsal: Hyperliquid step → *Preview fill on the Hyperliquid book*: average price, your taker fee, cost against the plan, book age, then the inner unsigned reduce-only IOC order. Say "built, never sent." Kamino step → "would deliver $X, plan $X". Solana step → simulation passes; **click the Explorer inspector link** and show the decoded unsigned transaction.

**1:20–2:20 · How it is built** (architecture diagram from the README on screen).
- "Everything runs in the browser against public endpoints: Solana RPC, the Kamino API, Jupiter, the Hyperliquid info API. No keys, no custody. Two small Vercel functions: one builds the Kamino withdrawal with Kamino's SDK and simulates it; one turns plain English into a constraint proposal."
- Solana: "The sell leg is the real Jupiter swap, built for your wallet and run through `simulateTransaction` with signature verification off. The Kamino leg is the real withdraw instruction set, simulated the same way, and we read the USDC token account out of the simulation to report what would arrive."
- Hyperliquid: "We confirm the account mode with `userAbstraction`, reserve margin with the exchange's transfer rule, max of initial margin and 10% of notional per position, and check it against the exchange's own withdrawable. Reductions are sized in the 0.01 SOL lot from `meta`, priced at your `userFees` taker rate, checked against the $10 minimum, and the rehearsal walks `l2Book` to build the inner order in the exchange's wire shape."
- Decisions: "Read-only by design: the first version must be right before it is allowed to act. Integer-cent arithmetic and fail-closed validation: a bad or stale input stops planning instead of guessing. Every claim carries its evidence label, scenario or imported."

**2:20–2:45 · Proof of engineering.** Terminal: `npm test` → 262 passing. Then `node bin/exitplan.mjs --sol … --hl … --target 300` prints the same report as the site: "the engine and the report are modules; the CLI is the composability story."

**2:45–3:00 · Next and close.** "Next is execution behind the same check: Phantom signs the Solana legs, a Hyperliquid builder code routes the short, CCTP brings the USDC home. Today nothing is signed or sent."

**Cut:** the AI panel (pitch only), the plan-link round trip, the evidence dialog, target fiddling, the synthetic scenario.
