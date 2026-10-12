import { Signal } from '../models/signal.model.js';
import { runScan, resolveActiveSignals } from '../services/signal.service.js';
import { ok, created } from '../utils/response.util.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/** MariaDB returns JSON columns as strings — parse them safely. */
function parseJson(v, fallback) {
  if (v == null) return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fallback; }
}

function normalizeSignal(s) {
  if (!s) return s;
  return {
    ...s,
    reasons:      parseJson(s.reasons, []),
    warnings:     parseJson(s.warnings, []),
    model_probs:  parseJson(s.model_probs, null),
    features:     parseJson(s.features, null),
  };
}

export const list = asyncHandler(async (req, res) => {
  await resolveActiveSignals(req.user.id).catch(() => {});
  const rows = await Signal.listAll(req.user.id, {
    status: req.query.status,
    symbol: req.query.symbol,
    direction: req.query.direction,
    limit: Number(req.query.limit || 100),
  });
  return ok(res, rows.map(normalizeSignal));
});

export const active = asyncHandler(async (req, res) => {
  await resolveActiveSignals(req.user.id).catch(() => {});
  const rows = await Signal.listActive(req.user.id);
  return ok(res, rows.map(normalizeSignal));
});

export const scan = asyncHandler(async (req, res) => {
  await runScan(req.user.id);
  const fresh = await Signal.listActive(req.user.id);
  return created(res, {
    signals: fresh.map(normalizeSignal),
    scannedAt: new Date(),
  });
});

export const detail = asyncHandler(async (req, res) => {
  const row = await Signal.findById(req.params.id);
  return ok(res, row ? normalizeSignal(row) : null);
});