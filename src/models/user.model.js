import { query, queryOne } from '../config/database.js';

export const User = {
  findById: (id) =>
    queryOne('SELECT * FROM users WHERE id = ?', [id]),

  findByEmail: (email) =>
    queryOne('SELECT * FROM users WHERE email = ?', [email]),

  findByUsername: (username) =>
    queryOne('SELECT * FROM users WHERE username = ?', [username]),

  create: async ({ username, email, passwordHash, role = 'USER' }) => {
    const rows = await query(
      `INSERT INTO users (username, email, password_hash, role)
       VALUES (?, ?, ?, ?)`,
      [username, email, passwordHash, role]
    );
    return rows.insertId;
  },

  updateLastLogin: (id) =>
    query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [id]),

  list: () =>
    query('SELECT id, username, email, role, is_active, created_at FROM users'),
};