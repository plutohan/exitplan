# Product demo script (≤ 3:00)

Screen recording of https://exitplan-rouge.vercel.app at 1440×900. **Reload positions right before each take**: an imported snapshot older than five minutes blocks planning on purpose.

**Preferred data: your own small 1:1 hedge** (SOL in Phantom, an equal SOL short on Hyperliquid, some USDC in Kamino). Standard and Unified accounts both import; confirm beforehand with the app (the readout's first item says which). Round numbers reproduce and the "keep SOL fails, trim both legs works" moment appears at ordinary targets.

**Fallback data:** the public standard account and wallet in `docs/demo-addresses.md` (deep links included). They are strangers to each other (3.2 SOL spot vs 91 SOL short), so pick the target with the app live before recording and avoid odd amounts. The unified example (0x3dd4…) shows the spot-USDC-backed readout.

**0:00 – 0:10 · Problem on screen**
Caption over Phantom: "Long SOL · short SOL on Hyperliquid · need $X tonight."

**0:10 – 0:40 · Load real positions**
Portfolio source → *Import by address* (or the deep link `#sol=…&hl=…&target=…`, or *Connect wallet (read-only)*). Load. Walk the pre-flight readout top to bottom: account mode verified, net exposure, liquidation distance, margin buffer against your floor with the exchange's own withdrawable beside it, Kamino pool cash, wallet USDC, carry (funding the short earns, yield the deposit earns), what is not simulated. Open *How it is calculated*: your taker rate, the 0.01 SOL lot, sources. Say: "No API keys, no custody. Both venues are public state."

**0:40 – 1:10 · Compare, reject, relax**
Set the target with keep-SOL on → no route. Click a rejected route and read one reason aloud. Click the suggestion under the banner ("Allow selling SOL, keep net exposure") → a paired route appears: sell N SOL, reduce the short by N (a 0.01 multiple), net exposure unchanged, margin buffer before and after, "carry given up" on the card.

**1:10 – 2:05 · Rehearsal, three legs**
*Step-by-step rehearsal*. Hyperliquid step: press *Preview fill on the Hyperliquid book (read-only)*: average buy-back price, slippage, your taker fee, cost against the plan, book age, and the unsigned reduce-only IOC order you would sign. Say: "Built, never sent." Kamino step: *Simulate Kamino withdrawal (read-only)*: "Simulation succeeded · would deliver $X (plan $X)". Sell step: *Simulate on Solana (read-only)*: "Simulation succeeded · quoted $… vs plan estimate $…". Finish.

**2:05 – 2:20 · AI intent (10 seconds)**
Type "I need $2,000 by tomorrow, no new debt, keep my SOL". Show the proposal, press *Confirm and apply*. Skip the second prompt unless time allows.

**2:20 – 2:45 · Share**
Press *Copy pre-flight report*: the checks, every route with fees and carry, the rejections and the plan link, as plain text. Press *Copy plan link*; paste it in a new tab; the same positions and target load.

**2:45 – 3:00 · Close**
Footer: "Nothing is signed, sent or traded". Cut.

Avoid: strangers' accounts if you have your own, odd targets, the evidence wall, waiting on AI latency, and the word "safe".
