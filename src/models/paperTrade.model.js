import { query, queryOne } from '../config/database.js';

export const PaperTrade = {
  insert: async (data) => {
    const result = await query(
      `INSERT INTO paper_trades
        (user_id, signal_id, symbol, side, entry, quantity, notional, tp, sl,
         fees, status)
       VALUES (?,?,?,?,?,?,?,?,?,?, 'OPEN')`,
      [
        data.userId, data.signalId ?? null, data.symbol, data.side,
        data.entry, data.quantity, data.notional, data.tp ?? null,
        data.sl ?? null, data.fees,
      ]
    );
    return result.insertId;
  },

  findOpen: (userId) =>
    query(
      "SELECT * FROM paper_trades WHERE user_id = ? AND status = 'OPEN' ORDER BY opened_at DESC",
      [userId]
    ),

  findAllOpen: () =>
    query("SELECT * FROM paper_trades WHERE status = 'OPEN'"),

  findClosed: (userId, limit = 100) =>
    query(
      `SELECT * FROM paper_trades WHERE user_id = ? AND status = 'CLOSED'
       ORDER BY closed_at DESC LIMIT ?`,
      [userId, limit]
    ),

  findById: (id) => queryOne('SELECT * FROM paper_trades WHERE id = ?', [id]),

  close: (id, { exitPrice, pnl, pnlPct, reason, fees }) =>
    query(
      `UPDATE paper_trades
       SET exit_price = ?, pnl = ?, pnl_pct = ?, close_reason = ?,
           fees = ?, status = 'CLOSED', closed_at = NOW()
       WHERE id = ?`,
      [exitPrice, pnl, pnlPct, reason, fees, id]
    ),

  countOpen: (userId) =>
    query(
      "SELECT COUNT(*) AS n FROM paper_trades WHERE user_id = ? AND status = 'OPEN'",
      [userId]
    ),

  deleteAllForUser: (userId) =>
    query('DELETE FROM paper_trades WHERE user_id = ?', [userId]),
};