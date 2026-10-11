import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.mjs';
import { interpretIntent } from '../server/intent.mjs';

const origin = 'https://exitplan.example';
const assets = { '/index.html': { body: '<!doctype html><title>ExitPlan</title>', type: 'text/html; charset=utf-8' }, '/app.mjs': { body: 'export const safe = true;', type: 'text/javascript; charset=utf-8' } };
const constraints = { target: 2000, maxNewDebt: 0, minHlBuffer: 1500, deadlineHours: 24, preserveHedge: true, preserveSolQuantity: false };
const intentBody = JSON.stringify({ text: '2000 USDC', currentConstraints: constraints });
const noopIntent = async () => ({ status: 200, body: { mode: 'ai', constraints, requiresConfirmation: true } });
function intentRequest({ headers = {}, body = intentBody, method = 'POST', ip = '203.0.113.7' } = {}) {
  const options = { method, headers: { origin, 'content-type': 'application/json', ...(ip === null ? {} : { 'x-forwarded-for': ip }), ...headers } };
  if (!['GET', 'HEAD'].includes(method)) { options.body = body; if (body instanceof ReadableStream) options.duplex = 'half'; }
  return new Request(`${origin}/api/intent`, options);
}

// All configured-AI and market tests use in-process mocks. No real API calls.
test('static assets and HEAD carry restrictive headers without exposing environment secrets', async () => {
  const app = createApp(assets);
  const response = await app.fetch(new Request(origin), { OPENAI_API_KEY: 'test-only-secret' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.match(response.headers.get('content-security-policy'), /connect-src 'self'/);
  assert.match(response.headers.get('content-security-policy'), /object-src 'none'/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(await response.text(), assets['/index.html'].body);
  const head = await app.fetch(new Request(`${origin}/app.mjs`, { method: 'HEAD' }));
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.match(head.headers.get('content-type'), /javascript/);
});

test('unknown, prototype-like, and inherited asset names are not served', async () => {
  const inherited = Object.create({ '/hidden': { body: 'private', type: 'text/plain' } });
  const app = createApp(inherited);
  for (const path of ['/missing', '/__proto__', '/toString', '/hidden', '/api/unknown']) {
    assert.equal((await app.fetch(new Request(origin + path))).status, 404);
  }
});

test('static paths reject writes', async () => {
  const response = await createApp(assets).fetch(new Request(origin, { method: 'POST' }));
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET, HEAD');
});

test('status exposes capabilities only, keeps execution disabled, and requires both AI settings', async () => {
  const app = createApp(assets);
  for (const env of [{}, { OPENAI_API_KEY: 'test-key' }, { OPENAI_MODEL: 'test-model' }]) {
    const response = await app.fetch(new Request(`${origin}/api/status`), env);
    assert.deepEqual(await response.json(), { aiConfigured: false, version: '0.1.0', portfolioEvidence: 'scenario', executionEnabled: false });
  }
  const response = await app.fetch(new Request(`${origin}/api/status`), { OPENAI_API_KEY: 'test-key', OPENAI_MODEL: 'test-model' });
  const data = await response.json();
  assert.equal(data.aiConfigured, true);
  assert.equal(data.executionEnabled, false);
  assert.doesNotMatch(JSON.stringify(data), /test-key|test-model/);
});

for (const [path, method] of [['/api/status', 'GET'], ['/api/market', 'GET'], ['/api/intent', 'POST']]) {
  test(`${path} rejects unsupported methods before invoking handlers`, async () => {
    const app = createApp(assets, { marketSnapshotImpl: () => assert.fail('must not fetch'), interpretIntentImpl: () => assert.fail('must not call AI') });
    const response = await app.fetch(new Request(origin + path, { method: 'DELETE' }));
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), method);
  });
}

test('market response remains explicitly read-only and unavailable errors do not leak upstream details', async () => {
  const snapshot = { evidence: 'live-market', solUsd: 150, executable: false, sourceTimestamp: null };
  const app = createApp(assets, { marketSnapshotImpl: async () => snapshot });
  assert.deepEqual(await (await app.fetch(new Request(`${origin}/api/market`))).json(), snapshot);
  const failed = createApp(assets, { marketSnapshotImpl: async () => { throw new Error('private diagnostic'); } });
  const response = await failed.fetch(new Request(`${origin}/api/market`));
  assert.equal(response.status, 502);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.text();
  assert.match(body, /unavailable/);
  assert.doesNotMatch(body, /private diagnostic/);
});

test('AI without configuration is honestly unavailable and never calls fetch', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => assert.fail('No outbound request may occur without configuration');
  try {
    const response = await createApp(assets).fetch(intentRequest());
    assert.equal(response.status, 503);
    assert.equal((await response.json()).mode, 'unavailable');
  } finally { globalThis.fetch = originalFetch; }
});

