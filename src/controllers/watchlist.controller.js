import { Watchlist } from '../models/watchlist.model.js';
import { ok, created } from '../utils/response.util.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const list = asyncHandler(async (req, res) => {
  const rows = await Watchlist.list(req.user.id);
  return ok(res, rows);
});

export const add = asyncHandler(async (req, res) => {
  await Watchlist.add(req.user.id, req.body.symbol);
  return created(res, { symbol: req.body.symbol });
});

export const remove = asyncHandler(async (req, res) => {
  await Watchlist.remove(req.user.id, req.params.symbol);
  return ok(res, { removed: req.params.symbol });
});