// backend/src/services/binance.service.js
import logger from '../config/logger.js';

const SPOT = process.env.BINANCE_SPOT_BASE || 'https://data-api.binance.vision';
const FUT = process.env.BINANCE_FUTURES_BASE || 'https://fapi.binance.com';

/* ------------------------------ TTL cache ------------------------------ */

const cache = new Map();

function cached(key, ttl, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttl) return Promise.resolve(hit.data);
  return fn().then((data) => {
    cache.set(key, { t: Date.now(), data });
    return data;
  });
}

/** Return stale cached data regardless of age (for fallback). */
function stale(key) {
  const hit = cache.get(key);
  return hit ? hit.data : null;
}

/* ---------------------------- circuit breaker -------------------------- */
/*
 * Binance's public mirrors impose rate limits per IP. When the client
 * bursts requests (frontend polling + scheduler scan), the endpoint may
 * start timing out. To avoid worsening the situation with retries, we
 * open a circuit after N consecutive failures and stop calling Binance
 * for COOLDOWN_MS. During the open circuit, cached (possibly stale)
 * data is served — or a hard error is thrown so callers fall back to
 * synthetic data.
 */

const CB_FAIL_THRESHOLD = 3;
const CB_COOLDOWN_MS = 60_000;
const CB_RESET_AFTER_MS = 5 * 60_000;

const circuit = {
  failCount: 0,
  openedAt: 0,
  lastFailureAt: 0,
  lastSuccessAt: 0,
};

function circuitOpen() {
  if (circuit.openedAt === 0) return false;
  if (Date.now() - circuit.openedAt >= CB_COOLDOWN_MS) {
    // cooldown expired — allow a trial request (half-open)
    return false;
  }
  return true;
}

function recordSuccess() {
  circuit.failCount = 0;
  circuit.openedAt = 0;
  circuit.lastSuccessAt = Date.now();
}

function recordFailure() {
  circuit.lastFailureAt = Date.now();
  circuit.failCount++;

  // Reset the sliding counter if failures have spread over > 5 min
  if (circuit.lastFailureAt - circuit.lastSuccessAt > CB_RESET_AFTER_MS) {
    circuit.failCount = 1;
  }

  if (circuit.failCount >= CB_FAIL_THRESHOLD && circuit.openedAt === 0) {
    circuit.openedAt = Date.now();
    logger.warn(
      `Binance circuit OPEN for ${CB_COOLDOWN_MS / 1000}s after ${circuit.failCount} failures`
    );
  }
}

/* ---------------------------- fetch + timeout -------------------------- */

