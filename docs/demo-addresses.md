# Public demo addresses

These are public on-chain addresses found on 2026-10-11 through public APIs (Hyperliquid leaderboard file and Kamino's API). They are not ours. Positions change at any time; re-check right before recording. The app reads them read-only; nothing is signed or sent.

## Hyperliquid (cross-margin SOL short, standard accounts)

| Address | SOL short | Leverage | Account value | Withdrawable | Other positions |
| --- | ---: | ---: | ---: | ---: | --- |
| `0x3de9a354243a94e10060a198c7179b8e5393b9a1` | 700 | 5x | ~$50k | $0 | ETH, ENA, HYPE, ZEC |
| `0x4bdf1130109e9c1bc921d8979ea66284d9c92f37` | 91.32 | 20x | ~$18k | ~$4.6k | HYPE, ZEC, MEGA |
| `0xfa1413451bc8dd3484787eb3c3156a7e28c4aade` | 3,170 | 20x | ~$91k | $0 | HYPE |

Check: `curl -s -X POST https://api.hyperliquid.xyz/info -H 'Content-Type: application/json' -d '{"type":"clearinghouseState","user":"<address>"}'`

## Solana (Kamino main market, USDC supplied, no borrows)

| Wallet | USDC supplied | SOL balance |
| --- | ---: | ---: |
| `DrEDgXWTBfZbbVNT2ZdvxA5DUZx8CLTteGnsSJaXtZsK` | ~$9.6k | 3.22 |
| `2g2xzcMiTGysNZzv9zZcDqx7MtdRxWG1VHMVPDw3qdW9` | ~$26.6k | 0.50 |
| `GpSfiLicGjMHt7bsjn4qszXm37taAbUjxHfvd7wUpJim` | ~$7.0k | 0.18 |

Check: `curl -s "https://api.kamino.finance/kamino-market/7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF/users/<wallet>/obligations"`

Reserve addresses in the main market: USDC `D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59`, SOL `d4A2prbA2whesmvHaL88BH6Ewn5N4bTSU2Ze8P6Bc4Q`.