test('intent without a forwarded address shares one limiter bucket', async () => {
  let calls = 0;
  const app = createApp(assets, { interpretIntentImpl: async () => { calls++; return noopIntent(); } });
  for (let i = 0; i < 10; i++) assert.equal((await app.fetch(intentRequest({ ip: null }))).status, 200);
  assert.equal((await app.fetch(intentRequest({ ip: null }))).status, 429);
  assert.equal(calls, 10);
});

test('intent accepts an origin whose host matches x-forwarded-host on a proxied URL', async () => {
  const app = createApp(assets, { interpretIntentImpl: noopIntent });
  const request = new Request('http://127.0.0.1:3000/api/intent', { method: 'POST', body: intentBody, headers: { origin: 'https://exitplan.vercel.app', 'x-forwarded-host': 'exitplan.vercel.app', 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.2' } });
  assert.equal((await app.fetch(request)).status, 200);
});

for (const invalidOrigin of ['https://attacker.example', 'https://exitplan.example.attacker.example', 'null', '']) {
  test(`intent rejects origin ${JSON.stringify(invalidOrigin)}`, async () => {
    const app = createApp(assets, { interpretIntentImpl: () => assert.fail('must not run') });
    assert.equal((await app.fetch(intentRequest({ headers: { origin: invalidOrigin } }))).status, 403);
  });
}

test('intent rejects an explicit cross-site fetch even with a matching Origin header', async () => {
  const app = createApp(assets, { interpretIntentImpl: () => assert.fail('must not run') });
  assert.equal((await app.fetch(intentRequest({ headers: { 'sec-fetch-site': 'cross-site' } }))).status, 403);
});

for (const contentType of ['text/plain', 'application/jsonp', 'text/application/json']) {
  test(`intent rejects misleading content type ${contentType}`, async () => {
    const app = createApp(assets, { interpretIntentImpl: () => assert.fail('must not run') });
    assert.equal((await app.fetch(intentRequest({ headers: { 'content-type': contentType } }))).status, 415);
  });
}

test('intent accepts JSON with charset and passes only the parsed request to the interpreter', async () => {
  let received;
  const app = createApp(assets, { interpretIntentImpl: async (body, env) => { received = { body, env }; return noopIntent(); } });
  const response = await app.fetch(intentRequest({ headers: { 'content-type': 'Application/JSON; charset=utf-8' } }), { marker: 'test' });
  assert.equal(response.status, 200);
  assert.deepEqual(received, { body: JSON.parse(intentBody), env: { marker: 'test' } });
  assert.equal((await response.json()).requiresConfirmation, true);
});

test('oversized declared length is rejected before the body is consumed', async () => {
  const request = intentRequest({ headers: { 'content-length': '8001' } });
  const response = await createApp(assets, { interpretIntentImpl: () => assert.fail('must not run') }).fetch(request);
  assert.equal(response.status, 413);
  assert.equal(request.bodyUsed, false);
});

for (const length of ['-1', '8x', 'Infinity', '2.4']) {
  test(`invalid Content-Length ${length} is rejected before parsing`, async () => {
    const app = createApp(assets, { interpretIntentImpl: () => assert.fail('must not run') });
    assert.equal((await app.fetch(intentRequest({ headers: { 'content-length': length } }))).status, 400);
  });
}

test('byte cap applies to streamed multibyte bodies and cancels oversized input', async () => {
  let cancelled = false;
  const encoder = new TextEncoder();
  const body = new ReadableStream({ start(controller) { controller.enqueue(encoder.encode('"' + '€'.repeat(2000))); controller.enqueue(encoder.encode('€'.repeat(1000) + '"')); }, cancel() { cancelled = true; } });
  const app = createApp(assets, { interpretIntentImpl: () => assert.fail('must not run') });
  const response = await app.fetch(intentRequest({ body }));
  assert.equal(response.status, 413);
  assert.equal(cancelled, true);
});

test('a falsely small Content-Length cannot bypass the stream cap', async () => {
  const app = createApp(assets, { interpretIntentImpl: () => assert.fail('must not run') });
  const response = await app.fetch(intentRequest({ body: 'x'.repeat(8001), headers: { 'content-length': '1' } }));
  assert.equal(response.status, 413);
});

test('malformed JSON, invalid UTF-8, and failed streams become safe errors', async () => {
  for (const body of ['{bad', new Uint8Array([0xff]), new ReadableStream({ start(controller) { controller.error(new Error('private detail')); } })]) {
    const app = createApp(assets, { interpretIntentImpl: () => assert.fail('must not run') });
    const response = await app.fetch(intentRequest({ body }));
    assert.equal(response.status, 400);
    assert.doesNotMatch(await response.text(), /private detail/);
  }
});

test('per-user rate limit returns a retry time and resets at the window boundary', async () => {
  let clock = 1000;
  let calls = 0;
  const app = createApp(assets, { now: () => clock, interpretIntentImpl: async () => { calls++; return noopIntent(); } });
  for (let i = 0; i < 10; i++) assert.equal((await app.fetch(intentRequest())).status, 200);
  const blocked = await app.fetch(intentRequest());
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('retry-after'), '60');
  assert.equal(calls, 10);
  assert.equal((await app.fetch(intentRequest({ ip: '198.51.100.9' }))).status, 200);
  clock += 60_000;
  assert.equal((await app.fetch(intentRequest())).status, 200);
});

test('identity map is capped and expired entries free capacity', async () => {
  let clock = 0;
  const app = createApp(assets, { now: () => clock, interpretIntentImpl: noopIntent });
  for (let i = 0; i < 1000; i++) assert.equal((await app.fetch(intentRequest({ ip: `10.0.${Math.floor(i / 256)}.${i % 256}` }))).status, 200);
  assert.equal((await app.fetch(intentRequest({ ip: '192.0.2.1' }))).status, 429);
  assert.equal((await app.fetch(intentRequest({ ip: '10.0.0.0' }))).status, 200);
  clock = 60_000;
  assert.equal((await app.fetch(intentRequest({ ip: '192.0.2.1' }))).status, 200);
});

test('rate limit state is isolated per created app instance', async () => {
  const a = createApp(assets, { interpretIntentImpl: noopIntent });
  const b = createApp(assets, { interpretIntentImpl: noopIntent });
  for (let i = 0; i < 10; i++) await a.fetch(intentRequest());
  assert.equal((await a.fetch(intentRequest())).status, 429);
  assert.equal((await b.fetch(intentRequest())).status, 200);
});

test('unfinished request bodies are cancelled at the body-read deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  const app = createApp(assets, { interpretIntentImpl: () => assert.fail('must not run') });
  const pending = app.fetch(intentRequest({ body }));
  t.mock.timers.tick(10_000);
  const response = await pending;
  assert.equal(response.status, 408);
  assert.equal(cancelled, true);
  assert.match(await response.text(), /timed out/);
});


test('configured intent adapter is bounded, proposal-only, and sends no unrelated portfolio data', async () => {
  let request;
  const fakeFetch = async (url, init) => {
    request = { url, init, payload: JSON.parse(init.body) };
    return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ constraints, questions: [], explanation: 'Keep current conditions' }) }] }] });
  };
  const result = await interpretIntent({ text: '2000 USDC', currentConstraints: { ...constraints, recipient: 'do-not-send' }, portfolio: { secret: 'do-not-send' }, tools: ['execute'] }, { OPENAI_API_KEY: 'test-key', OPENAI_MODEL: 'test-model' }, fakeFetch);
  assert.equal(result.status, 200);
  assert.equal(result.body.requiresConfirmation, true);
  assert.equal(request.url, 'https://api.openai.com/v1/responses');
  assert.equal(request.init.redirect, 'error');
  assert.equal(request.init.credentials, 'omit');
  assert.equal(request.payload.store, false);
  assert.equal(request.payload.max_output_tokens, 1200);
  assert.equal(request.payload.tools, undefined);
  assert.equal(request.payload.text.format.strict, true);
  assert.deepEqual(JSON.parse(request.payload.input), { request: '2000 USDC', currentConstraints: constraints });
  assert.doesNotMatch(request.init.body, /test-key|do-not-send/);
  assert.doesNotMatch(JSON.stringify(result), /test-key/);
});

