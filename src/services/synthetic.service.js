import { SIM_BASE_PRICE } from '../config/constants.js';

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function gauss(rng) {
  const u = Math.max(rng(), 1e-9);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const EPOCH_SEC = Math.floor(Date.UTC(2023, 0, 1) / 1000);

const VOL_BASE = {
  BTCUSDT: 0.0052, ETHUSDT: 0.0062, SOLUSDT: 0.0092, BNBUSDT: 0.0058,
};
const BAR_VOLUME = {
  BTCUSDT: 60, ETHUSDT: 490, SOLUSDT: 4100, BNBUSDT: 175,
};

const cache = new Map();

export function getSyntheticKlines(symbol, tf, count, endTimeSec = null) {
  const tfSeconds = { '5m': 300, '15m': 900, '1h': 3600, '4h': 14400 }[tf] || 3600;
  const end = endTimeSec ?? Math.floor(Date.now() / 1000);
  const lastTime = Math.floor(end / tfSeconds) * tfSeconds;
  const key = `${symbol}:${tfSeconds}`;

  const cached = cache.get(key);
  if (cached && cached.endTime === lastTime && cached.candles.length >= count) {
    return cached.candles.slice(-count);
  }

  const rng = mulberry32(hashSeed(`${symbol}:${tfSeconds}:v11`));
  const volBase = (VOL_BASE[symbol] ?? 0.006) * Math.sqrt(tfSeconds / 3600);
  const volBarBase = (BAR_VOLUME[symbol] ?? 100) * (tfSeconds / 3600);

  let price = (SIM_BASE_PRICE[symbol] ?? 100) * 0.62;
  let vol = volBase;
  let absRetEMA = volBase * 0.8;
  let regimeDrift = 0;
  let regimeLeft = 0;
  let shockLeft = 0;
  let shockVolMult = 1;

  const totalBars = Math.max(count, Math.floor((lastTime - EPOCH_SEC) / tfSeconds));
  const keep = Math.min(count + 4, totalBars);
  const candles = [];

  for (let i = 0; i < totalBars; i++) {
    if (regimeLeft <= 0) {
      const hoursEq = tfSeconds / 3600;
      regimeLeft = Math.floor((260 + rng() * 720) / hoursEq);
      const r = rng();
      if (r < 0.36) regimeDrift = (0.04 + rng() * 0.22) / 100;
      else if (r < 0.68) regimeDrift = -(0.04 + rng() * 0.2) / 100;
      else regimeDrift = (rng() - 0.5) * 0.0005;
    }
    regimeLeft--;

    if (shockLeft <= 0 && rng() < 0.0012 * (tfSeconds / 300)) {
      shockLeft = 8 + Math.floor(rng() * 26);
      shockVolMult = 2.8 + rng() * 2.4;
      regimeDrift += (rng() - 0.5) * 0.004;
    }
    if (shockLeft > 0) {
      shockLeft--;
      if (shockLeft === 0) shockVolMult = 1;
    }

    const z = gauss(rng);
    const ret = regimeDrift * (tfSeconds / 3600) + vol * shockVolMult * z;
    const open = price;
    const close = Math.max(open * (1 + ret), open * 0.05);
    const wickUp = Math.abs(gauss(rng)) * vol * shockVolMult * 0.55;
    const wickDn = Math.abs(gauss(rng)) * vol * shockVolMult * 0.55;
    const high = Math.max(open, close) * (1 + wickUp);
    const low = Math.max(Math.min(open, close) * (1 - wickDn), 0.0001);

    const volume =
      volBarBase *
      (0.55 + rng() * 0.9 + Math.min(Math.abs(ret) / volBase, 6) * 0.55) *
      shockVolMult;

    const idx = i - (totalBars - keep);
    if (idx >= 0) {
      candles.push({
        time: EPOCH_SEC + i * tfSeconds,
        open, high, low, close, volume,
      });
    }

    absRetEMA = absRetEMA * 0.94 + Math.abs(ret) * 0.06;
    vol = Math.min(Math.max(volBase * 0.45, absRetEMA * 1.05), volBase * 3.2);
    price = close;
  }

  cache.set(key, { endTime: lastTime, candles });
  return candles.slice(-count);
}

export function getModeledDerivatives(symbol, candles = null) {
  const cs = candles ?? getSyntheticKlines(symbol, '1h', 120);
  const last = cs[cs.length - 1];
  const prev = cs[cs.length - 25] ?? cs[0];
  const ret24 = (last.close - prev.close) / prev.close;

  let volumeSum = 0;
  for (const c of cs.slice(-24)) volumeSum += c.volume;

  const rng = mulberry32(hashSeed(`dv:${symbol}:${Math.floor(last.time / 3600)}`));
  const trendScore = Math.max(-1, Math.min(1, ret24 * 14));

  const baseOI = {
    BTCUSDT: 85600, ETHUSDT: 1240000,
    SOLUSDT: 9800000, BNBUSDT: 640000,
  };
  const oiBase = baseOI[symbol] ?? 100000;

  const funding = 0.0001 * Math.tanh(trendScore * 2.4) + (rng() - 0.5) * 0.00012;

  return {
    source: 'MODELED',
    fundingRate: funding,
    openInterest: oiBase * (1 + 0.28 * trendScore + (rng() - 0.5) * 0.12),
    openInterestChange: trendScore * 9 + (rng() - 0.5) * 6,
    longShortRatio: Math.max(0.55, Math.min(2.4, 1 + trendScore * 0.28 + (rng() - 0.5) * 0.22)),
    liquidationVolume: volumeSum * last.close * 0.04 * (0.5 + rng()),
    markPrice: last.close * (1 + 0.0002 * trendScore),
    basis: 0.02 * trendScore,
  };
}

export function getModeledOrderBook(symbol) {
  const cs = getSyntheticKlines(symbol, '5m', 60);
  const last = cs[cs.length - 1];
  const prev = cs[cs.length - 12] ?? cs[0];
  const mom = (last.close - prev.close) / prev.close;
  const rng = mulberry32(hashSeed(`ob:${symbol}:${last.time}`));
  const mid = last.close;
  const tick = mid * 0.00012;
  const tilt = Math.max(-0.6, Math.min(0.6, mom * 60));

  const bids = [];
  const asks = [];
  const base = 4 + rng() * 6;
  for (let i = 0; i < 20; i++) {
    const decay = Math.exp(-i / 7);
    bids.push({
      price: mid - tick * (i + 1),
      amount: base * decay * (1 + tilt) * (0.6 + rng() * 0.8),
    });
    asks.push({
      price: mid + tick * (i + 1),
      amount: base * decay * (1 - tilt) * (0.6 + rng() * 0.8),
    });
  }
  return finalizeOrderBook(bids, asks, 'MODELED');
}

export function finalizeOrderBook(bids, asks, source) {
  const bidVolume = bids.reduce((s, b) => s + b.amount, 0);
  const askVolume = asks.reduce((s, a) => s + a.amount, 0);
  const bestBid = bids[0]?.price ?? 0;
  const bestAsk = asks[0]?.price ?? 0;
  const mid = (bestBid + bestAsk) / 2;
  const avgBid = bidVolume / Math.max(bids.length, 1);
  const avgAsk = askVolume / Math.max(asks.length, 1);
  const wallBidIdx = bids.reduce((m, b, i) => (b.amount > bids[m].amount ? i : m), 0);
  const wallAskIdx = asks.reduce((m, a, i) => (a.amount > asks[m].amount ? i : m), 0);

  return {
    source,
    bids, asks,
    bidVolume, askVolume,
    imbalance: bidVolume / Math.max(bidVolume + askVolume, 1e-9),
    spreadPct: mid > 0 ? ((bestAsk - bestBid) / mid) * 100 : 0,
    buyWall:
      bids.length && bids[wallBidIdx].amount > avgBid * 3.5
        ? { price: bids[wallBidIdx].price, size: bids[wallBidIdx].amount }
        : null,
    sellWall:
      asks.length && asks[wallAskIdx].amount > avgAsk * 3.5
        ? { price: asks[wallAskIdx].price, size: asks[wallAskIdx].amount }
        : null,
  };
}

export function getSyntheticTickers(symbols) {
  const now = Math.floor(Date.now() / 1000);
  return symbols.map((symbol) => {
    const candles = getSyntheticKlines(symbol, '1h', 48, now);
    const last = candles[candles.length - 1];
    const dayAgo = candles[candles.length - 25] ?? candles[0];
    const window = candles.slice(-24);
    let vol = 0, high = 0, low = Infinity;
    for (const c of window) {
      vol += c.volume;
      high = Math.max(high, c.high);
      low = Math.min(low, c.low);
    }
    return {
      symbol,
      price: last.close,
      change24h: ((last.close - dayAgo.close) / dayAgo.close) * 100,
      high24h: high,
      low24h: low,
      volume24h: vol,
      quoteVolume24h: vol * last.close,
    };
  });
}