async function fetchJson(url, timeoutMs = 10_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'user-agent': 'apex-ai/1.0' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/* --------------------------------- klines ------------------------------ */

export async function getKlines(symbol, tf, limit = 500) {
  const key = `kl:${symbol}:${tf}:${limit}`;
  // faster refresh for low timeframes, slower for high ones
  const ttl = tf === '5m' ? 30_000 : tf === '15m' ? 60_000 : 120_000;

  // Circuit open → serve stale cache if available, otherwise error out.
  if (circuitOpen()) {
    const s = stale(key);
    if (s) return { ...s, source: 'BINANCE', _fromCache: true };
    throw new Error('Binance circuit open (no cached data)');
  }

  return cached(key, ttl, async () => {
    try {
      const raw = await fetchJson(
        `${SPOT}/api/v3/klines?symbol=${symbol}&interval=${tf}&limit=${limit}`
      );
      if (!Array.isArray(raw) || raw.length < 50) throw new Error('bad klines');
      recordSuccess();
      return {
        source: 'BINANCE',
        candles: raw.map((k) => ({
          time: Math.floor(Number(k[0]) / 1000),
          open: Number(k[1]),
          high: Number(k[2]),
          low: Number(k[3]),
          close: Number(k[4]),
          volume: Number(k[5]),
        })),
      };
    } catch (err) {
      recordFailure();
      logger.warn(`Binance klines failed [${symbol} ${tf}]: ${err.message}`);
      // Prefer stale cache over nothing
      const s = stale(key);
      if (s) return { ...s, _fromCache: true };
      throw err;
    }
  });
}

/* --------------------------------- tickers ----------------------------- */

export async function getTickers(symbols) {
  const key = `tk:${symbols.join(',')}`;
  const ttl = 20_000;

  if (circuitOpen()) {
    const s = stale(key);
    if (s) return { ...s, _fromCache: true };
    throw new Error('Binance circuit open (no cached data)');
  }

  return cached(key, ttl, async () => {
    try {
      const encoded = encodeURIComponent(JSON.stringify(symbols));
      const raw = await fetchJson(
        `${SPOT}/api/v3/ticker/24hr?symbols=${encoded}`
      );
      if (!Array.isArray(raw)) throw new Error('bad tickers');
      recordSuccess();

      const tickers = raw.map((t) => ({
        symbol: t.symbol,
        price: Number(t.lastPrice),
        change24h: Number(t.priceChangePercent),
        high24h: Number(t.highPrice),
        low24h: Number(t.lowPrice),
        volume24h: Number(t.volume),
        quoteVolume24h: Number(t.quoteVolume),
      }));
      tickers.sort((a, b) => symbols.indexOf(a.symbol) - symbols.indexOf(b.symbol));
      return { source: 'BINANCE', tickers };
    } catch (err) {
      recordFailure();
      logger.warn(`Binance tickers failed: ${err.message}`);
      const s = stale(key);
      if (s) return { ...s, _fromCache: true };
      throw err;
    }
  });
}

/* --------------------------------- order book -------------------------- */

export async function getOrderBook(symbol, limit = 100) {
  const key = `ob:${symbol}:${limit}`;
  const ttl = 20_000;

  if (circuitOpen()) {
    const s = stale(key);
    if (s) return { ...s, _fromCache: true };
    throw new Error('Binance circuit open (no cached data)');
  }

  return cached(key, ttl, async () => {
    try {
      const raw = await fetchJson(
        `${SPOT}/api/v3/depth?symbol=${symbol}&limit=${limit}`
      );
      const bids = raw.bids
        .map(([p, a]) => ({ price: Number(p), amount: Number(a) }))
        .filter((l) => l.amount > 0);
      const asks = raw.asks
        .map(([p, a]) => ({ price: Number(p), amount: Number(a) }))
        .filter((l) => l.amount > 0);
      recordSuccess();
      return { source: 'LIVE', bids, asks };
    } catch (err) {
      recordFailure();
      logger.warn(`Binance order book failed [${symbol}]: ${err.message}`);
      const s = stale(key);
      if (s) return { ...s, _fromCache: true };
      throw err;
    }
  });
}

/* -------------------------------- derivatives -------------------------- */

export async function getDerivatives(symbol) {
  const key = `dv:${symbol}`;
  const ttl = 90_000;

  if (circuitOpen()) {
    const s = stale(key);
    if (s) return { ...s, _fromCache: true };
    throw new Error('Binance circuit open (no cached data)');
  }

  return cached(key, ttl, async () => {
    try {
      const [premium, oiHist, lsr] = await Promise.all([
        fetchJson(`${FUT}/fapi/v1/premiumIndex?symbol=${symbol}`),
        fetchJson(
          `${FUT}/futures/data/openInterestHist?symbol=${symbol}&period=1h&limit=24`
        ),
        fetchJson(
          `${FUT}/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=1h&limit=24`
        ),
      ]);
      const oiNow = Number(oiHist[oiHist.length - 1].sumOpenInterest);
      const oiPrev = Number(oiHist[0].sumOpenInterest);
      const avgLsr =
        lsr.reduce((s, x) => s + Number(x.longShortRatio), 0) / lsr.length;
      recordSuccess();
      return {
        source: 'LIVE',
        fundingRate: Number(premium.lastFundingRate),
        openInterest: oiNow,
        openInterestChange: ((oiNow - oiPrev) / oiPrev) * 100,
        longShortRatio: avgLsr,
        liquidationVolume: 0,
        markPrice: Number(premium.markPrice),
        basis: 0,
      };
    } catch (err) {
      recordFailure();
      logger.warn(`Derivatives failed [${symbol}]: ${err.message}`);
      const s = stale(key);
      if (s) return { ...s, _fromCache: true };
      throw err;
    }
  });
}

/* --------------------------------- utilities --------------------------- */

export function clearCache() {
  cache.clear();
}

export function getCircuitState() {
  return {
    open: circuitOpen(),
    failCount: circuit.failCount,
    openedAt: circuit.openedAt,
    cooldownRemainingMs: circuit.openedAt
      ? Math.max(0, CB_COOLDOWN_MS - (Date.now() - circuit.openedAt))
      : 0,
  };
}