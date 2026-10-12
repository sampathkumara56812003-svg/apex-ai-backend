import { query } from '../config/database.js';
import { Signal } from '../models/signal.model.js';
import { composeSignal } from './engine.service.js';
import { snapshot, trendScore, resample } from './indicator.service.js';
import * as binance from './binance.service.js';
import * as synthetic from './synthetic.service.js';
import { SYMBOLS, SIGNAL_POLICY, MODEL_VERSION } from '../config/constants.js';
import { broadcast } from '../websocket/wsServer.js';
import logger from '../config/logger.js';

/* ------------------------- helpers with fallback ------------------------- */

async function safeKlines(symbol, tf, limit = 500) {
  try {
    return await binance.getKlines(symbol, tf, limit);
  } catch {
    return { source: 'SIMULATION', candles: synthetic.getSyntheticKlines(symbol, tf, limit) };
  }
}

async function safeDerivatives(symbol, candles) {
  try {
    return await binance.getDerivatives(symbol);
  } catch {
    return synthetic.getModeledDerivatives(symbol, candles);
  }
}

async function safeOrderBook(symbol) {
  try {
    const raw = await binance.getOrderBook(symbol);
    return synthetic.finalizeOrderBook(raw.bids, raw.asks, 'LIVE');
  } catch {
    return synthetic.getModeledOrderBook(symbol);
  }
}

/* ----------------------------- policy check ------------------------------ */

function passesPolicy(sig, source) {
  // Data quality gate
  if (!SIGNAL_POLICY.allowSyntheticSignals && source === 'SIMULATION') {
    return { pass: false, reason: 'synthetic-data' };
  }

  // Timeframe gate
  if (!SIGNAL_POLICY.allowedTimeframes.includes(sig.timeframe)) {
    return { pass: false, reason: 'timeframe' };
  }

  // Symbol gate
  if (!SIGNAL_POLICY.allowedSymbols.includes(sig.symbol)) {
    return { pass: false, reason: 'symbol' };
  }

  // Direction gate — only LONG/SHORT qualify
  if (sig.direction !== 'LONG' && sig.direction !== 'SHORT') {
    return { pass: false, reason: 'direction' };
  }

  // Probability gate — tiered
  if (sig.probability >= SIGNAL_POLICY.strongProbability) {
    return { pass: true, tier: 'strong' };
  }
  if (sig.probability >= SIGNAL_POLICY.minProbability) {
    return { pass: true, tier: 'watch' };
  }
  return { pass: false, reason: 'probability' };
}

/* ----------------------------- scan engine ------------------------------- */

export async function runScan(userId) {
  const out = [];

  // Only scan timeframes and symbols that could pass the policy.
  const timeframesToScan = SIGNAL_POLICY.allowedTimeframes;
  const symbolsToScan = SYMBOLS; // still scan all for dashboard, but filter before persisting

  for (const symbol of symbolsToScan) {
    // Prefetch needed timeframes only
    const klinesByTf = {};
    for (const tf of timeframesToScan) {
      klinesByTf[tf] = await safeKlines(symbol, tf, 300);
    }

    // Always fetch 1h for MTF context
    const kl1h = await safeKlines(symbol, '1h', 300);
    const kl5m = await safeKlines(symbol, '5m', 288);
    const kl15m = await safeKlines(symbol, '15m', 220);

    // Build MTF matrix
    const daily = resample(kl1h.candles.slice(-480), 24);
    const mtf = [
      { timeframe: '5M', ...trendScore(kl5m.candles.slice(-90)) },
      { timeframe: '15M', ...trendScore(kl15m.candles.slice(-90)) },
      { timeframe: '1H', ...trendScore(kl1h.candles.slice(-90)) },
      ...(klinesByTf['4h'] ? [{ timeframe: '4H', ...trendScore(klinesByTf['4h'].candles.slice(-90)) }] : []),
      ...(daily.length > 30 ? [{ timeframe: '1D', ...trendScore(daily.slice(-60)) }] : []),
    ];

    const derivatives = await safeDerivatives(symbol, kl1h.candles);
    const orderBook = await safeOrderBook(symbol);

    for (const tf of timeframesToScan) {
      if (!klinesByTf[tf]) continue;
      const { candles, source } = klinesByTf[tf];

      const signal = composeSignal({
        symbol, timeframe: tf, candles,
        derivatives, orderBook, mtf,
        dataSource: source,
      });

      // Policy gate
      const check = passesPolicy(signal, source);
      if (!check.pass) {
        logger.debug(
          `[scan] ${symbol} ${tf} skipped (${check.reason}) — ` +
          `dir=${signal.direction} prob=${signal.probability.toFixed(3)} source=${source}`
        );
        continue;
      }

      // Persist only passing signals
      const stored = await persistSignal(userId, signal, source, check.tier);
      if (stored) out.push({ ...signal, tier: check.tier });
    }
  }
  return out;
}

