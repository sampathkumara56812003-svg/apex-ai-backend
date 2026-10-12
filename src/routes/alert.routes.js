import { Router } from 'express';
import * as ctrl from '../controllers/alert.controller.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.patch('/:id', ctrl.toggle);
router.delete('/:id', ctrl.remove);

export default router;