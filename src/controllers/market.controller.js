import * as intelligence from '../services/signal.service.js';
import { getSymbolSnapshot } from '../services/signal.service.js';
import * as binance from '../services/binance.service.js';
import * as synthetic from '../services/synthetic.service.js';
import { emaArr } from '../services/indicator.service.js';
import { ok } from '../utils/response.util.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { SYMBOLS } from '../config/constants.js';

const LIMITS = { '5m': 288, '15m': 260, '1h': 320, '4h': 260 };

export const overview = asyncHandler(async (req, res) => {
  const data = await intelligence.getMarketOverview();
  return ok(res, data);
});

export const snapshot = asyncHandler(async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  if (!SYMBOLS.includes(symbol)) throw new ApiError(404, 'Unknown symbol');
  const data = await getSymbolSnapshot(symbol);
  return ok(res, data);
});

export const chart = asyncHandler(async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  if (!SYMBOLS.includes(symbol)) throw new ApiError(404, 'Unknown symbol');

  const tfRaw = req.query.tf || '1h';
  const tf = LIMITS[tfRaw] ? tfRaw : '1h';

  let candles, source;
  try {
    const r = await binance.getKlines(symbol, tf, LIMITS[tf]);
    candles = r.candles;
    source = r.source;
  } catch {
    candles = synthetic.getSyntheticKlines(symbol, tf, LIMITS[tf]);
    source = 'SIMULATION';
  }

  const closes = candles.map((c) => c.close);
  const e20 = emaArr(closes, 20).map((v) => (Number.isNaN(v) ? null : v));
  const e50 = emaArr(closes, 50).map((v) => (Number.isNaN(v) ? null : v));

  return ok(res, { candles, ema20: e20, ema50: e50, source, tf });
});