for (const output of [
  { status: 'incomplete', output: [] },
  { status: 'completed', output: [{ content: [{ type: 'output_text', text: '{bad' }] }] },
  { status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ constraints: { ...constraints, maxNewDebt: -1 }, questions: [], explanation: 'x' }) }] }] },
  { status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ constraints, questions: Array(9).fill('x'), explanation: 'x' }) }] }] },
  { status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ constraints, questions: [], explanation: 'x'.repeat(2001) }) }] }] },
]) {
  test('malformed or incomplete model output never becomes an applicable proposal: ' + JSON.stringify(output).slice(0, 100), async () => {
    const result = await interpretIntent({ text: '2000 USDC', currentConstraints: constraints }, { OPENAI_API_KEY: 'test-key', OPENAI_MODEL: 'test-model' }, async () => Response.json(output));
    assert.equal(result.status, 502);
    assert.equal(result.body.mode, 'unavailable');
    assert.equal(result.body.constraints, undefined);
  });
}

test('configured intent rejects invalid inputs without any API call', async () => {
  for (const body of [null, [], {}, { text: ' ' }, { text: 'x'.repeat(2001) }, { text: 'x', currentConstraints: { ...constraints, preserveHedge: 'yes' } }]) {
    const result = await interpretIntent(body, { OPENAI_API_KEY: 'test-key', OPENAI_MODEL: 'test-model' }, () => assert.fail('must not call API'));
    assert.equal(result.status, 400);
  }
});
