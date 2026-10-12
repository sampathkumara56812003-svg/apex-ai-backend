import { query } from '../config/database.js';
import { Performance } from '../models/performance.model.js';
import { MODEL_VERSION } from '../config/constants.js';

export async function getPerformance(userId) {
  const since = new Date(Date.now() - 95 * 86_400_000);
  const rows = await query(
    `SELECT * FROM signals WHERE user_id = ? AND created_at >= ?
     ORDER BY created_at DESC`,
    [userId, since]
  );

  const resolved = rows.filter(
    (r) =>
      (r.direction === 'LONG' || r.direction === 'SHORT') &&
      (r.status === 'WIN' || r.status === 'LOSS')
  );
  const wins = resolved.filter((r) => r.status === 'WIN');
  const losses = resolved.filter((r) => r.status === 'LOSS');

  const accIn = (days) => {
    const cut = Date.now() - days * 86_400_000;
    const inWin = resolved.filter((r) => r.resolved_at && new Date(r.resolved_at).getTime() > cut);
    const w = inWin.filter((r) => r.status === 'WIN').length;
    return {
      accuracy: inWin.length ? (w / inWin.length) * 100 : 0,
      trades: inWin.length,
    };
  };

  const grossWin = wins.reduce((s, r) => s + (r.pnl_pct ?? 0), 0);
  const grossLoss = Math.abs(losses.reduce((s, r) => s + (r.pnl_pct ?? 0), 0));

  const chrono = [...resolved].sort(
    (a, b) => new Date(a.resolved_at || 0) - new Date(b.resolved_at || 0)
  );

  let cum = 0, peak = 0, maxDd = 0;
  const equitySeries = [];
  for (const r of chrono) {
    cum += r.pnl_pct ?? 0;
    peak = Math.max(peak, cum);
    maxDd = Math.max(maxDd, peak - cum);
    if (r.resolved_at) {
      equitySeries.push({
        time: Math.floor(new Date(r.resolved_at).getTime() / 1000),
        value: cum,
      });
    }
  }

  const pnls = resolved.map((r) => r.pnl_pct ?? 0);
  const mean = pnls.length ? pnls.reduce((s, v) => s + v, 0) / pnls.length : 0;
  const std = pnls.length > 1
    ? Math.sqrt(pnls.reduce((s, v) => s + (v - mean) ** 2, 0) / (pnls.length - 1))
    : 1;
  const sharpe = std > 0 ? (mean / std) * Math.sqrt(Math.max(pnls.length / 3, 1)) : 0;

  const bins = [
    { label: '50–55%', min: 0, max: 0.55 },
    { label: '55–65%', min: 0.55, max: 0.65 },
    { label: '65–75%', min: 0.65, max: 0.75 },
    { label: '75%+', min: 0.75, max: 1.01 },
  ];
  const calibration = bins
    .map((b) => {
      const inBin = resolved.filter(
        (r) => r.probability >= b.min && r.probability < b.max
      );
      const w = inBin.filter((r) => r.status === 'WIN').length;
      return {
        bucket: b.label,
        predicted: inBin.length ? (inBin.reduce((s, r) => s + r.probability, 0) / inBin.length) * 100 : 0,
        actual: inBin.length ? (w / inBin.length) * 100 : 0,
        count: inBin.length,
      };
    })
    .filter((b) => b.count > 0);

  const symbols = [...new Set(resolved.map((r) => r.symbol))];
  const perSymbol = symbols.map((sym) => {
    const sRows = resolved.filter((r) => r.symbol === sym);
    const w = sRows.filter((r) => r.status === 'WIN');
    const l = sRows.filter((r) => r.status === 'LOSS');
    const gw = w.reduce((s, r) => s + (r.pnl_pct ?? 0), 0);
    const gl = Math.abs(l.reduce((s, r) => s + (r.pnl_pct ?? 0), 0));
    return {
      symbol: sym,
      trades: sRows.length,
      winRate: sRows.length ? (w.length / sRows.length) * 100 : 0,
      avgPnlPct: sRows.length ? sRows.reduce((s, r) => s + (r.pnl_pct ?? 0), 0) / sRows.length : 0,
      profitFactor: gl > 0 ? gw / gl : gw > 0 ? 99 : 0,
    };
  });

  const outcomes = ['WIN', 'LOSS', 'EXPIRED', 'CANCELLED', 'ACTIVE'].map((st) => ({
    status: st,
    count: rows.filter((r) => r.status === st).length,
  }));

  const directionBreakdown = ['LONG', 'SHORT', 'WAIT', 'NO_TRADE'].map((d) => {
    const dRows = rows.filter((r) => r.direction === d);
    const dResolved = dRows.filter((r) => r.status === 'WIN' || r.status === 'LOSS');
    const w = dResolved.filter((r) => r.status === 'WIN').length;
    return {
      direction: d,
      count: dRows.length,
      winRate: dResolved.length ? (w / dResolved.length) * 100 : 0,
    };
  });

  const confidenceAccuracy = ['HIGH', 'MEDIUM', 'LOW'].map((c) => {
    const cRows = resolved.filter((r) => r.confidence === c);
    const w = cRows.filter((r) => r.status === 'WIN').length;
    return {
      confidence: c,
      accuracy: cRows.length ? (w / cRows.length) * 100 : 0,
      count: cRows.length,
    };
  });

  return {
    windows: [7, 30, 90].map((d) => ({ label: `${d}D`, days: d, ...accIn(d) })),
    allTime: {
      totalSignals: rows.length,
      resolvedSignals: resolved.length,
      accuracy: resolved.length ? (wins.length / resolved.length) * 100 : 0,
      winRate: resolved.length ? (wins.length / resolved.length) * 100 : 0,
      profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99 : 0,
      expectancyPct: mean,
      maxDrawdownPct: maxDd,
      avgWinPct: wins.length ? wins.reduce((s, r) => s + (r.pnl_pct ?? 0), 0) / wins.length : 0,
      avgLossPct: losses.length ? losses.reduce((s, r) => s + (r.pnl_pct ?? 0), 0) / losses.length : 0,
      falseSignalRate: resolved.length ? (losses.length / resolved.length) * 100 : 0,
      sharpe,
    },
    calibration,
    perSymbol,
    outcomes,
    equitySeries,
    directionBreakdown,
    confidenceAccuracy,
  };
}

let lastPerfCalc = 0;
export async function calculatePerformance() {
  if (Date.now() - lastPerfCalc < 300_000) return;
  lastPerfCalc = Date.now();
  // Could persist snapshots into model_performance here
}