import { Router } from 'express';
import * as ctrl from '../controllers/market.controller.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/overview', ctrl.overview);
router.get('/:symbol', ctrl.snapshot);
router.get('/:symbol/chart', ctrl.chart);

export default router;