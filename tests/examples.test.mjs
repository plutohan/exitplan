import test from 'node:test';
import assert from 'node:assert/strict';
import { PUBLIC_EXAMPLES, pickPublicExample } from '../web/examples.mjs';

test('the public example list carries valid addresses and at least two Hyperliquid candidates in order', () => {
  assert.ok(PUBLIC_EXAMPLES.length >= 2);
  for (const c of PUBLIC_EXAMPLES) {
    assert.match(c.hyperliquid, /^0x[0-9a-f]{40}$/);
    assert.match(c.solana, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  }
  assert.equal(new Set(PUBLIC_EXAMPLES.map(c => c.hyperliquid)).size, PUBLIC_EXAMPLES.length);
});

test('picks the first candidate whose probe reports a SOL short and stops probing there', async () => {
  const probed = [];
  const probe = async hl => { probed.push(hl); return hl === PUBLIC_EXAMPLES[1].hyperliquid; };
  const pick = await pickPublicExample({ probe });
  assert.equal(pick.hyperliquid, PUBLIC_EXAMPLES[1].hyperliquid);
  assert.deepEqual(probed, PUBLIC_EXAMPLES.slice(0, 2).map(c => c.hyperliquid));
});

test('a probe that throws skips that candidate instead of failing the pick', async () => {
  const probe = async hl => { if (hl === PUBLIC_EXAMPLES[0].hyperliquid) throw new Error('network'); return true; };
  assert.equal((await pickPublicExample({ probe })).hyperliquid, PUBLIC_EXAMPLES[1].hyperliquid);
});

test('falls back to the first candidate when no probe succeeds, so the import shows the real reason', async () => {
  assert.equal((await pickPublicExample({ probe: async () => false })).hyperliquid, PUBLIC_EXAMPLES[0].hyperliquid);
});
