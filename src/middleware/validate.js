import { ApiError } from '../utils/ApiError.js';

export function validate(schema, source = 'body') {
  return (req, res, next) => {
    const parsed = schema.safeParse(req[source]);
    if (!parsed.success) {
      return next(
        new ApiError(400, 'Validation failed', parsed.error.flatten())
      );
    }
    req[source] = parsed.data;
    next();
  };
}