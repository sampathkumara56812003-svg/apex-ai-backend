import { Router } from 'express';
import * as ctrl from '../controllers/admin.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.post('/reseed', ctrl.reseed);
router.get('/stats', requireRole('ADMIN'), ctrl.stats);

export default router;