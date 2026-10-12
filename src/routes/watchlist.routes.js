import { Router } from 'express';
import * as ctrl from '../controllers/watchlist.controller.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', ctrl.list);
router.post('/', ctrl.add);
router.delete('/:symbol', ctrl.remove);

export default router;