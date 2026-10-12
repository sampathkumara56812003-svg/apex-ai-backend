import logger from '../config/logger.js';
import { ApiError } from '../utils/ApiError.js';

export function errorHandler(err, req, res, _next) {
  const status = err instanceof ApiError ? err.status : err.status || 500;
  const message = err.message || 'Internal server error';

  if (status >= 500) logger.error(message, err);

  res.status(status).json({
    ok: false,
    error: message,
    details: err.details || null,
  });
}