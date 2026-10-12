import test from 'node:test';
import assert from 'node:assert/strict';
import { PUBLIC_EXAMPLES, pickPublicExample } from '../web/examples.mjs';

test('the public example lists carry valid, distinct addresses with at least two candidates per chain', () => {
  assert.ok(PUBLIC_EXAMPLES.solana.length >= 2 && PUBLIC_EXAMPLES.hyperliquid.length >= 2);
  for (const a of PUBLIC_EXAMPLES.hyperliquid) assert.match(a, /^0x[0-9a-f]{40}$/);
  for (const a of PUBLIC_EXAMPLES.solana) assert.match(a, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  assert.equal(new Set(PUBLIC_EXAMPLES.hyperliquid).size, PUBLIC_EXAMPLES.hyperliquid.length);
  assert.equal(new Set(PUBLIC_EXAMPLES.solana).size, PUBLIC_EXAMPLES.solana.length);
});

test('picks, per chain, the first candidate whose probe passes and stops probing there', async () => {
  const probed = { solana: [], hyperliquid: [] };
  const pick = await pickPublicExample({
    probeSolana: async a => { probed.solana.push(a); return a === PUBLIC_EXAMPLES.solana[0]; },
    probeHyperliquid: async a => { probed.hyperliquid.push(a); return a === PUBLIC_EXAMPLES.hyperliquid[1]; },
  });
  assert.deepEqual(pick, { solana: PUBLIC_EXAMPLES.solana[0], hyperliquid: PUBLIC_EXAMPLES.hyperliquid[1] });
  assert.deepEqual(probed.solana, PUBLIC_EXAMPLES.solana.slice(0, 1));
  assert.deepEqual(probed.hyperliquid, PUBLIC_EXAMPLES.hyperliquid.slice(0, 2));
});

test('a probe that throws skips that candidate instead of failing the pick', async () => {
  const pick = await pickPublicExample({
    probeSolana: async a => { if (a === PUBLIC_EXAMPLES.solana[0]) throw new Error('network'); return true; },
    probeHyperliquid: async () => true,
  });
  assert.equal(pick.solana, PUBLIC_EXAMPLES.solana[1]);
  assert.equal(pick.hyperliquid, PUBLIC_EXAMPLES.hyperliquid[0]);
});

test('returns null for a chain when no candidate passes, so the app can say that no public example fits instead of importing a stranger', async () => {
  const pick = await pickPublicExample({ probeSolana: async () => false, probeHyperliquid: async a => a === PUBLIC_EXAMPLES.hyperliquid[0] });
  assert.deepEqual(pick, { solana: null, hyperliquid: PUBLIC_EXAMPLES.hyperliquid[0] });
});
