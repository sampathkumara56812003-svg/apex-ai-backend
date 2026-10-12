import { query } from '../config/database.js';

export const Performance = {
  insert: (data) =>
    query(
      `INSERT INTO model_performance
        (model_version, window_label, symbol, accuracy, win_rate, profit_factor,
         expectancy_pct, max_drawdown_pct, sharpe, total_trades)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        data.modelVersion, data.windowLabel, data.symbol ?? null,
        data.accuracy ?? null, data.winRate ?? null, data.profitFactor ?? null,
        data.expectancyPct ?? null, data.maxDrawdownPct ?? null,
        data.sharpe ?? null, data.totalTrades ?? 0,
      ]
    ),

  latest: (modelVersion, windowLabel) =>
    query(
      `SELECT * FROM model_performance
       WHERE model_version = ? AND window_label = ?
       ORDER BY calculated_at DESC LIMIT 20`,
      [modelVersion, windowLabel]
    ),
};