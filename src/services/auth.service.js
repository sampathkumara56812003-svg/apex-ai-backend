import { v4 as uuid } from 'uuid';
import { query, queryOne, transaction } from '../config/database.js';
import { User } from '../models/user.model.js';
import { RefreshToken } from '../models/refreshToken.model.js';
import { hashPassword, verifyPassword } from '../utils/bcrypt.util.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/jwt.util.js';
import { ApiError } from '../utils/ApiError.js';
import { TRADING } from '../config/constants.js';

export async function register({ username, email, password }) {
  const existing = await queryOne(
    'SELECT id FROM users WHERE email = ? OR username = ? LIMIT 1',
    [email, username]
  );
  if (existing) throw new ApiError(409, 'Username or email already exists');

  const passwordHash = await hashPassword(password);

  return transaction(async (conn) => {
    const [result] = await conn.execute(
      `INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)`,
      [username, email, passwordHash]
    );
    const userId = result.insertId;

    await conn.execute(
      `INSERT INTO paper_account (user_id, initial_balance, balance) VALUES (?, ?, ?)`,
      [userId, TRADING.initialPaperBalance, TRADING.initialPaperBalance]
    );
    await conn.execute(
      `INSERT INTO user_settings (user_id, settings) VALUES (?, JSON_OBJECT())`,
      [userId]
    );

    return { id: userId, username, email };
  });
}

export async function login({ email, password, userAgent, ip }) {
  const user = await User.findByEmail(email);
  if (!user || !user.is_active) throw new ApiError(401, 'Invalid credentials');

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) throw new ApiError(401, 'Invalid credentials');

  const accessToken = signAccessToken({ sub: user.id, role: user.role });
  const refreshToken = signRefreshToken({ sub: user.id, jti: uuid() });

  const expiresAt = new Date(Date.now() + 7 * 86_400_000);
  await RefreshToken.create({
    userId: user.id,
    token: refreshToken,
    expiresAt,
    userAgent,
    ip,
  });

  await User.updateLastLogin(user.id);

  return {
    user: { id: user.id, username: user.username, email: user.email, role: user.role },
    accessToken,
    refreshToken,
  };
}

export async function refresh(token) {
  try {
    verifyRefreshToken(token);
  } catch {
    throw new ApiError(401, 'Invalid refresh token');
  }

  const row = await RefreshToken.findValid(token);
  if (!row) throw new ApiError(401, 'Refresh token expired or revoked');

  const user = await queryOne('SELECT id, role FROM users WHERE id = ?', [row.user_id]);
  if (!user) throw new ApiError(401, 'User not found');

  return { accessToken: signAccessToken({ sub: user.id, role: user.role }) };
}

export async function logout(token) {
  await RefreshToken.revoke(token);
}