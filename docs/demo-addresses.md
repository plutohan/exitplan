# Public demo addresses

These are public on-chain addresses found on 2026-10-11 through public APIs (Hyperliquid leaderboard file and Kamino's API). They are not ours. Positions change at any time; re-check right before recording. The app reads them read-only; nothing is signed or sent.

## Hyperliquid (cross-margin SOL short)

ExitPlan verifies the account mode with `userAbstraction`. Only standard accounts (`disabled` or `default`) import; the others are rejected with the reason, which is itself worth showing in a demo.

| Address | Mode on 2026-10-11 | SOL short | Leverage | Account value | Withdrawable | Other positions |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `0x4bdf1130109e9c1bc921d8979ea66284d9c92f37` | `disabled` (standard) — use this | 91.32 | 20x | ~$19k | ~$5.4k | HYPE, ZEC, MEGA |
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
