import { getPerformance } from '../services/performance.service.js';
import { ok } from '../utils/response.util.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const report = asyncHandler(async (req, res) => {
  const data = await getPerformance(req.user.id);
  return ok(res, data);
});