// Public example accounts (strangers to each other, read-only). Positions change daily: the former example flipped to a SOL long on
// 2026-10-12 and broke the hero button, so the app now probes this list in order and uses the first account that still holds a SOL short.
const WALLET = 'DrEDgXWTBfZbbVNT2ZdvxA5DUZx8CLTteGnsSJaXtZsK'; // Kamino main-market USDC supplier with a few SOL

export const PUBLIC_EXAMPLES = [
  { solana: WALLET, hyperliquid: '0x31dea2516beee92135b96f464eeec3cf292a13f2', note: 'standard account, SOL short among 9 positions' },
  { solana: WALLET, hyperliquid: '0xfc667adba8d4837586078f4fdcdc29804337ca06', note: 'standard account, SOL short among 8 positions' },
  { solana: WALLET, hyperliquid: '0x6ba889db7f923622d3548f621ecc2054b80c1817', note: 'standard account, SOL short among many positions' },
  { solana: WALLET, hyperliquid: '0x7b7f72a28fe109fa703eeed7984f2a8a68fedee2', note: 'former example; held a SOL long on 2026-10-12' },
];

/** Returns the first candidate whose probe reports a SOL short; a probe that fails is skipped; with no hit the first candidate is returned so the import can show the real reason. */
export async function pickPublicExample({ probe, candidates = PUBLIC_EXAMPLES } = {}) {
  for (const candidate of candidates) {
    try {
      if (await probe(candidate.hyperliquid)) return candidate;
    } catch {
      // unreachable or malformed: try the next candidate
    }
  }
  return candidates[0];
}
