import dotenv from 'dotenv';
dotenv.config();

import app from './src/app.js';
import { initWebSocketServer } from './src/websocket/wsServer.js';
import { initBinanceStream, stopBinanceStream } from './src/websocket/binanceStream.js';
import { startScheduler } from './src/jobs/scheduler.js';
import { testConnection } from './src/config/database.js';
import logger from './src/config/logger.js';

const PORT = Number(process.env.PORT || 5000);

async function bootstrap() {
  try {
    await testConnection();
    logger.info('Database connected');

    const server = app.listen(PORT, () => {
      logger.info(`API listening on http://localhost:${PORT}`);
    });

    // Local WS server must be initialized first — binanceStream broadcasts into it
    initWebSocketServer(server);
    initBinanceStream();
    startScheduler();

    const shutdown = () => {
      logger.info('Shutting down');
      stopBinanceStream();
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 5000).unref();
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (err) {
    logger.error('Bootstrap failed', err);
    process.exit(1);
  }
}

bootstrap();