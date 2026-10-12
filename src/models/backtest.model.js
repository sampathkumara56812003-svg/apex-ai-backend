import { query, queryOne, transaction } from '../config/database.js';

export const Backtest = {
  create: async (data) => {
    return transaction(async (conn) => {
      const [result] = await conn.execute(
        `INSERT INTO backtests
          (user_id, symbol, timeframe, bars, params, metrics, equity_curve,
           trades_count, data_source, model_version)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          data.userId ?? null, data.symbol, data.timeframe, data.bars,
          JSON.stringify(data.params), JSON.stringify(data.metrics),
          data.equityCurve ? JSON.stringify(data.equityCurve) : null,
          data.trades?.length ?? 0, data.dataSource, data.modelVersion,
        ]
      );
      const backtestId = result.insertId;

      if (data.trades && data.trades.length) {
        const values = data.trades.map((t) => [
          backtestId, t.entryTime, t.exitTime, t.side, t.entry, t.exit,
          t.pnlPct, t.pnlUsd ?? null, t.exitReason, t.probability ?? null,
        ]);
        const placeholders = values.map(() => '(?,?,?,?,?,?,?,?,?,?)').join(',');
        await conn.execute(
          `INSERT INTO backtest_trades
            (backtest_id, entry_time, exit_time, side, entry, exit_price,
             pnl_pct, pnl_usd, exit_reason, probability)
           VALUES ${placeholders}`,
          values.flat()
        );
      }
      return backtestId;
    });
  },

  findById: (id) => queryOne('SELECT * FROM backtests WHERE id = ?', [id]),

  list: (userId, limit = 20) =>
    query(
      `SELECT id, symbol, timeframe, bars, metrics, params, data_source, created_at
       FROM backtests WHERE user_id = ? OR user_id IS NULL
       ORDER BY created_at DESC LIMIT ?`,
      [userId, limit]
    ),

  findTrades: (backtestId) =>
    query(
      'SELECT * FROM backtest_trades WHERE backtest_id = ? ORDER BY entry_time',
      [backtestId]
    ),
};