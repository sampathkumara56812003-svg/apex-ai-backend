import { Ohlcv } from '../models/ohlcv.model.js';
import * as binance from '../services/binance.service.js';
import { SYMBOLS, TIMEFRAMES } from '../config/constants.js';
import logger from '../config/logger.js';

export async function collectMarketData() {
  for (const symbol of SYMBOLS) {
    for (const tf of TIMEFRAMES) {
      try {
        const { candles, source } = await binance.getKlines(symbol, tf, 500);
        await Ohlcv.bulkInsert(
          candles.map((c) => ({
            symbol, timeframe: tf, openTime: c.time,
            open: c.open, high: c.high, low: c.low, close: c.close,
            volume: c.volume, source,
          }))
        );
      } catch (e) {
        logger.warn(`Collect failed ${symbol} ${tf}: ${e.message}`);
      }
    }
  }
  logger.info('Market data collection complete');
}