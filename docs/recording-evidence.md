# Recording evidence (fill in right after the demo take)

Judges can re-run everything here. Fill every field from the actual take; do not estimate.

- Recorded: 2026-10-12 19:28–19:45 UTC (screen captures driven in headless Chrome against the production site; narration generated from the builder's cloned voice)
- Commit on `main` at recording time: `4517828` (code at `e56737d`) · `npm test`: 296 passed
- Solana wallet: `348T3x6WWGy2B4P2KFitiUPYrxHeLKXKV9odscSaCKF5` · Hyperliquid address: `0x30077e013CC7090Ba0b6f5bA5602659Ef0F3F03A` · account mode shown: Unified (verified on HyperCore)
- Deep link used: `https://exitplan-rouge.vercel.app/#sol=348T3x6WWGy2B4P2KFitiUPYrxHeLKXKV9odscSaCKF5&hl=0x30077e013CC7090Ba0b6f5bA5602659Ef0F3F03A&target=300&minHlBuffer=20&preserveSolQuantity=true`
- Position summary at load: SOL spot 2 · short 2 · net exposure 0 · HL withdrawable $117.64 (exchange) vs model buffer $117.64 · liquidation $198.02 (83% away) · Kamino $99.99 · wallet USDC $0.00__ · wallet USDC $__
- Pre-flight line: "5 ok · 0 warnings" (Account mode: verified on HyperCore, unified account)
- Route selected: `hybrid-paired-4-0` (Withdraw deposits + trim spot and short) — net $301 · fees $1.33 · carry given up $25.10/yr · steps: Withdraw deposited USDC $99.99 → Reduce SOL short 1.87 SOL → Sell SOL spot 1.87 SOL
- Hyperliquid preview: average $108.10 (0 bps above best ask) · −1.8 bps vs 10 bps allowance · taker fee $0.09 at 4.500 bps · book age 0 s · inner order: `{"a":5,"b":true,"p":"108.22","s":"1.87","r":true,"t":{"limit":{"tif":"Ioc"}}}`
- Kamino simulation: would deliver $99.99 (plan $99.99) · 113,382 CU · Explorer inspector: shown in the take (message bytes of the unsigned withdraw)
- Jupiter simulation: quoted $202.05 vs plan $201.03 (1.87 SOL) · 28,042 CU · Explorer inspector: opened on camera
- Report copied: no (not in the take) · CLI run: `node bin/exitplan.mjs --sol 348T3x6WWGy2B4P2KFitiUPYrxHeLKXKV9odscSaCKF5 --hl 0x30077e013CC7090Ba0b6f5bA5602659Ef0F3F03A --target 300 --min-buffer 20` → "# ExitPlan pre-flight report · 2026-10-12 19:11 UTC / Read-only. Nothing was signed or sent… / Solana: 2 SOL · Kamino deposit $99.99 · wallet USDC $0.00 · SOL quote $107.42"
