import { Router } from 'express';
import authRoutes from './auth.routes.js';
import marketRoutes from './market.routes.js';
import signalRoutes from './signal.routes.js';
import backtestRoutes from './backtest.routes.js';
import paperTradeRoutes from './paperTrade.routes.js';
import performanceRoutes from './performance.routes.js';
import watchlistRoutes from './watchlist.routes.js';
import alertRoutes from './alert.routes.js';
import userRoutes from './user.routes.js';
import adminRoutes from './admin.routes.js';

const router = Router();

router.get('/health', (req, res) =>
  res.json({ ok: true, status: 'healthy', time: new Date() })
);

router.use('/auth', authRoutes);
router.use('/market', marketRoutes);
router.use('/signals', signalRoutes);
router.use('/backtest', backtestRoutes);
router.use('/paper', paperTradeRoutes);
router.use('/performance', performanceRoutes);
router.use('/watchlist', watchlistRoutes);
router.use('/alerts', alertRoutes);
router.use('/user', userRoutes);
router.use('/admin', adminRoutes);

export default router;