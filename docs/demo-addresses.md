# Public demo addresses

These are public on-chain addresses found on 2026-10-11 through public APIs (Hyperliquid leaderboard file and Kamino's API). They are not ours. Positions change at any time; re-check right before recording. The app reads them read-only; nothing is signed or sent.

## Hyperliquid (cross-margin SOL short)

ExitPlan verifies the account mode with `userAbstraction`. Standard (`disabled` or `default`) and unified accounts import; portfolio margin and vaults are rejected with the reason, which is itself worth showing in a demo.

| Address | Mode on 2026-10-11 | SOL short | Leverage | Account value | Withdrawable | Other positions |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `0x7b7f72a28fe109fa703eeed7984f2a8a68fedee2` | `disabled` (standard) — use this | ~368 | 10x | ~$2.2M | ~$1.0M (exchange) | BTC, ETH, XRP, HYPE; a market maker with ~1,400 resting orders, so the exchange's withdrawable sits below the model buffer and the readout says so. Replaced `0x4bdf…2f37` on 2026-10-12 after that account closed its SOL short. |
| `0x3de9a354243a94e10060a198c7179b8e5393b9a1` | `portfolioMargin` — rejected | 700 | 5x | ~$47k | $0 | ETH, ENA, HYPE, ZEC |
| `0xfa1413451bc8dd3484787eb3c3156a7e28c4aade` | `portfolioMargin` — rejected | 3,170 | 20x | ~$91k | $0 | HYPE |

Check: `curl -s -X POST https://api.hyperliquid.xyz/info -H 'Content-Type: application/json' -d '{"type":"clearinghouseState","user":"<address>"}'` and mode: `-d '{"type":"userAbstraction","user":"<address>"}'`

The best demo is your own small 1:1 hedge (SOL in Phantom, an equal SOL short in Phantom Perps, some USDC in Kamino): the numbers reproduce and the "keep SOL fails, trim both legs works" moment appears at ordinary targets. With the public standard account above the two addresses are strangers to each other (3.2 SOL spot vs 91 SOL short), so pick the target live with the app before recording.

## Solana (Kamino main market, USDC supplied, no borrows)

| Wallet | USDC supplied | SOL balance |
| --- | ---: | ---: |
| `DrEDgXWTBfZbbVNT2ZdvxA5DUZx8CLTteGnsSJaXtZsK` | ~$9.6k | 3.22 |
| `2g2xzcMiTGysNZzv9zZcDqx7MtdRxWG1VHMVPDw3qdW9` | ~$26.6k | 0.50 |
| `GpSfiLicGjMHt7bsjn4qszXm37taAbUjxHfvd7wUpJim` | ~$7.0k | 0.18 |

Check: `curl -s "https://api.kamino.finance/kamino-market/7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF/users/<wallet>/obligations"`

Reserve addresses in the main market: USDC `D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59`, SOL `d4A2prbA2whesmvHaL88BH6Ewn5N4bTSU2Ze8P6Bc4Q`.

## Test matrix (public wallets, checked live on 2026-10-12 00:55 UTC+4)

Paste any of these, or open the deep links on the live site. None of them is ours; positions change.

| Solana wallet | Hyperliquid address | What the app shows | Deep link |
| --- | --- | --- | --- |
| `DrEDgXWTBfZbbVNT2ZdvxA5DUZx8CLTteGnsSJaXtZsK` | `0x7b7f72a28fe109fa703eeed7984f2a8a68fedee2` | Imports: 3.22 SOL, $336 wallet USDC, $9.6k Kamino, ~368 SOL short (standard, verified), liquidation card, routes incl. wallet-USDC-first and paired trim; both Solana simulations work | [open](https://exitplan-rouge.vercel.app/#sol=DrEDgXWTBfZbbVNT2ZdvxA5DUZx8CLTteGnsSJaXtZsK&hl=0x7b7f72a28fe109fa703eeed7984f2a8a68fedee2&target=500) |
| `2g2xzcMiTGysNZzv9zZcDqx7MtdRxWG1VHMVPDw3qdW9` | `0x7b7f72a28fe109fa703eeed7984f2a8a68fedee2` | Imports: 0.5 SOL, no wallet USDC, $26.6k Kamino; Kamino withdrawal is the best route | [open](https://exitplan-rouge.vercel.app/#sol=2g2xzcMiTGysNZzv9zZcDqx7MtdRxWG1VHMVPDw3qdW9&hl=0x7b7f72a28fe109fa703eeed7984f2a8a68fedee2&target=2000) |
| `GpSfiLicGjMHt7bsjn4qszXm37taAbUjxHfvd7wUpJim` | `0x7b7f72a28fe109fa703eeed7984f2a8a68fedee2` | Imports: 0.18 SOL, $7.0k Kamino | [open](https://exitplan-rouge.vercel.app/#sol=GpSfiLicGjMHt7bsjn4qszXm37taAbUjxHfvd7wUpJim&hl=0x7b7f72a28fe109fa703eeed7984f2a8a68fedee2&target=1000) |
| `73vjancZxVR6QNWujzJCUzjeHZJSCBgvZe6CpMUWZALD` | `0x7b7f72a28fe109fa703eeed7984f2a8a68fedee2` | Imports: $583k Kamino USDC; large targets show the Kamino liquidity cap in the evidence dialog | [open](https://exitplan-rouge.vercel.app/#sol=73vjancZxVR6QNWujzJCUzjeHZJSCBgvZe6CpMUWZALD&hl=0x7b7f72a28fe109fa703eeed7984f2a8a68fedee2&target=10000) |
| `DrEDgXWTBfZbbVNT2ZdvxA5DUZx8CLTteGnsSJaXtZsK` | `0x3de9a354243a94e10060a198c7179b8e5393b9a1` | Rejected: portfolio-margin account ("keeps USDC in the spot balance … Standard accounts today"); scenario stays | [open](https://exitplan-rouge.vercel.app/#sol=DrEDgXWTBfZbbVNT2ZdvxA5DUZx8CLTteGnsSJaXtZsK&hl=0x3de9a354243a94e10060a198c7179b8e5393b9a1&target=500) |
| `DrEDgXWTBfZbbVNT2ZdvxA5DUZx8CLTteGnsSJaXtZsK` | `0x3dd462347e7b42b5a3ea15132b677a4978af7a81` | Imports as a unified account: spot USDC backs the perps; 2,334 SOL short among BTC/ETH/GOAT/WLFI positions | [open](https://exitplan-rouge.vercel.app/#sol=DrEDgXWTBfZbbVNT2ZdvxA5DUZx8CLTteGnsSJaXtZsK&hl=0x3dd462347e7b42b5a3ea15132b677a4978af7a81&target=500) |
| `DrEDgXWTBfZbbVNT2ZdvxA5DUZx8CLTteGnsSJaXtZsK` | `0xdfc24b077bc1425ad1dea75bcb6f8158e10df303` | Rejected: this is the HLP vault, not a user account | [open](https://exitplan-rouge.vercel.app/#sol=DrEDgXWTBfZbbVNT2ZdvxA5DUZx8CLTteGnsSJaXtZsK&hl=0xdfc24b077bc1425ad1dea75bcb6f8158e10df303&target=500) |
| `5x2mUw5U9tKGaeJK1t5wjxhBPSXEmDTKZ2DGs3o27is3` | `0x7b7f72a28fe109fa703eeed7984f2a8a68fedee2` | Rejected: Kamino obligation holds SOL as well as USDC (mixed collateral is not modelled) | [open](https://exitplan-rouge.vercel.app/#sol=5x2mUw5U9tKGaeJK1t5wjxhBPSXEmDTKZ2DGs3o27is3&hl=0x7b7f72a28fe109fa703eeed7984f2a8a68fedee2&target=500) |
| `Vote111111111111111111111111111111111111111` | `0x0000000000000000000000000000000000000000` | Imports with 0 SOL, no Kamino deposit and no short; the burn address holds idle Hyperliquid equity, so its `default` mode cannot be established and the readout flags it; no feasible route at the default target | [open](https://exitplan-rouge.vercel.app/#sol=Vote111111111111111111111111111111111111111&hl=0x0000000000000000000000000000000000000000&target=500) |

Malformed input (wrong length, a Solana address in the Hyperliquid field, or vice versa) is rejected before any network call.
