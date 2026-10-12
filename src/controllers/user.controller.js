import { queryOne, query } from '../config/database.js';
import { ok } from '../utils/response.util.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const getSettings = asyncHandler(async (req, res) => {
  const row = await queryOne('SELECT settings FROM user_settings WHERE user_id = ?', [req.user.id]);
  return ok(res, row?.settings ?? {});
});

export const updateSettings = asyncHandler(async (req, res) => {
  await query(
    `INSERT INTO user_settings (user_id, settings) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE settings = VALUES(settings)`,
    [req.user.id, JSON.stringify(req.body)]
  );
  return ok(res, req.body);
});