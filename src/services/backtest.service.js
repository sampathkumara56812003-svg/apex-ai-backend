// backend/src/services/backtest.service.js
// Walk-forward backtester with strict causality + Phase A policy filters.

import { composeSignal } from './engine.service.js';
import {
  HORIZON_BARS,
  TRADING,
  MODEL_VERSION,
  SIGNAL_POLICY,
} from '../config/constants.js';
import { Backtest } from '../models/backtest.model.js';

/* =====================================================================
 * runBacktest()
 * ---------------------------------------------------------------------
 * Event-driven walk-forward simulation.
 * At each evaluation bar the signal engine sees only data up to that
 * bar (strictly causal). Trades are simulated bar-by-bar to the first
 * TP / SL touch or the horizon expiry. Fees + slippage are deducted.
 * ===================================================================== */
export function runBacktest(opts) {
  const {
    symbol,
    timeframe,
    candles,
    minProbability = 0.55,
    tpMult = 1.6,
    slAtrMult = 1.15,
    horizonBars = HORIZON_BARS[timeframe] || 12,
    step = 4,
    initialEquity = 10000,
    riskPerTradePct = TRADING.riskPerTradePct,
    htfGate = 0,
    applyPolicy = true,   // Phase A filter toggle
  } = opts;

  const warmup = Math.min(230, Math.floor(candles.length * 0.3));
  const feePct = ((TRADING.takerFeeBps + TRADING.slippageBps) / 10000) * 2 * 100;

  // Policy-level early exit — if this symbol/timeframe combination is not
  // allowed by the live policy, there is nothing to backtest.
  if (applyPolicy) {
    if (!SIGNAL_POLICY.allowedTimeframes.includes(timeframe)) {
      return emptyResult(initialEquity, `timeframe ${timeframe} not in policy`);
    }
    if (!SIGNAL_POLICY.allowedSymbols.includes(symbol)) {
      return emptyResult(initialEquity, `symbol ${symbol} not in policy`);
    }
  }

  const effectiveMinProb = applyPolicy
    ? Math.max(minProbability, SIGNAL_POLICY.minProbability)
    : Math.max(minProbability, 0.56);

  const trades = [];
  const equityCurve = [];
  let equity = initialEquity;
  let busyUntil = -1;

  for (let i = warmup; i < candles.length - 2; i += step) {
    if (i <= busyUntil) continue;

    const window = candles.slice(Math.max(0, i - 300), i + 1);

    let sig;
    try {
      sig = composeSignal({
        symbol,
        timeframe,
        candles: window,
        dataSource: 'BINANCE',
      });
    } catch {
      continue;
    }

    equityCurve.push({ time: candles[i].time, equity });

    // -------------------------------------------------------------
    // Eligibility gates
    // -------------------------------------------------------------
    if (
      (sig.direction !== 'LONG' && sig.direction !== 'SHORT') ||
      sig.probability < effectiveMinProb ||
      sig.risk === 'EXTREME' ||
      sig.confidence === 'LOW' ||
      sig.riskScore > 58 ||
      !sig.entry ||
      !sig.stopLoss
    ) {
      continue;
    }

    if (
      htfGate > 0 &&
      (sig.features.htfAlign || 0) * (sig.direction === 'LONG' ? 1 : -1) < htfGate
    ) {
      continue;
    }

    const side = sig.direction;

    // Stretched-entry guard — blocks chasing into band extremes
    const bbPos = sig.features.bbPosition;
    if ((side === 'LONG' && bbPos > 0.86) || (side === 'SHORT' && bbPos < 0.14)) {
      continue;
    }

    // -------------------------------------------------------------
    // Limit-entry fill — order only fills if price trades through
    // the entry within the next 2 bars, otherwise skip.
    // -------------------------------------------------------------
    const limitEntry = sig.entry;
    let entry = null;
    let entryBar = i;

    for (let j = i + 1; j <= Math.min(i + 2, candles.length - 1); j++) {
      const bar = candles[j];
      if (side === 'LONG' && bar.low <= limitEntry) {
        entry = limitEntry * (1 + TRADING.slippageBps / 10000);
        entryBar = j;
        break;
      }
      if (side === 'SHORT' && bar.high >= limitEntry) {
        entry = limitEntry * (1 - TRADING.slippageBps / 10000);
        entryBar = j;
        break;
      }
    }
    if (entry === null) continue;

    // -------------------------------------------------------------
    // Levels
    // -------------------------------------------------------------
    const slDist = Math.max(
      (sig.features.atrPct / 100) * entry * slAtrMult,
      entry * 0.002
    );

    let sl = side === 'LONG' ? entry - slDist : entry + slDist;
    const tp1 = side === 'LONG' ? entry + slDist * tpMult : entry - slDist * tpMult;
    const tp2 =
      side === 'LONG'
        ? entry + slDist * tpMult * 1.7
        : entry - slDist * tpMult * 1.7;

    let breakevenArmed = false;

    // -------------------------------------------------------------
    // Bar-by-bar simulation
    // -------------------------------------------------------------
    let exit = entry;
    let exitReason = 'TIMEOUT';
    let exitIdx = Math.min(entryBar + horizonBars, candles.length - 1);
    let exitTime = candles[exitIdx].time;

    for (let j = entryBar; j <= exitIdx; j++) {
      const bar = candles[j];

      if (side === 'LONG') {
        // Breakeven ratchet — once +1R trades, move stop to entry
        if (!breakevenArmed && bar.high >= entry + slDist) {
          sl = Math.max(sl, entry + entry * 0.0002);
          breakevenArmed = true;
        }

        const slHit = bar.low <= sl;
        const tpHit = bar.high >= tp1;
        const tp2Hit = bar.high >= tp2;

        // Priority: TP2 first, then SL, then TP1
        if (tp2Hit && !slHit) { exit = tp2; exitReason = 'TP2'; exitTime = bar.time; break; }
        if (slHit)            { exit = sl;  exitReason = 'SL';  exitTime = bar.time; break; }
        if (tpHit)            { exit = tp1; exitReason = 'TP1'; exitTime = bar.time; break; }
      } else {
        if (!breakevenArmed && bar.low <= entry - slDist) {
          sl = Math.min(sl, entry - entry * 0.0002);
          breakevenArmed = true;
        }

        const slHit = bar.high >= sl;
        const tpHit = bar.low <= tp1;
        const tp2Hit = bar.low <= tp2;

        if (tp2Hit && !slHit) { exit = tp2; exitReason = 'TP2'; exitTime = bar.time; break; }
        if (slHit)            { exit = sl;  exitReason = 'SL';  exitTime = bar.time; break; }
        if (tpHit)            { exit = tp1; exitReason = 'TP1'; exitTime = bar.time; break; }
      }

      // If nothing triggered, keep updating to current close
      exit = bar.close;
      exitTime = bar.time;
    }

    // -------------------------------------------------------------
    // PnL
    // -------------------------------------------------------------
    const grossPct =
      (side === 'LONG' ? (exit - entry) / entry : (entry - exit) / entry) * 100;
    const pnlPct = grossPct - feePct;

    const posRiskUsd = (riskPerTradePct / 100) * equity;
    const pnlUsd = (pnlPct / 100) * (posRiskUsd / (slDist / entry));

    equity += pnlUsd;
    equity = Math.max(equity, 100);

    trades.push({
      entryTime: candles[entryBar].time,
      exitTime,
      side,
      entry,
      exit,
      pnlPct,
      pnlUsd,
      exitReason,
      probability: sig.probability,
    });

    busyUntil = exitIdx;
  }

  const metrics = computeMetrics(trades, equityCurve, initialEquity, feePct, candles);

  return {
    metrics,
    trades,
    equityCurve: downsample(equityCurve, 400),
  };
}

