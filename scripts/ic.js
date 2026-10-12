// backend/scripts/ic.js — Information Coefficient + Policy Impact Analysis
// Usage: node scripts/ic.js [timeframe] [symbol]
//   node scripts/ic.js           → 1h + 4h, all symbols
//   node scripts/ic.js 4h        → 4h only
//   node scripts/ic.js 4h ETHUSDT
import dotenv from 'dotenv';
dotenv.config();

import { composeSignal } from '../src/services/engine.service.js';
import { SYMBOLS, SIGNAL_POLICY } from '../src/config/constants.js';

const SPOT_BASE = process.env.BINANCE_SPOT_BASE || 'https://data-api.binance.vision';

const BARS_PER_SYMBOL = 1500;
const EVAL_STEP = 4;
const WARMUP_BARS = 235;
const FORWARD_BARS = 12;
const BUCKETS = [0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 1.01];

/* ------------------------------------------------------------------ */
/* DATA LOADING — real Binance only. No synthetic fallback.            */
/* ------------------------------------------------------------------ */
async function fetchKlinesOnce(symbol, tf, limit, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const url = `${SPOT_BASE}/api/v3/klines?symbol=${symbol}&interval=${tf}&limit=${limit}`;
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    if (!Array.isArray(raw) || raw.length < 50) throw new Error('bad klines payload');
    return raw.map((k) => ({
      time: Math.floor(Number(k[0]) / 1000),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
    }));
  } finally {
    clearTimeout(timer);
  }
}

