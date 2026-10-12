import { Alert } from '../models/alert.model.js';
import { ok, created } from '../utils/response.util.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const list = asyncHandler(async (req, res) => {
  const rows = await Alert.list(req.user.id);
  return ok(res, rows);
});

export const create = asyncHandler(async (req, res) => {
  await Alert.create({ userId: req.user.id, ...req.body });
  return created(res, req.body);
});

export const toggle = asyncHandler(async (req, res) => {
  await Alert.setActive(req.params.id, req.user.id, req.body.active);
  return ok(res, { id: req.params.id, active: req.body.active });
});

export const remove = asyncHandler(async (req, res) => {
  await Alert.delete(req.params.id, req.user.id);
  return ok(res, { removed: req.params.id });
});