async function persistSignal(userId, s, source, tier) {
  const last = await Signal.lastFor(userId, s.symbol, s.timeframe);

  const shouldInsert =
    !last ||
    last.direction !== s.direction ||
    last.status !== 'ACTIVE' ||
    (Date.now() - new Date(last.created_at).getTime()) / 3_600_000 > 4;

  if (!shouldInsert) return false;

  if (last && last.status === 'ACTIVE') {
    await Signal.cancelActive(last.id);
  }

  const id = await Signal.insert({
    userId,
    symbol: s.symbol,
    timeframe: s.timeframe,
    direction: s.direction,
    strength: s.strength,
    probability: s.probability,
    rawProbability: s.rawProbability,
    confidence: s.confidence,
    confidenceScore: s.confidenceScore,
    risk: s.risk,
    riskScore: s.riskScore,
    regime: s.regime,
    price: s.price,
    entry: s.entry,
    tp1: s.tp1,
    tp2: s.tp2,
    stopLoss: s.stopLoss,
    riskReward: s.riskReward,
    models: s.models,
    features: { ...s.features, policyTier: tier },
    reasons: s.reasons,
    warnings: s.warnings,
    horizonBars: s.horizonBars,
    target: s.target,
    dataSource: source,
    modelVersion: MODEL_VERSION,
    status: 'ACTIVE',
  });

  broadcast('signals', {
    id, symbol: s.symbol, timeframe: s.timeframe,
    direction: s.direction, tier, probability: s.probability,
  });
  return true;
}

/* ------------------------------ resolution ------------------------------- */

const RESOLVE_COOLDOWN = new Map();

export async function resolveActiveSignals(userId) {
  const now = Date.now();
  if (now - (RESOLVE_COOLDOWN.get(userId) || 0) < 45_000) return;
  RESOLVE_COOLDOWN.set(userId, now);

  const active = await Signal.listActive(userId);
  for (const sig of active) {
    if (!['LONG', 'SHORT'].includes(sig.direction) || !sig.entry || !sig.tp1 || !sig.stop_loss) {
      if (now - new Date(sig.created_at).getTime() > 86_400_000) {
        await Signal.resolve(sig.id, {
          status: 'EXPIRED', exitPrice: sig.price, pnlPct: 0,
          exitTime: Math.floor(now / 1000),
        });
      }
      continue;
    }

    const tf = sig.timeframe === '4h' ? '4h' : '1h';
    const { candles } = await safeKlines(sig.symbol, tf, 500);
    const createdSec = Math.floor(new Date(sig.created_at).getTime() / 1000);
    const after = candles.filter((c) => c.time > createdSec);
    if (!after.length) continue;

    const horizon = sig.horizon_bars || 8;
    const path = after.slice(0, horizon);

    let status = null, exitPrice = null, exitTime = null;
    for (const bar of path) {
      if (sig.direction === 'LONG') {
        if (bar.low <= sig.stop_loss) { status = 'LOSS'; exitPrice = sig.stop_loss; exitTime = bar.time; break; }
        if (bar.high >= sig.tp1)      { status = 'WIN';  exitPrice = sig.tp1;      exitTime = bar.time; break; }
      } else {
        if (bar.high >= sig.stop_loss) { status = 'LOSS'; exitPrice = sig.stop_loss; exitTime = bar.time; break; }
        if (bar.low <= sig.tp1)        { status = 'WIN';  exitPrice = sig.tp1;      exitTime = bar.time; break; }
      }
    }

    if (!status && after.length >= horizon) {
      status = 'EXPIRED';
      const last = after[horizon - 1];
      exitPrice = last.close;
      exitTime = last.time;
    }

    if (status && exitPrice !== null) {
      const roundTrip = 0.16;
      const pnlPct =
        (sig.direction === 'LONG'
          ? (exitPrice - sig.entry) / sig.entry
          : (sig.entry - exitPrice) / sig.entry) * 100 - roundTrip;

      await Signal.resolve(sig.id, { status, exitPrice, pnlPct, exitTime });
    }
  }
}

/* --------------------------- market overview ----------------------------- */

