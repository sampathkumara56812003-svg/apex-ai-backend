import * as paper from '../services/paperTrade.service.js';
import { ok, created } from '../utils/response.util.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { SYMBOLS } from '../config/constants.js';
import { ApiError } from '../utils/ApiError.js';

export const getDesk = asyncHandler(async (req, res) => {
  const data = await paper.getDesk(req.user.id);
  return ok(res, data);
});

export const open = asyncHandler(async (req, res) => {
  const { symbol, side } = req.body;
  if (!SYMBOLS.includes(symbol)) throw new ApiError(400, 'Unknown symbol');
  if (side !== 'LONG' && side !== 'SHORT') throw new ApiError(400, 'side must be LONG or SHORT');
  const trade = await paper.openPaperTrade(req.user.id, req.body);
  return created(res, { trade });
});

export const close = asyncHandler(async (req, res) => {
  const result = await paper.closePaperTrade(req.user.id, req.params.id, 'MANUAL');
  return ok(res, result);
});

export const reset = asyncHandler(async (req, res) => {
  const result = await paper.resetAccount(req.user.id);
  return ok(res, result);
});