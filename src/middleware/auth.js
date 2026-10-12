import { verifyAccessToken } from '../utils/jwt.util.js';
import { ApiError } from '../utils/ApiError.js';
import { queryOne } from '../config/database.js';

export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new ApiError(401, 'Missing authorization token');

    const payload = verifyAccessToken(token);
    const user = await queryOne(
      'SELECT id, username, email, role, is_active FROM users WHERE id = ?',
      [payload.sub]
    );
    if (!user || !user.is_active)
      throw new ApiError(401, 'User not found or inactive');

    req.user = user;
    next();
  } catch (err) {
    next(err instanceof ApiError ? err : new ApiError(401, 'Invalid or expired token'));
  }
}

export function requireRole(role) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== role) {
      return next(new ApiError(403, 'Insufficient permissions'));
    }
    next();
  };
}

export function optionalAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next();
  try {
    req.user = verifyAccessToken(token);
  } catch {
    /* ignore */
  }
  next();
}