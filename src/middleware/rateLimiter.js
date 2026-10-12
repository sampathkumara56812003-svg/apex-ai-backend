import rateLimit from 'express-rate-limit';

export const globalLimiter = rateLimit({
  windowMs: 60_000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many requests' },
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 20,
  message: { ok: false, error: 'Too many auth attempts, try again later' },
});

export const heavyLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  message: { ok: false, error: 'Rate limit exceeded for heavy operations' },
});