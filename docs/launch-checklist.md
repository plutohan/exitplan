# Launch checklist (owner tasks before 2026-10-13 10:59 UTC+4)

Everything below needs the account owner; the code is complete and frozen unless a review finds a defect.

## 1. Decided: a real 1:1 hedge for the demo (about $400 of mostly recoverable capital)

Both outside reviews (Claude Opus, Codex) reached the same conclusion: the public example is a market maker whose figures move by the hour, whose resting orders leave a seven-figure gap between the model buffer and the exchange's withdrawable, and whose short is not hedged against the example wallet. Your own hedge makes net exposure read 0, the withdrawable match to the cent and the liquidation distance look sane. The cost is fees and funding, not the capital. **Deadline for the fallback decision: 2026-10-13 01:00 UTC+4** (10 hours before the cutoff). If the hedge is not importing cleanly by then, record with the public pair and say "two unrelated public accounts" on camera.

The public example accounts are strangers to each other, so the readout flags "net exposure not neutral" and the "keep SOL fails, trim both legs works" moment needs an odd target. A small hedge of your own makes the story real on screen:

1. Hold about **2 SOL** in your Solana wallet (`348T3x6WWGy2B4P2KFitiUPYrxHeLKXKV9odscSaCKF5` held 0.79 on 2026-10-11).
2. Deposit about **$120 USDC** to Hyperliquid (`0x30077e013CC7090Ba0b6f5bA5602659Ef0F3F03A`) and open a **2 SOL short**, cross margin, 2–3× leverage. Opened 2026-10-12 20:45 UTC+4 through Phantom's EVM address on app.hyperliquid.xyz (Phantom Perps itself only offers isolated margin, which the importer rejects): unified account, cross 3x, 2.00 SOL short, $188.70 spot USDC equity; `userAbstraction` returns `unifiedAccount`, so the readout says verified.
3. Deposit about **$100 USDC** into Kamino's main market. Do not deposit SOL there (mixed collateral is rejected).
4. Keep wallet USDC under about $5.
5. Open `https://exitplan-rouge.vercel.app/#sol=348T3x6WWGy2B4P2KFitiUPYrxHeLKXKV9odscSaCKF5&hl=0x30077e013CC7090Ba0b6f5bA5602659Ef0F3F03A&target=300`. Add `&minHlBuffer=20&preserveSolQuantity=true` for the recording. Expected: net exposure 0 once the wallet holds exactly 2.000000 SOL, model buffer $116.27 vs exchange withdrawable $116.29, liquidation $198 (82% above), keep-SOL fails at $300, "Allow selling SOL (keep net exposure)" produces the paired route, and all three rehearsal legs produce artifacts.

If you skip this, record with the public example (deep links in `docs/demo-addresses.md`) and say on camera that the two accounts are unrelated.

## 2. Videos (both ≤ 3:00)

Colosseum's guidance: the pitch video explains the **why**; the technical demo explains the **how** (features, stack, why you prioritised what you did, how Solana is used). Record the 60–90 s proof take first and reuse it in both. Rules (from 20 winner videos): use nearly the full three minutes, 150–165 words per minute in the pitch and 145–155 in the demo, name in the first 10 seconds, fee or business model by 0:55, close on what is real; segments within 3 minutes of a reload; retake anything with a fallback warning or a stale book; no AI prompt and no plan-link round trip in the demo; never say "safe", "real-time", "audited" or "every leg simulated". After the take, fill `docs/recording-evidence.md`.

- Pitch: `docs/pitch-video-script.md`. Lead with the open-interest number re-pulled on the day; business model with prices; solo/AI framing once.
- Technical demo: `docs/demo-video-script.md`. Start inside the loaded product; one rejection reason; the three-leg rehearsal (book preview with the unsigned order, Kamino simulation, Solana simulation with the Explorer link); the architecture as challenge → solution; the CLI run. No AI prompt, no plan-link round trip.

## 2b. Early validation (an hour, worth doing before the form)

Post the deep link to your own hedge in two or three places where SOL hedgers are (a Phantom Perps or Hyperliquid community channel, your own X account) with one sentence: "read-only, no keys, tell me what it got wrong". Count real runs from Vercel analytics, not memory, and quote the number in the form and the pitch ("N people ran it on their own accounts in the first day"). Even two screenshots of feedback count as the "user feedback" judges ask for.

## 3. Submission form

- Register the entry and submit `docs/submission-copy.md` field by field (one-liner, description under 1,500 characters, problem, why now, wedge, target user, business model, blockchains integrated, tools, team, disclosure, links). Fill every optional field. Lead with the Hyperliquid track in the one-liner's first clause (the account-mode check, transfer-rule margin, lot and fee sizing, and the live-book order are the unusual work); tick both tracks.
- Access: the repo is public; upload the videos as unlisted links that open without login and test them in a private window.
- Select **both** Solana and Hyperliquid as integrated chains.
- Attach the two videos. Repository: https://github.com/plutohan/exitplan. Live: https://exitplan-rouge.vercel.app.

## 4. Operations

- OpenAI: keep a spend cap on the key used by `OPENAI_API_KEY` (the AI panel is public).
- Vercel dashboard → project `exitplan` → **Analytics** → Enable (one click; free tier). The page already loads `/_vercel/insights/script.js` and sends three anonymous events (`try-live`, `live-import`, `rehearsal-complete`); until it is enabled the script 404s harmlessly. Read the `live-import` count on submission day and paste it into the form's "Users so far" line and the pitch's 0:55 validation sentence.
- Done 2026-10-12: `SOLANA_RPC_URL` in Vercel points at a keyed Helius mainnet endpoint (server functions only; the browser keeps using publicnode). The Kamino simulation reports `rpc: mainnet.helius-rpc.com`.
- Before the deadline, run `npm test` and open the live site once more; `docs/verification.md` lists what was checked and when.
