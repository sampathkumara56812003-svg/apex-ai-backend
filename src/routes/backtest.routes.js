import { Router } from 'express';
import * as ctrl from '../controllers/backtest.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { heavyLimiter } from '../middleware/rateLimiter.js';
import { validate } from '../middleware/validate.js';
import { backtestSchema } from '../validators/backtest.validator.js';

const router = Router();
router.use(requireAuth);

router.get('/', ctrl.list);
router.post('/', heavyLimiter, validate(backtestSchema), ctrl.run);
router.get('/policy', ctrl.policy);
router.get('/:id', ctrl.detail);

export default router;