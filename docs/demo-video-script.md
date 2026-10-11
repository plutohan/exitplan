# Product demo script (≤ 3:00)

Screen recording of https://exitplan-rouge.vercel.app at 1440×900. **Reload positions right before each take**: an imported snapshot older than five minutes blocks planning on purpose.

**Preferred data: your own small 1:1 hedge** (SOL in Phantom, an equal SOL short in Phantom Perps, some USDC in Kamino). Confirm beforehand with `curl` that `userAbstraction` returns `disabled` or `default` for your 0x address. Round numbers reproduce and the "keep SOL fails, trim both legs works" moment appears at ordinary targets.

**Fallback data:** the public standard account and wallet in `docs/demo-addresses.md`. They are strangers to each other (3.2 SOL spot vs 91 SOL short), so pick the target with the app live before recording and avoid odd amounts.

**0:00 – 0:10 · Problem on screen**
Caption over Phantom: "Long SOL · short SOL on Hyperliquid · need $X tonight."

**0:10 – 0:35 · Load real positions**
Portfolio source → *Import by address* (or the deep link `#sol=…&hl=…&target=…`). Load. Point at the status line: SOL, Kamino deposit, wallet USDC, HL short, net exposure, time. Open *How it is calculated*: "Account mode verified on HyperCore: standard", sources, the locked-margin assumption. Say: "No API keys, no custody. Both venues are public state."

**0:35 – 1:10 · Compare, reject, relax**
Set the target with keep-SOL on → no route. Click a rejected route and read one reason aloud. Click the suggestion under the banner ("Allow selling SOL, keep net exposure") → a paired route appears: sell N SOL, reduce the short by N, net exposure unchanged, margin buffer shown before and after.

**1:10 – 1:55 · Rehearsal with a real simulation**
*Step-by-step rehearsal*. On the sell step press *Simulate on Solana (read-only)*. Read the result: "Simulation succeeded · 9x,xxx CU · quoted $… USDC · nothing was sent". Next step: "Not simulated: a Hyperliquid order needs a signed exchange request". Finish.

**1:55 – 2:30 · AI intent**
Type "I need $2,000 by tomorrow, no new debt, keep my SOL". Show the proposal, press *Confirm and apply*. Type "as much as possible" and show the clarifying questions instead of a guess.

**2:30 – 2:50 · Share**
Press *Copy plan link*; paste it in a new tab; the same positions and target load.

**2:50 – 3:00 · Close**
Footer: "Nothing is signed, sent or traded". Cut.

Avoid: strangers' accounts if you have your own, odd targets, the evidence wall, waiting on AI latency, and the word "safe".
