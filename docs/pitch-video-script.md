# Pitch video script (2:50 target, 3:00 hard limit)

Evidence from 20 Colosseum winner videos and 337 winners: winners use nearly the full three minutes (median 175 s), speak at about 165 words per minute, say their name within the first 10 seconds (9 of 13), state a fee or business model by about 0:55 (11 of 13), and close on what is real and deployed, not on a slogan (8 of 13). Solo winners are common (82 of 337). Record with Loom or screen + webcam; narrative matters more than editing. About 155–165 words per minute, at most 440 spoken words. Say every number as "as of today".

**0:00 – 0:20 · Opening** *(your own Phantom showing the SOL balance, then the Hyperliquid position)*
"I'm long SOL in my Solana wallet and short SOL on Hyperliquid. Tonight I need three hundred dollars out. Pull margin and my short moves toward liquidation; sell SOL and I'm net short. I'm Pluto, I build Solana developer tooling, and I built ExitPlan alone: the pre-flight check before you unwind." (53 words)

**0:20 – 0:40 · Problem and why now**
"Phantom put Hyperliquid perps one tap from Solana spot. As of today about $__M of SOL is shorted on Hyperliquid, earning shorts about 9% a year, and most of it sits opposite SOL held on Solana. Opening the hedge is one tap. Unwinding it is three apps and a guess: sell SOL and you're net short, pull margin and your liquidation price drops, and Kamino's USDC pool is 93% lent out."
Re-pull the open-interest number on the day you record (Hyperliquid `metaAndAssetCtxs`, SOL `openInterest` × mark; it was about $668M on 2026-10-12).

**0:40 – 1:00 · Business and validation** (winners say the fee by about 0:55)
"The planner is free. The watch tier is ten dollars a month: a standing pre-flight that alerts when the plan breaks, funding flips or liquidation gets close. When execution ships, a few basis points of Hyperliquid builder fee on the short leg plus a Jupiter platform fee; ten thousand dollars at five basis points is five dollars, so that is a floor, not the plan."
Then one validation fact, said as fact: the Vercel run count ("N people ran it on their own accounts in the first day") or one feedback screenshot. With zero runs, say "I run this hedge myself" and claim nothing else.

**1:00 – 1:05 · What it does** (one sentence; the footage shows the rest)
"You give it a cash goal and the rules you refuse to break; it shows every route that keeps them, explains every route that doesn't, and rehearses the legs on both chains before you sign."

**1:05 – 1:55 · Product clip** (the proof take from the technical demo, cut to 50 s)
- Readout on your own hedge: net exposure 0, account mode verified, HL withdrawable next to the model buffer.
- Keep-SOL on: "no route"; read one rejection sentence. Allow selling SOL: the paired route appears, net exposure still 0, liquidation before and after, "carry given up".
- Rehearsal: Hyperliquid book walk and the unsigned reduce-only order ("built, never sent"); Kamino "would deliver $X, plan $X"; Jupiter simulation passes, Explorer inspector opens.

**1:55 – 2:15 · Why me** (Colosseum asks solo founders to say this)
"I'm a Solana tooling contributor and I hold this hedge myself. I built ExitPlan solo with AI coding agents: my part was the spec, checking the margin math against the live exchange, and the 262 tests. The hard part was not the UI; it was making the margin model match the exchange on real accounts."

**2:15 – 2:35 · What is next**
"Next is execution behind the same check: Phantom signs the Solana legs, a Hyperliquid builder code routes the short, CCTP brings the USDC home. Everything is MIT, and the route engine is a module anyone can import."

**2:35 – 2:55 · Close on what is real** (winners close on status, not a slogan)
"What's real today: my own hedge, read live from both chains; margin math that matched Hyperliquid's own withdrawable; a Kamino withdrawal and a Jupiter swap simulated on Solana; the Hyperliquid order built on the live book. Nothing signed, nothing sent. ExitPlan: try it read-only on your own accounts."
Say "to the cent" only if the take shows it. Never say the Hyperliquid withdrawal was simulated.

Do not say "safe", "real-time", "audited", "every leg simulated" or "independent review" (say AI-assisted: Claude, Codex and Claude Opus). Keep the camera off the result banner text and off the public example's liquidation figure; your own hedge avoids both.
