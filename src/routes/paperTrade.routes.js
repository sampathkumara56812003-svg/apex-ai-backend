import { Router } from 'express';
import * as ctrl from '../controllers/paperTrade.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { openTradeSchema } from '../validators/paperTrade.validator.js';

const router = Router();
router.use(requireAuth);

router.get('/', ctrl.getDesk);
router.post('/', validate(openTradeSchema), ctrl.open);
router.post('/:id/close', ctrl.close);
router.post('/reset', ctrl.reset);

export default router;