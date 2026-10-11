import test from 'node:test';
import assert from 'node:assert/strict';
import { requestJson, AdapterError } from '../web/adapters/http.mjs';

const responder = (...responses) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetchImpl, calls };
};

test('a single transient failure (429, 5xx or a network error) is retried once after a short pause; the retry is identical', async () => {
  for (const first of [new Response('slow down', { status: 429 }), new Response('bad gateway', { status: 502 }), new TypeError('socket hang up')]) {
    const { fetchImpl, calls } = responder(first, Response.json({ ok: 1 }));
    const result = await requestJson('https://api.hyperliquid.xyz/info', { method: 'POST', body: { type: 'meta' }, fetchImpl, retryDelayMs: 5 });
    assert.deepEqual(result, { ok: 1 });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].body, calls[1].body);
    assert.equal(calls[1].method, 'POST');
  }
});

test('a second failure surfaces as the error it was, and non-transient statuses are not retried at all', async () => {
  const twice = responder(new Response('x', { status: 429 }), new Response('x', { status: 429 }));
  await assert.rejects(requestJson('https://api.hyperliquid.xyz/info', { fetchImpl: twice.fetchImpl, retryDelayMs: 5 }), e => e instanceof AdapterError && e.code === 'HTTP_ERROR' && /429/.test(e.message));
  assert.equal(twice.calls.length, 2);
  for (const status of [400, 403, 404, 422]) {
    const once = responder(new Response('no', { status }), Response.json({ never: true }));
    await assert.rejects(requestJson('https://api.kamino.finance/x', { fetchImpl: once.fetchImpl, retryDelayMs: 5 }), e => e.code === 'HTTP_ERROR');
    assert.equal(once.calls.length, 1, `status ${status} must not be retried`);
  }
});

test('the overall timeout still bounds both attempts', async () => {
  const slow = async () => new Promise(resolve => setTimeout(() => resolve(new Response('x', { status: 503 })), 30));
  await assert.rejects(requestJson('https://api.hyperliquid.xyz/info', { fetchImpl: slow, timeoutMs: 40, retryDelayMs: 5 }), e => e.code === 'TIMEOUT' || e.code === 'HTTP_ERROR');
});
