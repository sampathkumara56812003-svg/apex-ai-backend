import { query } from '../config/database.js';
import { ok } from '../utils/response.util.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { SYMBOLS } from '../config/constants.js';

export const reseed = asyncHandler(async (req, res) => {
  await query('DELETE FROM signals WHERE user_id = ?', [req.user.id]);
  await query('DELETE FROM paper_trades WHERE user_id = ?', [req.user.id]);
  await query('UPDATE paper_account SET balance = initial_balance, realized_pnl = 0 WHERE user_id = ?', [req.user.id]);
  await query('DELETE FROM backtests WHERE user_id = ?', [req.user.id]);
  return ok(res, { reseededAt: new Date(), symbols: SYMBOLS });
});

export const stats = asyncHandler(async (req, res) => {
  const [{ n: signals }] = await query('SELECT COUNT(*) AS n FROM signals');
  const [{ n: users }] = await query('SELECT COUNT(*) AS n FROM users');
  const [{ n: trades }] = await query('SELECT COUNT(*) AS n FROM paper_trades');
  return ok(res, { signals, users, trades });
});