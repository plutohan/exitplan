// Public example accounts (strangers to each other, read-only). Positions change daily: the former Hyperliquid example flipped to a
// SOL long on 2026-10-12 and broke the hero button, so the app probes each list in order and uses the first address that still fits.
export const PUBLIC_EXAMPLES = {
  // Kamino main-market USDC suppliers holding some SOL (docs/demo-addresses.md)
  solana: ['DrEDgXWTBfZbbVNT2ZdvxA5DUZx8CLTteGnsSJaXtZsK', '2g2xzcMiTGysNZzv9zZcDqx7MtdRxWG1VHMVPDw3qdW9', 'GpSfiLicGjMHt7bsjn4qszXm37taAbUjxHfvd7wUpJim'],
  // standard-mode accounts with a cross-margin SOL short, fewest other positions first; the last one is the former example
  hyperliquid: ['0x31dea2516beee92135b96f464eeec3cf292a13f2', '0xfc667adba8d4837586078f4fdcdc29804337ca06', '0x6ba889db7f923622d3548f621ecc2054b80c1817', '0x7b7f72a28fe109fa703eeed7984f2a8a68fedee2'],
};

async function firstPassing(candidates, probe) {
  for (const candidate of candidates) {
    try {
      if (await probe(candidate)) return candidate;
    } catch {
      // unreachable or malformed: try the next candidate
    }
  }
  return candidates[0]; // no hit: the import then shows the real reason instead of a silent blank
}

/** Probes both lists in parallel and returns the first Solana wallet and the first Hyperliquid account that still fit the demo. */
export async function pickPublicExample({ probeSolana, probeHyperliquid, candidates = PUBLIC_EXAMPLES } = {}) {
  const [solana, hyperliquid] = await Promise.all([firstPassing(candidates.solana, probeSolana), firstPassing(candidates.hyperliquid, probeHyperliquid)]);
  return { solana, hyperliquid };
}
