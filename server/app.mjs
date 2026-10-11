import { interpretIntent } from './intent.mjs';
import { getMarketSnapshot } from './hyperliquid.mjs';

const MAX_REQUEST_BYTES = 8000;
const MAX_RATE_LIMIT_USERS = 1000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_INTENTS_PER_WINDOW = 10;
const BODY_READ_TIMEOUT_MS = 10_000;
const ASSET_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'",
};

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers },
  });
}

// Bound bytes while reading, including requests with no (or a dishonest) length.
// The timeout also prevents an unfinished stream from holding this request open.
async function readIntentBody(request) {
  const length = request.headers.get('content-length');
  if (length !== null && !/^\d+$/.test(length)) return { error: json({ error: 'Invalid Content-Length' }, 400) };
  if (length !== null && Number(length) > MAX_REQUEST_BYTES) return { error: json({ error: 'Request too large' }, 413) };
  if (!request.body) return { text: '' };
  const reader = request.body.getReader();
  let timer;
  let timedOut = false;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new Error('Body read timed out'));
    }, BODY_READ_TIMEOUT_MS);
  });
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        void reader.cancel().catch(() => {});
        return { error: json({ error: 'Request too large' }, 413) };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    void reader.cancel().catch(() => {});
    return { error: json({ error: timedOut ? 'Request body timed out' : 'Invalid request body' }, timedOut ? 408 : 400) };
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}

export function createApp(assets, { interpretIntentImpl = interpretIntent, marketSnapshotImpl = getMarketSnapshot, now = Date.now } = {}) {
  // Best-effort, isolate-local protection only; production needs an edge-wide quota.
  const limits = new Map();
  return {
    async fetch(request, env = {}) {
      const url = new URL(request.url);
      if (url.pathname === '/api/status') {
        if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405, { allow: 'GET' });
        return json({ aiConfigured: !!(env.OPENAI_API_KEY && env.OPENAI_MODEL), version: '0.1.0', portfolioEvidence: 'scenario', executionEnabled: false });
      }
      if (url.pathname === '/api/market') {
        if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405, { allow: 'GET' });
        try { return json(await marketSnapshotImpl()); }
        catch { return json({ error: '공개 시장 가격을 가져오지 못했습니다', evidence: 'unavailable' }, 502); }
      }
      if (url.pathname === '/api/intent') {
        if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, { allow: 'POST' });
        // Sites must supply/overwrite this header at its authenticated edge.
        const user = request.headers.get('oai-authenticated-user-id');
        if (!user) return json({ error: '로그인이 필요합니다' }, 401);
        if (request.headers.get('origin') !== url.origin) return json({ error: 'Origin rejected' }, 403);
        if (request.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'Origin rejected' }, 403);
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) return json({ error: 'JSON required' }, 415);
        const currentTime = now();
        // Expire before checking capacity; never retain an unbounded identity map.
        for (const [key, value] of limits) if (value.until <= currentTime) limits.delete(key);
        const entry = limits.get(user);
        if ((!entry && limits.size >= MAX_RATE_LIMIT_USERS) || (entry && entry.count >= MAX_INTENTS_PER_WINDOW)) {
          return json({ error: '잠시 후 다시 시도해주세요' }, 429, { 'retry-after': String(Math.max(1, Math.ceil(((entry?.until ?? currentTime + RATE_LIMIT_WINDOW_MS) - currentTime) / 1000))) });
        }
        limits.set(user, entry ? { ...entry, count: entry.count + 1 } : { until: currentTime + RATE_LIMIT_WINDOW_MS, count: 1 });
        const input = await readIntentBody(request);
        if (input.error) return input.error;
        let body;
        try { body = JSON.parse(input.text); }
        catch { return json({ error: 'Invalid JSON' }, 400); }
        const result = await interpretIntentImpl(body, env);
        return json(result.body, result.status);
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'Method not allowed' }, 405, { allow: 'GET, HEAD' });
      const path = url.pathname === '/' ? '/index.html' : url.pathname;
      const asset = Object.hasOwn(assets, path) ? assets[path] : undefined;
      if (!asset) return new Response('Not found', { status: 404, headers: ASSET_HEADERS });
      return new Response(request.method === 'HEAD' ? null : asset.body, { headers: { ...ASSET_HEADERS, 'content-type': asset.type } });
    },
  };
}
