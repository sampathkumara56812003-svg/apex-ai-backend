import { query } from '../config/database.js';

export const Ohlcv = {
  bulkInsert: async (rows) => {
    if (!rows.length) return;
    const values = rows.map((r) => [
      r.symbol, r.timeframe, r.openTime,
      r.open, r.high, r.low, r.close, r.volume,
      r.quoteVol ?? null, r.trades ?? null, r.source ?? 'BINANCE',
    ]);
    const placeholders = values.map(() => '(?,?,?,?,?,?,?,?,?,?,?)').join(',');
    return query(
      `INSERT IGNORE INTO ohlcv
       (symbol, timeframe, open_time, open, high, low, close, volume, quote_vol, trades, source)
       VALUES ${placeholders}`,
      values.flat()
    );
  },

  latest: (symbol, timeframe, limit = 500) =>
    query(
      `SELECT open_time AS time, open, high, low, close, volume
       FROM ohlcv WHERE symbol = ? AND timeframe = ?
       ORDER BY open_time DESC LIMIT ?`,
      [symbol, timeframe, limit]
    ),

  range: (symbol, timeframe, from, to) =>
    query(
      `SELECT open_time AS time, open, high, low, close, volume
       FROM ohlcv WHERE symbol = ? AND timeframe = ?
         AND open_time >= ? AND open_time <= ?
       ORDER BY open_time ASC`,
      [symbol, timeframe, from, to]
    ),
};