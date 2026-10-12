// backend/src/controllers/backtest.controller.js

import { runBacktest, persistBacktest } from '../services/backtest.service.js';
import { Backtest } from '../models/backtest.model.js';
import * as binance from '../services/binance.service.js';
import * as synthetic from '../services/synthetic.service.js';
import { ok, created } from '../utils/response.util.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { SYMBOLS, SIGNAL_POLICY, MODEL_VERSION } from '../config/constants.js';
import logger from '../config/logger.js';

/* =====================================================================
 * Data loader — real Binance first, synthetic fallback if unreachable.
 * The backtester itself will refuse synthetic signals via the policy.
 * ===================================================================== */
async function loadCandles(symbol, timeframe, bars) {
  try {
    const r = await binance.getKlines(symbol, timeframe, bars);
    return { candles: r.candles, source: r.source };
  } catch (err) {
    logger.warn(`Backtest data fetch failed [${symbol} ${timeframe}]: ${err.message}`);
    return {
      candles: synthetic.getSyntheticKlines(symbol, timeframe, bars),
      source: 'SIMULATION',
    };
  }
}

/* =====================================================================
 * GET /api/backtest
 * Lists the most recent stored backtest runs for the current user.
 * ===================================================================== */
export const list = asyncHandler(async (req, res) => {
  const rows = await Backtest.list(req.user.id, 20);
  return ok(res, rows);
});

/* =====================================================================
 * GET /api/backtest/:id
 * Returns one stored backtest + its trades.
 * ===================================================================== */
export const detail = asyncHandler(async (req, res) => {
  const id = req.params.id;
  const row = await Backtest.findById(id);
  if (!row) throw new ApiError(404, 'Backtest not found');
  const trades = await Backtest.findTrades(row.id);
  return ok(res, { backtest: row, trades });
});

/* =====================================================================
 * POST /api/backtest
 * Body:
 *   {
 *     symbol,        // BTCUSDT | ETHUSDT | SOLUSDT | BNBUSDT
 *     timeframe,     // 5m | 15m | 1h | 4h
 *     bars,          // 300..1000
 *     minProbability,
 *     tpMult,
 *     slAtrMult,
 *     applyPolicy    // optional — defaults to true
 *   }
 * ===================================================================== */
export const run = asyncHandler(async (req, res) => {
  const body = req.body || {};

  /* ------------------------------- inputs ------------------------------- */
  const symbol = SYMBOLS.includes(body.symbol) ? body.symbol : 'BTCUSDT';

  const timeframe = ['5m', '15m', '1h', '4h'].includes(body.timeframe)
    ? body.timeframe
    : '4h';

  const bars = Math.min(Math.max(Number(body.bars ?? 500), 300), 1000);

  const minProbability = Math.min(
    Math.max(Number(body.minProbability ?? 0.65), 0.5),
    0.95
  );

  const tpMult = Math.min(Math.max(Number(body.tpMult ?? 1.6), 1), 4);
  const slAtrMult = Math.min(Math.max(Number(body.slAtrMult ?? 1.15), 0.6), 3);

  const applyPolicy = body.applyPolicy !== false; // default true

  /* -------------------- policy pre-check (early exit) -------------------- */
  if (applyPolicy) {
    if (!SIGNAL_POLICY.allowedTimeframes.includes(timeframe)) {
      return ok(res, {
        skipped: true,
        reason: `Timeframe ${timeframe} is not tradable under the current policy`,
        policy: {
          allowedTimeframes: SIGNAL_POLICY.allowedTimeframes,
          allowedSymbols: SIGNAL_POLICY.allowedSymbols,
          minProbability: SIGNAL_POLICY.minProbability,
        },
      });
    }
    if (!SIGNAL_POLICY.allowedSymbols.includes(symbol)) {
      return ok(res, {
        skipped: true,
        reason: `Symbol ${symbol} is not tradable under the current policy`,
        policy: {
          allowedTimeframes: SIGNAL_POLICY.allowedTimeframes,
          allowedSymbols: SIGNAL_POLICY.allowedSymbols,
          minProbability: SIGNAL_POLICY.minProbability,
        },
      });
    }
  }

  /* ------------------------------- load data ---------------------------- */
  const { candles, source } = await loadCandles(symbol, timeframe, bars);

  if (!candles || candles.length < 250) {
    throw new ApiError(400, `Insufficient historical data (${candles?.length ?? 0} bars)`);
  }

  /* ---------------------------- run backtest ---------------------------- */
  const result = runBacktest({
    symbol,
    timeframe,
    candles,
    minProbability,
    tpMult,
    slAtrMult,
    step: timeframe === '5m' ? 6 : 4,
    applyPolicy,
  });

  /* ------------------------------ persist ------------------------------- */
  const id = await persistBacktest(req.user.id, result, {
    symbol,
    timeframe,
    bars: candles.length,
    minProbability,
    tpMult,
    slAtrMult,
    dataSource: source,
    applyPolicy,
  });

  /* ------------------------------ respond ------------------------------- */
  return created(res, {
    backtestId: id,
    symbol,
    timeframe,
    bars: candles.length,
    source,
    applyPolicy,
    policy: {
      allowedTimeframes: SIGNAL_POLICY.allowedTimeframes,
      allowedSymbols: SIGNAL_POLICY.allowedSymbols,
      minProbability: SIGNAL_POLICY.minProbability,
      strongProbability: SIGNAL_POLICY.strongProbability,
    },
    metrics: result.metrics,
    trades: result.trades.slice(-100),
    equityCurve: result.equityCurve,
    modelVersion: MODEL_VERSION,
  });
});

/* =====================================================================
 * GET /api/backtest/policy
 * Convenience endpoint — returns the current signal policy so the
 * frontend can display which combos are allowed.
 * ===================================================================== */
export const policy = asyncHandler(async (_req, res) => {
  return ok(res, {
    allowedTimeframes: SIGNAL_POLICY.allowedTimeframes,
    allowedSymbols: SIGNAL_POLICY.allowedSymbols,
    minProbability: SIGNAL_POLICY.minProbability,
    strongProbability: SIGNAL_POLICY.strongProbability,
    allowSyntheticSignals: SIGNAL_POLICY.allowSyntheticSignals,
  });
});