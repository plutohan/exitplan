/** Shared read-only HTTP helper for browser adapters. No credentials, no redirects, bounded time and size. */
export class AdapterError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'AdapterError';
    this.code = code;
  }
}

const MAX_BYTES = 2_000_000;

export const round2 = value => Math.round(value * 100) / 100;
export const round6 = value => Math.round(value * 1_000_000) / 1_000_000;

export function decimal(value, name) {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isFinite(number)) throw new AdapterError('INVALID_RESPONSE', `${name} is not a finite number`);
  return number;
}

export function record(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AdapterError('INVALID_RESPONSE', `${name} is missing`);
  return value;
}

export async function requestJson(url, { method = 'GET', body, fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  const host = new URL(url).host;
  const controller = new AbortController();
  let timer;
  let timedOut = false;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new AdapterError('TIMEOUT', `${host} did not answer within ${timeoutMs} ms`));
    }, timeoutMs);
  });
  const work = (async () => {
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers: body === undefined ? { Accept: 'application/json' } : { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
      });
    } catch (error) {
      throw new AdapterError('NETWORK_ERROR', `${host} could not be reached`, { cause: error });
    }
    if (!response || typeof response.ok !== 'boolean' || typeof response.text !== 'function') throw new AdapterError('INVALID_RESPONSE', `${host} returned an invalid HTTP response`);
    if (!response.ok) throw new AdapterError('HTTP_ERROR', `${host} returned HTTP ${response.status}`);
    const text = await response.text();
    if (text.length > MAX_BYTES) throw new AdapterError('INVALID_RESPONSE', `${host} response is too large`);
    try { return JSON.parse(text); } catch { throw new AdapterError('INVALID_RESPONSE', `${host} returned invalid JSON`); }
  })();
  work.catch(() => {}); // the race may settle first; never leave an unhandled rejection behind
  try {
    return await Promise.race([deadline, work]);
  } catch (error) {
    if (timedOut) throw new AdapterError('TIMEOUT', `${host} did not answer within ${timeoutMs} ms`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
