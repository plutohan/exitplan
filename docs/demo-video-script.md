# Product demo script (≤ 3:00)

Screen recording of https://exitplan-rouge.vercel.app at 1440×900, dark theme. Re-check the demo addresses right before recording (`docs/demo-addresses.md`); positions change.

**0:00 – 0:20 · Scenario walk**
Open the site. Guide step 1: $2,000 target, keep the hedge → "Withdraw Solana deposit USDC" wins with $0.25 fees. Click *Next scenario*: $5,000 with keep-SOL → "No route satisfies the current conditions… up to $4,498.75". Click a rejected card → the reason. *Next scenario*: keep-SOL off → paired route appears; point at net SOL exposure 0 in the positions section.

**0:20 – 0:55 · Import real positions**
Portfolio source → *Import by address*. Paste the Solana wallet and the Hyperliquid address. *Load positions*. Status line: "Loaded · Solana 3.22 SOL · $9,607 deposited · HL short 700 SOL · hh:mm UTC". Plan cards now carry IMPORTED badges; the planning price is the Jupiter quote. Open *How it is calculated* → sources, addresses, the locked-margin assumption, other open positions listed.

**0:55 – 1:35 · Compare and reject**
Target $5,000, keep-SOL on → no route (deposits cover $9,607? then it is feasible: use target $12,000 instead to show the rejection). Open the rejected route, read "short of the target". Turn keep-SOL off: paired unwind sells SOL and reduces the short by the same amount; the hedge-ratio card stays balanced. Select it.

**1:35 – 2:20 · Rehearsal with a real simulation**
*Step-by-step rehearsal*. Step 1 "Sell SOL spot · 2.69 SOL": press *Simulate on Solana (read-only)*. Result: "Simulation succeeded · 91,571 CU · quoted $301.51 USDC · 48 log lines · nothing was sent". Next step "Reduce SOL short": "Not simulated: a Hyperliquid order needs a signed exchange request". Finish: "Rehearsal complete".

**2:20 – 2:50 · AI intent**
Type "I need $3,000 and no new debt, keep the hedge". The proposal lists each changed condition. Press *Confirm and apply* → routes recompute. Show *Cancel* on a second proposal to make the point: nothing applies without confirmation.

**2:50 – 3:00 · Close**
Footer: "Nothing is signed, sent or traded". Cut.
