import * as authService from '../services/auth.service.js';
import { ok, created } from '../utils/response.util.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const register = asyncHandler(async (req, res) => {
  const user = await authService.register(req.body);
  return created(res, user);
});

export const login = asyncHandler(async (req, res) => {
  const result = await authService.login({
    ...req.body,
    userAgent: req.headers['user-agent'],
    ip: req.ip,
  });
  return ok(res, result);
});

export const refresh = asyncHandler(async (req, res) => {
  const result = await authService.refresh(req.body.refreshToken);
  return ok(res, result);
});

export const logout = asyncHandler(async (req, res) => {
  await authService.logout(req.body.refreshToken);
  return ok(res, { message: 'Logged out' });
});

export const me = asyncHandler(async (req, res) => {
  return ok(res, req.user);
});