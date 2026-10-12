export const ok = (res, data, meta = undefined) =>
  res.json({ ok: true, data, ...(meta ? { meta } : {}) });

export const created = (res, data) =>
  res.status(201).json({ ok: true, data });

export const noContent = (res) => res.status(204).end();

export const fail = (res, status, message, details = null) =>
  res.status(status).json({ ok: false, error: message, details });