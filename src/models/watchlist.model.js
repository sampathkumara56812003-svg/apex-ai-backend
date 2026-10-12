import { query, queryOne } from '../config/database.js';

export const Watchlist = {
  list: (userId) =>
    query('SELECT * FROM watchlist WHERE user_id = ? ORDER BY sort_order', [userId]),

  add: (userId, symbol) =>
    query(
      'INSERT IGNORE INTO watchlist (user_id, symbol) VALUES (?, ?)',
      [userId, symbol]
    ),

  remove: (userId, symbol) =>
    query('DELETE FROM watchlist WHERE user_id = ? AND symbol = ?', [userId, symbol]),

  exists: (userId, symbol) =>
    queryOne('SELECT id FROM watchlist WHERE user_id = ? AND symbol = ?', [userId, symbol]),
};