/* =====================================================================
 * computeMetrics()
 * ===================================================================== */
function computeMetrics(trades, equityCurve, initialEquity, feePct, candles) {
  const wins = trades.filter((t) => t.pnlPct > 0);
  const losses = trades.filter((t) => t.pnlPct <= 0);

  const grossWin = wins.reduce((s, t) => s + t.pnlUsd, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnlUsd, 0));

  // Max drawdown over trade-by-trade equity
  let peak = initialEquity;
  let eq = initialEquity;
  let maxDd = 0;
  for (const t of trades) {
    eq += t.pnlUsd;
    peak = Math.max(peak, eq);
    maxDd = Math.max(maxDd, peak > 0 ? ((peak - eq) / peak) * 100 : 0);
  }

  const finalEquity = initialEquity + trades.reduce((s, t) => s + t.pnlUsd, 0);

  const returns = trades.map((t) => t.pnlPct);
  const meanR = returns.length
    ? returns.reduce((s, v) => s + v, 0) / returns.length
    : 0;
  const stdR =
    returns.length > 1
      ? Math.sqrt(
          returns.reduce((s, v) => s + (v - meanR) ** 2, 0) / (returns.length - 1)
        )
      : 1;

  // Annualisation from candle span
  const spanSec =
    candles.length > 1 ? candles[candles.length - 1].time - candles[0].time : 1;
  const years = Math.max(spanSec / (365 * 86400), 0.08);
  const tradesPerYear = trades.length / years;
  const sharpe = stdR > 0 ? (meanR / stdR) * Math.sqrt(Math.max(tradesPerYear, 1)) : 0;

  return {
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99 : 0,
    netReturnPct: ((finalEquity - initialEquity) / initialEquity) * 100,
    maxDrawdownPct: maxDd,
    avgWinPct: wins.length ? wins.reduce((s, t) => s + t.pnlPct, 0) / wins.length : 0,
    avgLossPct: losses.length ? losses.reduce((s, t) => s + t.pnlPct, 0) / losses.length : 0,
    expectancyPct: meanR,
    sharpe,
    falseSignalRate: trades.length ? (losses.length / trades.length) * 100 : 0,
    feesPaid: trades.length * feePct,
    calibration: calibrationBuckets(trades),
  };
}

