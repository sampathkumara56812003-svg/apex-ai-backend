import cron from 'node-cron';
import { query } from '../config/database.js';
import logger from '../config/logger.js';
import { runScan, resolveActiveSignals } from '../services/signal.service.js';
import { settlePaperTrades } from '../services/paperTrade.service.js';
import { calculatePerformance } from '../services/performance.service.js';

let scanTimer, resolveTimer, settleTimer, perfTimer;

async function activeUsers() {
  return query('SELECT id FROM users WHERE is_active = 1');
}

export function startScheduler() {
  const scanMs = Number(process.env.SCAN_INTERVAL_MS || 90_000);
  const resolveMs = Number(process.env.RESOLVE_INTERVAL_MS || 45_000);
  const settleMs = Number(process.env.PAPER_SETTLE_INTERVAL_MS || 30_000);

  scanTimer = setInterval(async () => {
    try {
      const users = await activeUsers();
      for (const u of users) await runScan(u.id);
      logger.info('Scan complete');
    } catch (e) { logger.error('Scan failed', e); }
  }, scanMs);

  resolveTimer = setInterval(async () => {
    try {
      const users = await activeUsers();
      for (const u of users) await resolveActiveSignals(u.id);
    } catch (e) { logger.error('Resolve failed', e); }
  }, resolveMs);

  settleTimer = setInterval(async () => {
    try { await settlePaperTrades(); }
    catch (e) { logger.error('Paper settle failed', e); }
  }, settleMs);

  perfTimer = setInterval(async () => {
    try { await calculatePerformance(); }
    catch (e) { logger.error('Perf calc failed', e); }
  }, 300_000);

  // Daily cleanup
  cron.schedule('0 4 * * *', async () => {
    try {
      await query('DELETE FROM refresh_tokens WHERE expires_at < NOW() OR revoked = 1');
      logger.info('Cleanup done');
    } catch (e) { logger.error('Cleanup failed', e); }
  });

  logger.info('Scheduler started');
}

export function stopScheduler() {
  [scanTimer, resolveTimer, settleTimer, perfTimer].forEach((t) => t && clearInterval(t));
}