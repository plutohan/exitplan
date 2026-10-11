# Launch checklist (owner tasks before 2026-10-13 10:59 UTC+4)

Everything below needs the account owner; the code is complete and frozen unless a review finds a defect.

## 1. Optional, recommended: a real 1:1 hedge for the demo (about $400)

The public example accounts are strangers to each other, so the readout flags "net exposure not neutral" and the "keep SOL fails, trim both legs works" moment needs an odd target. A small hedge of your own makes the story real on screen:

1. Hold about **2 SOL** in your Solana wallet (`8mgVs81Psuz72TAPjjz1KAjLbefUPxh73Qo4JkfcVu4x` held 0.79 on 2026-10-11).
2. Deposit about **$120 USDC** to Hyperliquid (`0x3796bF467561B61a21e0B523894E44B8Ae5c6516`) and open a **2 SOL short**, cross margin, 2–3× leverage. In Hyperliquid's settings, set the account abstraction mode explicitly (Standard, or Unified) so `userAbstraction` stops returning `default`; the readout then says "verified" instead of warning.
3. Deposit about **$100 USDC** into Kamino's main market. Do not deposit SOL there (mixed collateral is rejected).
4. Keep wallet USDC under about $5.
5. Open `https://exitplan-rouge.vercel.app/#sol=8mgVs81Psuz72TAPjjz1KAjLbefUPxh73Qo4JkfcVu4x&hl=0x3796bF467561B61a21e0B523894E44B8Ae5c6516&target=300`. Expected: net exposure 0, keep-SOL fails at $300, the suggestion "Allow selling SOL (keep net exposure)" produces a paired route of roughly 0.9 SOL, and all three rehearsal legs produce artifacts.

If you skip this, record with the public example (deep links in `docs/demo-addresses.md`) and say on camera that the two accounts are unrelated.

## 2. Videos (both ≤ 3:00)

- Pitch: `docs/pitch-video-script.md`. Say numbers "as of October 12". Do not say "safe", "real-time", "audited" or "independent review".
- Demo: `docs/demo-video-script.md`. Reload positions right before each take (a snapshot older than five minutes blocks planning on purpose). Walk the readout, one rejection reason, the three-leg rehearsal (book preview with the unsigned order, Kamino simulation, Solana simulation with the Explorer link), the AI prompt with confirmation, "Copy pre-flight report" and the plan link.

## 3. Submission form

- Register the entry and submit `docs/submission-copy.md` field by field (one-liner, description under 1,500 characters, problem, why now, wedge, target user, business model, blockchains integrated, tools, team, disclosure, links).
- Select **both** Solana and Hyperliquid as integrated chains.
- Attach the two videos. Repository: https://github.com/plutohan/exitplan. Live: https://exitplan-rouge.vercel.app.

## 4. Operations

- OpenAI: keep a spend cap on the key used by `OPENAI_API_KEY` (the AI panel is public).
- Optional: set `SOLANA_RPC_URL` in Vercel to a keyed RPC if the public mainnet RPC rate-limits the Kamino simulation during judging.
- Before the deadline, run `npm test` and open the live site once more; `docs/verification.md` lists what was checked and when.
