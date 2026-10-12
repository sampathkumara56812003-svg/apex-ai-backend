import { query, queryOne } from '../config/database.js';
import { TRADING } from '../config/constants.js';

export const PaperAccount = {
  findByUser: (userId) =>
    queryOne('SELECT * FROM paper_account WHERE user_id = ?', [userId]),

  ensure: async (userId) => {
    const existing = await PaperAccount.findByUser(userId);
    if (existing) return existing;
    await query(
      `INSERT INTO paper_account (user_id, initial_balance, balance)
       VALUES (?, ?, ?)`,
      [userId, TRADING.initialPaperBalance, TRADING.initialPaperBalance]
    );
    return PaperAccount.findByUser(userId);
  },

  updateBalance: (userId, { balance, realizedPnl }) =>
    query(
      `UPDATE paper_account SET balance = ?, realized_pnl = ?, updated_at = NOW()
       WHERE user_id = ?`,
      [balance, realizedPnl, userId]
    ),

  reset: (userId) =>
    query(
      `UPDATE paper_account
       SET balance = initial_balance, realized_pnl = 0, updated_at = NOW()
       WHERE user_id = ?`,
      [userId]
    ),
};