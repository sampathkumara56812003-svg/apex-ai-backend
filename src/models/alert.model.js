import { query } from '../config/database.js';

export const Alert = {
  list: (userId) =>
    query('SELECT * FROM alerts WHERE user_id = ? ORDER BY created_at DESC', [userId]),

  create: (data) =>
    query(
      `INSERT INTO alerts (user_id, symbol, alert_type, condition_json, channel)
       VALUES (?,?,?,?,?)`,
      [data.userId, data.symbol ?? null, data.alertType,
       JSON.stringify(data.condition), data.channel]
    ),

  setActive: (id, userId, active) =>
    query(
      'UPDATE alerts SET is_active = ? WHERE id = ? AND user_id = ?',
      [active ? 1 : 0, id, userId]
    ),

  delete: (id, userId) =>
    query('DELETE FROM alerts WHERE id = ? AND user_id = ?', [id, userId]),
};