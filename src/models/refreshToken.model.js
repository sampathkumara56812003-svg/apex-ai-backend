import { query, queryOne } from '../config/database.js';

export const RefreshToken = {
  create: ({ userId, token, userAgent, ip, expiresAt }) =>
    query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at, user_agent, ip_address)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, token, expiresAt, userAgent ?? null, ip ?? null]
    ),

  findValid: (token) =>
    queryOne(
      `SELECT * FROM refresh_tokens
       WHERE token = ? AND revoked = 0 AND expires_at > NOW()
       LIMIT 1`,
      [token]
    ),

  revoke: (token) =>
    query('UPDATE refresh_tokens SET revoked = 1 WHERE token = ?', [token]),

  revokeAllForUser: (userId) =>
    query('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?', [userId]),

  cleanup: () =>
    query('DELETE FROM refresh_tokens WHERE expires_at < NOW() OR revoked = 1'),
};