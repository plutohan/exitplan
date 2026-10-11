/** Read-only public market data and strictly offline account-import normalization. */
export const HYPERLIQUID_INFO_URL = 'https://api.hyperliquid.xyz/info';
const MAX_RESPONSE_BYTES = 1_048_576;
const DECIMAL = /^-?\d+(?:\.\d+)?$/;

export class HyperliquidDataError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'HyperliquidDataError';
    this.code = code;
    if (options.status !== undefined) this.status = options.status;
  }
}

function invalid(message, code = 'INVALID_DATA') {
  throw new HyperliquidDataError(code, message);
}

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid(`${label} must be an object`);
  }
  return value;
}

function decimal(value, label, { min = -Number.MAX_SAFE_INTEGER, positive = false } = {}) {
  if (typeof value !== 'number' && !(typeof value === 'string' && DECIMAL.test(value))) {
    invalid(`${label} must be a finite decimal number`);
  }
  const result = Number(value);
  if (!Number.isFinite(result) || Math.abs(result) > Number.MAX_SAFE_INTEGER || result < min || (positive && result <= 0)) {
    invalid(`${label} is outside the supported numeric range`);
  }
  return result;
}

function timestamp(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 8_640_000_000_000_000) {
    invalid(`${label} must be a valid epoch-millisecond timestamp`);
  }
  return new Date(value).toISOString();
}

function symbol(value, label) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 64 || /\s/.test(value)) {
    invalid(`${label} must be a nonempty asset identifier`);
  }
  return value;
}

/**
 * Fetch only public SOL reference-price data. Sends no address or account data.
 * observedAt is local receipt time; allMids has no exchange timestamp and can
 * fall back to the last trade. This is neither a spot quote nor a fill estimate.
 */
