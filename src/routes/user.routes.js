import { Router } from 'express';
import * as ctrl from '../controllers/user.controller.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/settings', ctrl.getSettings);
router.put('/settings', ctrl.updateSettings);

export default router;