export async function getMarketOverview() {
  const symbols = [...SYMBOLS];
  let tickers, source;
  try {
    const res = await binance.getTickers(symbols);
    tickers = res.tickers;
    source = 'BINANCE';
  } catch {
    tickers = synthetic.getSyntheticTickers(symbols);
    source = 'SIMULATION';
  }

  const out = [];
  for (const t of tickers) {
    const { candles } = await safeKlines(t.symbol, '1h', 240);
    const snap = snapshot(candles);
    const last = await query(
      `SELECT direction, probability, confidence, risk, strength, timeframe
       FROM signals WHERE symbol = ? AND status = 'ACTIVE'
       ORDER BY created_at DESC LIMIT 1`,
      [t.symbol]
    );
    out.push({
      symbol: t.symbol,
      name: t.symbol.replace('USDT', ''),
      price: t.price, change24h: t.change24h,
      high24h: t.high24h, low24h: t.low24h,
      volume24h: t.volume24h, quoteVolume24h: t.quoteVolume24h,
      spark: candles.slice(-42).map((c) => c.close),
      regime: detectRegimeProxy(snap),
      trendScore: snap.emaAligned,
      source,
      signal: last[0] || null,
      policy: {
        tradeable: SIGNAL_POLICY.allowedSymbols.includes(t.symbol),
        allowedTimeframes: SIGNAL_POLICY.allowedTimeframes,
        minProbability: SIGNAL_POLICY.minProbability,
        strongProbability: SIGNAL_POLICY.strongProbability,
      },
    });
  }
  return out;
}

function detectRegimeProxy(snap) {
  const vol = snap.atrPct * 100;
  if (vol > 1.6) return 'HIGH_VOLATILITY';
  if (snap.adx < 14 && vol < 0.28) return 'LOW_VOLATILITY';
  if (snap.adx >= 27 && snap.emaAligned > 0.35) return 'STRONG_BULL';
  if (snap.adx >= 27 && snap.emaAligned < -0.35) return 'STRONG_BEAR';
  if (snap.emaAligned > 0.35) return 'WEAK_BULL';
  if (snap.emaAligned < -0.35) return 'WEAK_BEAR';
  return 'SIDEWAYS';
}

/* --------------------------- symbol snapshot ----------------------------- */

export async function getSymbolSnapshot(symbol) {
  const [kl1h, kl5m, kl15m, kl4h, tickersRes] = await Promise.all([
    safeKlines(symbol, '1h', 320),
    safeKlines(symbol, '5m', 288),
    safeKlines(symbol, '15m', 220),
    safeKlines(symbol, '4h', 260),
    (async () => {
      try { return await binance.getTickers([symbol]); }
      catch { return { source: 'SIMULATION', tickers: synthetic.getSyntheticTickers([symbol]) }; }
    })(),
  ]);

  const daily = resample(kl1h.candles.slice(-480), 24);
  const mtf = [
    { timeframe: '5M', ...trendScore(kl5m.candles.slice(-90)) },
    { timeframe: '15M', ...trendScore(kl15m.candles.slice(-90)) },
    { timeframe: '1H', ...trendScore(kl1h.candles.slice(-90)) },
    { timeframe: '4H', ...trendScore(kl4h.candles.slice(-90)) },
    ...(daily.length > 30 ? [{ timeframe: '1D', ...trendScore(daily.slice(-60)) }] : []),
  ];

  const derivatives = await safeDerivatives(symbol, kl1h.candles);
  const orderBook = await safeOrderBook(symbol);

  // Signal — always on 1H for display
  const signal = composeSignal({
    symbol, timeframe: '1h', candles: kl1h.candles,
    derivatives, orderBook, mtf,
    dataSource: kl1h.source,
  });

  // Also 4H signal (this is what the policy uses)
  const signal4h = composeSignal({
    symbol, timeframe: '4h', candles: kl4h.candles,
    derivatives, orderBook, mtf,
    dataSource: kl4h.source,
  });

  const { emaArr } = await import('./indicator.service.js');
  const closes = kl1h.candles.map((c) => c.close);
  const e20 = emaArr(closes, 20).slice(-260).map((v) => (Number.isNaN(v) ? null : v));
  const e50 = emaArr(closes, 50).slice(-260).map((v) => (Number.isNaN(v) ? null : v));

  return {
    symbol,
    ticker: tickersRes.tickers[0] || null,
    signal,
    signal4h,
    policy: {
      tradeable: SIGNAL_POLICY.allowedSymbols.includes(symbol),
      allowedTimeframes: SIGNAL_POLICY.allowedTimeframes,
      minProbability: SIGNAL_POLICY.minProbability,
      strongProbability: SIGNAL_POLICY.strongProbability,
    },
    indicators: snapshot(kl1h.candles),
    mtf,
    derivatives,
    orderBook,
    chart: {
      candles: kl1h.candles.slice(-260),
      ema20: e20,
      ema50: e50,
    },
    source: kl1h.source,
  };
}