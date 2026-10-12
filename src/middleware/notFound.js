export function notFound(req, res) {
  res.status(404).json({
    ok: false,
    error: `Route ${req.method} ${req.originalUrl} not found`,
  });
}