async function loadCandles(symbol, tf, limit) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const candles = await fetchKlinesOnce(symbol, tf, limit);
      return { candles, source: 'BINANCE' };
    } catch (err) {
      if (attempt === 3) {
        console.warn(`  [skip] ${symbol} ${tf} — real Binance data unavailable after 3 tries: ${err.message}`);
        return null;
      }
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* CORE MEASUREMENT                                                    */
/* ------------------------------------------------------------------ */
async function evaluate(symbol, tf) {
  const loaded = await loadCandles(symbol, tf, BARS_PER_SYMBOL);
  if (!loaded) return null;

  const { candles, source } = loaded;
  if (candles.length < WARMUP_BARS + FORWARD_BARS + 50) {
    console.log(`  [skip] ${symbol} ${tf} — not enough history (${candles.length} bars)`);
    return null;
  }

  const rows = [];
  const barSpan = candles[candles.length - 1].time - candles[0].time;
  const spanDays = barSpan / 86400;

  for (let i = WARMUP_BARS; i < candles.length - FORWARD_BARS - 1; i += EVAL_STEP) {
    const window = candles.slice(Math.max(0, i - 300), i + 1);

    let sig;
    try {
      sig = composeSignal({ symbol, timeframe: tf, candles: window, dataSource: source });
    } catch {
      continue;
    }
    if (sig.direction !== 'LONG' && sig.direction !== 'SHORT') continue;

    const dir = sig.direction === 'LONG' ? 1 : -1;
    const entry = candles[i].close;
    const future = candles[i + FORWARD_BARS].close;
    const forwardReturn = (future - entry) / entry;
    const directionalWin = dir * forwardReturn > 0;

    let targetHit = null;
    if (sig.tp1 && sig.stopLoss) {
      targetHit = 0;
      for (let j = i + 1; j <= Math.min(i + FORWARD_BARS, candles.length - 1); j++) {
        const bar = candles[j];
        if (dir === 1) {
          if (bar.low <= sig.stopLoss) { targetHit = 0; break; }
          if (bar.high >= sig.tp1)     { targetHit = 1; break; }
        } else {
          if (bar.high >= sig.stopLoss) { targetHit = 0; break; }
          if (bar.low <= sig.tp1)       { targetHit = 1; break; }
        }
      }
    }

    rows.push({
      symbol, timeframe: tf,
      direction: sig.direction, dir,
      probability: sig.probability,
      rawProbability: sig.rawProbability,
      confidence: sig.confidence,
      risk: sig.risk,
      regime: sig.regime,
      forwardReturn,
      directionalWin,
      targetHit,
    });
  }

  if (rows.length < 20) {
    console.log(`  [skip] ${symbol} ${tf} — only ${rows.length} tradeable signals`);
    return null;
  }

  return { symbol, tf, rows, source, spanDays };
}

/* ------------------------------------------------------------------ */
/* STATISTICS                                                          */
/* ------------------------------------------------------------------ */
function mean(a) { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0; }

function spearman(xs, ys) {
  const n = xs.length;
  if (n < 3) return 0;
  const rank = (arr) => {
    const s = [...arr].map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const r = new Array(n);
    for (let i = 0; i < s.length; i++) r[s[i].i] = i + 1;
    return r;
  };
  const rx = rank(xs), ry = rank(ys);
  const mx = mean(rx), my = mean(ry);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0;
}

function bucketStats(rows) {
  return BUCKETS.slice(0, -1).map((lo, idx) => {
    const hi = BUCKETS[idx + 1];
    const inB = rows.filter((r) => r.probability >= lo && r.probability < hi);
    if (!inB.length) return null;
    const wins = inB.filter((r) => r.directionalWin).length;
    return {
      range: `${(lo * 100).toFixed(0)}-${(hi * 100).toFixed(0)}%`,
      count: inB.length,
      avgPred: mean(inB.map((r) => r.probability)) * 100,
      actualAcc: (wins / inB.length) * 100,
      avgRet: mean(inB.map((r) => r.dir * r.forwardReturn)) * 100,
    };
  }).filter(Boolean);
}

function verdict(acc) {
  if (acc >= 58) return 'STRONG EDGE';
  if (acc >= 54) return 'WEAK EDGE';
  if (acc >= 51) return 'MARGINAL';
  return 'NO EDGE';
}

function evaluatePolicy(rows, policy) {
  return rows.filter((r) => {
    if (policy.allowedTimeframes && !policy.allowedTimeframes.includes(r.timeframe)) return false;
    if (policy.allowedSymbols && !policy.allowedSymbols.includes(r.symbol)) return false;
    if (policy.minProbability != null && r.probability < policy.minProbability) return false;
    return true;
  });
}

function summarize(rows, label) {
  if (!rows.length) return null;
  const n = rows.length;
  const acc = (rows.filter((r) => r.directionalWin).length / n) * 100;
  const ic = spearman(rows.map((r) => r.probability), rows.map((r) => r.dir * r.forwardReturn));
  const targetRows = rows.filter((r) => r.targetHit !== null);
  const targetHitRate = targetRows.length
    ? (targetRows.filter((r) => r.targetHit === 1).length / targetRows.length) * 100
    : 0;
  const avgDirReturn = mean(rows.map((r) => r.dir * r.forwardReturn)) * 100;
  const feePct = 0.16;
  const netCumulative = rows.reduce((s, r) => s + (r.dir * r.forwardReturn * 100 - feePct), 0);

  return {
    label, n, acc, ic, targetHitRate, avgDirReturn, netCumulative,
    wins: rows.filter((r) => r.directionalWin).length,
    losses: rows.filter((r) => !r.directionalWin).length,
  };
}

/* ------------------------------------------------------------------ */
/* REPORTS                                                             */
/* ------------------------------------------------------------------ */
function reportPerSymbol(results) {
  console.log('');
  console.log('═'.repeat(76));
  console.log('  RAW PER-SYMBOL RESULTS (unfiltered, real Binance data only)');
  console.log('═'.repeat(76));
  console.log(`  ${'symbol'.padEnd(10)} ${'tf'.padEnd(4)} ${'n'.padStart(5)}  ${'dir acc'.padStart(8)}  ${'IC'.padStart(7)}  ${'avg ret'.padStart(9)}  ${'verdict'.padStart(12)}`);
  console.log(`  ${'─'.repeat(10)} ${'─'.repeat(4)} ${'─'.repeat(5)}  ${'─'.repeat(8)}  ${'─'.repeat(7)}  ${'─'.repeat(9)}  ${'─'.repeat(12)}`);
  for (const r of results) {
    const n = r.rows.length;
    const acc = (r.rows.filter((x) => x.directionalWin).length / n) * 100;
    const ic = spearman(r.rows.map((x) => x.probability), r.rows.map((x) => x.dir * x.forwardReturn));
    const avgRet = mean(r.rows.map((x) => x.dir * x.forwardReturn)) * 100;
    const mark = acc >= 54 ? '✅' : acc >= 51 ? '🟡' : '❌';
    console.log(
      `  ${r.symbol.padEnd(10)} ${r.tf.toUpperCase().padEnd(4)} ${String(n).padStart(5)}  ` +
      `${(acc.toFixed(1) + '%').padStart(8)} ${mark}  ` +
      `${ic.toFixed(3).padStart(7)}  ` +
      `${((avgRet >= 0 ? '+' : '') + avgRet.toFixed(3) + '%').padStart(9)}  ` +
      `${verdict(acc).padStart(12)}`
    );
  }
}

function reportPolicyComparison(allRows) {
  const policies = [
    { label: 'BASELINE (no filter)',               allowedTimeframes: ['1h','4h'], allowedSymbols: ['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT'], minProbability: 0.55 },
    { label: 'A-1  4H only',                       allowedTimeframes: ['4h'],      allowedSymbols: ['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT'], minProbability: 0.55 },
    { label: 'A-2  4H + BTC/ETH',                  allowedTimeframes: ['4h'],      allowedSymbols: ['BTCUSDT','ETHUSDT'],                     minProbability: 0.55 },
    { label: 'A-3  4H + BTC/ETH + ≥0.65',          allowedTimeframes: ['4h'],      allowedSymbols: ['BTCUSDT','ETHUSDT'],                     minProbability: 0.65 },
    { label: 'A-4  4H + BTC/ETH + ≥0.70',          allowedTimeframes: ['4h'],      allowedSymbols: ['BTCUSDT','ETHUSDT'],                     minProbability: 0.70 },
    { label: 'A-5  4H + BTC/ETH + ≥0.75',          allowedTimeframes: ['4h'],      allowedSymbols: ['BTCUSDT','ETHUSDT'],                     minProbability: 0.75 },
  ];

  console.log('');
  console.log('═'.repeat(76));
  console.log('  POLICY IMPACT — same data, different filters');
  console.log('═'.repeat(76));
  console.log('');
  console.log(`  ${'policy'.padEnd(34)} ${'n'.padStart(5)}  ${'acc'.padStart(7)}  ${'IC'.padStart(7)}  ${'netPnL'.padStart(9)}  ${'verdict'.padStart(12)}`);
  console.log(`  ${'─'.repeat(34)} ${'─'.repeat(5)}  ${'─'.repeat(7)}  ${'─'.repeat(7)}  ${'─'.repeat(9)}  ${'─'.repeat(12)}`);

  for (const p of policies) {
    const filtered = evaluatePolicy(allRows, p);
    const s = summarize(filtered, p.label);
    if (!s) {
      console.log(`  ${p.label.padEnd(34)} ${'(no signals)'.padStart(5)}`);
      continue;
    }
    const accStr = `${s.acc.toFixed(1)}%`;
    const pnlStr = `${s.netCumulative >= 0 ? '+' : ''}${s.netCumulative.toFixed(1)}%`;
    const marker = s.acc >= 54 && s.n >= 60 ? '✅' : s.acc >= 51 ? '🟡' : '❌';
    console.log(
      `  ${p.label.padEnd(34)} ${String(s.n).padStart(5)}  ${accStr.padStart(7)}  ` +
      `${s.ic.toFixed(3).padStart(7)}  ${pnlStr.padStart(9)}  ${verdict(s.acc).padStart(12)} ${marker}`
    );
  }

  // Recommended policy bucket detail
  const recommended = evaluatePolicy(allRows, SIGNAL_POLICY);
  if (recommended.length) {
    console.log('');
    console.log('═'.repeat(76));
    console.log(`  RECOMMENDED POLICY  ·  ${SIGNAL_POLICY.allowedTimeframes.join(', ')} · ` +
                `${SIGNAL_POLICY.allowedSymbols.join(', ')} · prob ≥ ${SIGNAL_POLICY.minProbability}`);
    console.log(`  n = ${recommended.length} signals`);
    console.log('═'.repeat(76));
    console.log('');
    console.log(`  ${'bucket'.padEnd(12)} ${'n'.padStart(5)}  ${'predicted'.padStart(10)}  ${'actual'.padStart(8)}  ${'avg dir ret'.padStart(12)}`);
    console.log(`  ${'─'.repeat(12)} ${'─'.repeat(5)}  ${'─'.repeat(10)}  ${'─'.repeat(8)}  ${'─'.repeat(12)}`);
    for (const b of bucketStats(recommended)) {
      const mark = b.actualAcc >= b.avgPred - 5 ? '✅' : b.actualAcc >= b.avgPred - 12 ? '🟡' : '❌';
      console.log(
        `  ${b.range.padEnd(12)} ${String(b.count).padStart(5)}  ` +
        `${(b.avgPred.toFixed(1) + '%').padStart(10)}  ` +
        `${(b.actualAcc.toFixed(1) + '%').padStart(7)} ${mark}  ` +
        `${((b.avgRet >= 0 ? '+' : '') + b.avgRet.toFixed(3) + '%').padStart(12)}`
      );
    }
  }
}

/* ------------------------------------------------------------------ */
/* MAIN                                                                */
/* ------------------------------------------------------------------ */
async function main() {
  const tfArg = process.argv[2];
  const symArg = process.argv[3];

  const timeframes = tfArg ? [tfArg] : ['1h', '4h'];
  const symbols = symArg ? [symArg] : SYMBOLS;

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║  APEX/AI — IC Report + Policy Impact                                 ║');
  console.log('║  Real Binance data only — synthetic fallback is REFUSED              ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  console.log(`  Bars/symbol: ${BARS_PER_SYMBOL}  ·  Forward window: ${FORWARD_BARS} bars`);
  console.log(`  Endpoint:    ${SPOT_BASE}`);
  console.log('');

  const results = [];
  for (const tf of timeframes) {
    for (const sym of symbols) {
      process.stdout.write(`  evaluating ${sym.padEnd(8)} ${tf.padEnd(4)} … `);
      const r = await evaluate(sym, tf);
      if (r) {
        console.log(`✓  ${r.rows.length} signals`);
        results.push(r);
      }
    }
  }

  if (!results.length) {
    console.log('\n  No valid results — all symbols failed Binance fetch.');
    return;
  }

  reportPerSymbol(results);

  const allRows = results.flatMap((r) => r.rows);
  reportPolicyComparison(allRows);

  console.log('');
  console.log('  ────────────────────────────────────────────────────────────────');
  console.log('  HOW TO PICK A POLICY');
  console.log('  ────────────────────────────────────────────────────────────────');
  console.log('  • Accuracy ≥ 54%    →  real directional edge.');
  console.log('  • IC ≥ 0.05         →  probability predicts returns monotonically.');
  console.log('  • netPnL positive   →  survives fees.');
  console.log('  • Sample size ≥ 60  →  statistically meaningful.');
  console.log('');
  console.log('  Pick the tightest filter that still leaves ≥60 signals.');
  console.log('  Synthetic data was NOT used in this report — every number is real.');
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});