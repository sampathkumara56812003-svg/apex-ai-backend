import { Router } from 'express';
import * as ctrl from '../controllers/performance.controller.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);
router.get('/', ctrl.report);
export default router;