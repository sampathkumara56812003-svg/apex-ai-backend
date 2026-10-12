import { query } from '../config/database.js';

export const Feature = {
  insert: (data) =>
    query(
      `INSERT INTO technical_features
        (symbol, timeframe, open_time, rsi, macd, macd_signal, macd_hist,
         ema20, ema50, ema200, atr, atr_pct, adx, plus_di, minus_di, vwap,
         bb_upper, bb_middle, bb_lower, bb_position, obv_slope, stoch_k,
         stoch_d, roc, volume_ratio, volatility_pct, support, resistance,
         structure, regime)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE rsi = VALUES(rsi), regime = VALUES(regime)`,
      [
        data.symbol, data.timeframe, data.openTime,
        data.rsi ?? null, data.macd ?? null, data.macdSignal ?? null,
        data.macdHist ?? null, data.ema20 ?? null, data.ema50 ?? null,
        data.ema200 ?? null, data.atr ?? null, data.atrPct ?? null,
        data.adx ?? null, data.plusDI ?? null, data.minusDI ?? null,
        data.vwap ?? null, data.bbUpper ?? null, data.bbMiddle ?? null,
        data.bbLower ?? null, data.bbPosition ?? null, data.obvSlope ?? null,
        data.stochK ?? null, data.stochD ?? null, data.roc ?? null,
        data.volumeRatio ?? null, data.volatilityPct ?? null,
        data.support ?? null, data.resistance ?? null,
        data.structure ?? null, data.regime ?? null,
      ]
    ),
};