export async function getMarketSnapshot({ fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 5000 } = {}) {
  if (typeof fetchImpl !== 'function' || typeof now !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    invalid('A fetch function, clock function, and timeout of 1–60000 ms are required', 'INVALID_OPTIONS');
  }
  const requestedAt = timestamp(now(), 'Request time');
  const controller = new AbortController();
  let timer;
  let timedOut = false;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new HyperliquidDataError('TIMEOUT', 'Hyperliquid market data request timed out'));
    }, timeoutMs);
  });

  try {
    return await Promise.race([deadline, (async () => {
      const response = await fetchImpl(HYPERLIQUID_INFO_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ type: 'allMids' }),
        signal: controller.signal,
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
      });
      if (!response || typeof response.ok !== 'boolean' || typeof response.text !== 'function') {
        invalid('Hyperliquid returned an invalid HTTP response', 'INVALID_RESPONSE');
      }
      if (!response.ok) {
        throw new HyperliquidDataError('HTTP_ERROR', `Hyperliquid market data returned HTTP ${response.status}`, { status: response.status });
      }
      const contentType = response.headers?.get('content-type') ?? '';
      if (!/^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;|$)/i.test(contentType)) {
        invalid('Hyperliquid market data was not JSON', 'INVALID_RESPONSE');
      }
      const contentLength = Number(response.headers?.get('content-length'));
      if (contentLength > MAX_RESPONSE_BYTES) invalid('Hyperliquid market response is too large', 'INVALID_RESPONSE');
      const text = await response.text();
      if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) invalid('Hyperliquid market response is too large', 'INVALID_RESPONSE');
      let payload;
      try { payload = JSON.parse(text); }
      catch { invalid('Hyperliquid market data contained invalid JSON', 'INVALID_JSON'); }
      record(payload, 'allMids response');
      if (!Object.hasOwn(payload, 'SOL')) invalid('SOL reference price is missing', 'MISSING_PRICE');
      const solUsd = decimal(payload.SOL, 'SOL reference price', { positive: true });
      return {
        evidence: 'live-market',
        source: 'Hyperliquid public allMids',
        url: HYPERLIQUID_INFO_URL,
        requestedAt,
        observedAt: timestamp(now(), 'Receipt time'),
        sourceTimestamp: null,
        solUsd,
        solPriceRaw: String(payload.SOL),
        priceKind: 'perpetual-mid-or-last-trade',
        executable: false,
        caveats: [
          'SOL perpetual reference only; not a Solana spot execution quote.',
          'The upstream endpoint may use the last trade if the order book is empty.',
          'Receipt time does not establish the age of the upstream price.',
          'No wallet balances, positions, account ownership, or portfolio value have been verified.',
        ],
      };
    })()]);
  } catch (error) {
    if (timedOut) throw new HyperliquidDataError('TIMEOUT', 'Hyperliquid market data request timed out');
    if (error instanceof HyperliquidDataError) throw error;
    throw new HyperliquidDataError('NETWORK_ERROR', 'Hyperliquid market data could not be retrieved', { cause: error });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Offline only: no calls, address discovery, or persistence. A caller must supply
 * an explicitly standard, abstraction-disabled, native-DEX export. Imported
 * assertions cannot authenticate account mode, ownership, or current freshness.
 * Intentionally produces no combined spot/perp account or portfolio total.
 */
export function normalizeImportedAccount(payload, { now = Date.now } = {}) {
  record(payload, 'Account import');
  if (payload.accountMode !== 'standard' || payload.userAbstraction !== 'disabled') {
    invalid('Only explicitly standard, abstraction-disabled imports are supported; unified, portfolio-margin, default, DEX-abstraction, and unknown modes are rejected', 'UNSUPPORTED_ACCOUNT_MODE');
  }
  if (payload.dex !== '') invalid('Only an explicitly identified native perp DEX import is supported', 'UNSUPPORTED_DEX');
  if (typeof now !== 'function') invalid('A clock function is required', 'INVALID_OPTIONS');
  const importedAt = timestamp(now(), 'Import time');
  const state = record(payload.clearinghouseState, 'clearinghouseState');
  const summary = record(state.marginSummary, 'marginSummary');
  if (!Array.isArray(state.assetPositions) || state.assetPositions.length > 1000) invalid('assetPositions must be a bounded array');
  const sourceAsOf = timestamp(state.time, 'clearinghouseState.time');
  if (Date.parse(sourceAsOf) > Date.parse(importedAt) + 60_000) invalid('Imported account timestamp is in the future');
  const seenCoins = new Set();
  const positions = state.assetPositions.map((asset, index) => {
    record(asset, `assetPositions[${index}]`);
    if (asset.type !== 'oneWay') invalid('Only oneWay position imports are supported');
    const position = record(asset.position, `assetPositions[${index}].position`);
    const coin = symbol(position.coin, 'Position coin');
    if (coin.includes(':')) invalid('Builder DEX positions are not supported', 'UNSUPPORTED_DEX');
    if (seenCoins.has(coin)) invalid('Duplicate imported position');
    seenCoins.add(coin);
    const size = decimal(position.szi, `${coin} size`);
    const leverage = record(position.leverage, `${coin} leverage`);
    if (!['cross', 'isolated'].includes(leverage.type)) invalid('Unknown imported leverage type');
    return {
      coin,
      size,
      side: size > 0 ? 'long' : size < 0 ? 'short' : 'flat',
      entryPrice: position.entryPx === null && size === 0 ? null : decimal(position.entryPx, `${coin} entry price`, { positive: true }),
      notionalUsd: decimal(position.positionValue, `${coin} position value`, { min: 0 }),
      unrealizedPnlUsd: decimal(position.unrealizedPnl, `${coin} unrealized PnL`),
      marginUsedUsd: decimal(position.marginUsed, `${coin} margin used`, { min: 0 }),
      liquidationPrice: position.liquidationPx === null ? null : decimal(position.liquidationPx, `${coin} liquidation price`, { positive: true }),
      leverageType: leverage.type,
      leverage: decimal(leverage.value, `${coin} leverage`, { positive: true }),
    };
  });

  let spotBalances = null;
  if (payload.spotClearinghouseState !== undefined) {
    const spot = record(payload.spotClearinghouseState, 'spotClearinghouseState');
    if (!Array.isArray(spot.balances) || spot.balances.length > 10_000) invalid('Spot balances must be a bounded array');
    const seenTokens = new Set();
    spotBalances = spot.balances.map((balance) => {
      record(balance, 'Spot balance');
      if (!Number.isSafeInteger(balance.token) || balance.token < 0 || seenTokens.has(balance.token)) invalid('Invalid or duplicate spot token ID');
      seenTokens.add(balance.token);
      const total = decimal(balance.total, 'Spot total', { min: 0 });
      const hold = decimal(balance.hold, 'Spot hold', { min: 0 });
      if (hold > total) invalid('Spot hold exceeds total');
      return { token: balance.token, coin: symbol(balance.coin, 'Spot coin'), total, hold, unheld: total - hold, valueUsd: null };
    });
  }
  return {
    evidence: 'imported-account',
    source: 'User-supplied Hyperliquid export; unverified',
    accountMode: 'standard',
    dex: '',
    importedAt,
    sourceAsOf,
    perpsEquityUsd: decimal(summary.accountValue, 'Perps account value'),
    perpsMarginUsedUsd: decimal(summary.totalMarginUsed, 'Perps margin used', { min: 0 }),
    reportedWithdrawableUsd: decimal(state.withdrawable, 'Reported withdrawable', { min: 0 }),
    positions,
    spotBalances,
    combinedAccountValueUsd: null,
    limitations: [
      'Offline, unverified snapshot: not a live account connection or ownership check.',
      'Perps equity is taken once from marginSummary.accountValue; position notional, unrealized PnL, cross equity, and withdrawable are not added to it.',
      'Spot balances are not priced; unheld is not a withdrawal or transfer guarantee.',
      'No combined account or portfolio value is produced. Other DEXs, wallets, vaults, staking, subaccounts, and lending are excluded.',
      'Imported liquidation prices and withdrawable amounts are historical reports, not current risk or execution guarantees.',
    ],
  };
}