/* =====================================================================
 * calibrationBuckets()
 * ===================================================================== */
function calibrationBuckets(trades) {
  const bins = [
    { bucket: '50-55%', min: 0.0, max: 0.55 },
    { bucket: '55-65%', min: 0.55, max: 0.65 },
    { bucket: '65-75%', min: 0.65, max: 0.75 },
    { bucket: '75%+',  min: 0.75, max: 1.01 },
  ];

  return bins
    .map((b) => {
      const inBin = trades.filter(
        (t) => t.probability >= b.min && t.probability < b.max
      );
      const wins = inBin.filter((t) => t.pnlPct > 0);
      return {
        bucket: b.bucket,
        predicted: inBin.length
          ? (inBin.reduce((s, t) => s + t.probability, 0) / inBin.length) * 100
          : 0,
        actual: inBin.length ? (wins.length / inBin.length) * 100 : 0,
        count: inBin.length,
      };
    })
    .filter((b) => b.count > 0);
}

/* =====================================================================
 * downsample()
 * ===================================================================== */
function downsample(curve, maxPoints) {
  if (curve.length <= maxPoints) return curve;
  const out = [];
  const stride = curve.length / maxPoints;
  for (let i = 0; i < maxPoints; i++) {
    out.push(curve[Math.floor(i * stride)]);
  }
  out.push(curve[curve.length - 1]);
  return out;
}

/* =====================================================================
 * emptyResult()
 * ===================================================================== */
function emptyResult(initialEquity, reason) {
  return {
    metrics: {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      profitFactor: 0,
      netReturnPct: 0,
      maxDrawdownPct: 0,
      avgWinPct: 0,
      avgLossPct: 0,
      expectancyPct: 0,
      sharpe: 0,
      falseSignalRate: 0,
      feesPaid: 0,
      calibration: [],
      blockedReason: reason,
    },
    trades: [],
    equityCurve: [],
  };
}

/* =====================================================================
 * persistBacktest()
 * ===================================================================== */
export async function persistBacktest(userId, result, params) {
  const id = await Backtest.create({
    userId,
    symbol: params.symbol,
    timeframe: params.timeframe,
    bars: params.bars,
    params: {
      minProbability: params.minProbability,
      tpMult: params.tpMult,
      slAtrMult: params.slAtrMult,
      applyPolicy: params.applyPolicy !== false,
    },
    metrics: result.metrics,
    equityCurve: result.equityCurve,
    trades: result.trades.slice(-100),
    dataSource: params.dataSource || 'BINANCE',
    modelVersion: MODEL_VERSION,
  });
  return id;
}