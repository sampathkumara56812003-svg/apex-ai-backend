import { Router } from 'express';
import * as ctrl from '../controllers/signal.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { heavyLimiter } from '../middleware/rateLimiter.js';

const router = Router();
router.use(requireAuth);

router.get('/', ctrl.list);
router.get('/active', ctrl.active);
router.post('/scan', heavyLimiter, ctrl.scan);
router.get('/:id', ctrl.detail);

export default router;