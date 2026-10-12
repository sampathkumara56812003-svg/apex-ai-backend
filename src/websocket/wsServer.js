import { WebSocketServer } from 'ws';
import { verifyAccessToken } from '../utils/jwt.util.js';
import { getBinanceStreamStatus } from './binanceStream.js';
import logger from '../config/logger.js';

let wss;

export function initWebSocketServer(httpServer) {
  wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    try {
      ws.user = verifyAccessToken(token);
    } catch {
      ws.close(1008, 'Invalid token');
      return;
    }

    ws.subscriptions = new Set();
    ws.isAlive = true;

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => {
      try {
        const p = JSON.parse(raw.toString());
        if (p.action === 'subscribe' && p.channel) {
          ws.subscriptions.add(p.channel);
          // Auto-respond with current status for status-type channels
          if (p.channel === 'feed') {
            ws.send(JSON.stringify({
              type: 'update',
              channel: 'feed',
              data: getBinanceStreamStatus(),
              ts: Date.now(),
            }));
          }
        }
        if (p.action === 'unsubscribe' && p.channel) {
          ws.subscriptions.delete(p.channel);
        }
      } catch { /* ignore malformed */ }
    });

    ws.on('error', (err) => logger.warn('Local WS error', err.message));

    ws.send(JSON.stringify({
      type: 'connected',
      feed: getBinanceStreamStatus(),
      ts: Date.now(),
    }));
  });

  // Kill dead sockets
  const aliveTimer = setInterval(() => {
    for (const client of wss.clients) {
      if (client.isAlive === false) { client.terminate(); continue; }
      client.isAlive = false;
      try { client.ping(); } catch { /* ignore */ }
    }
  }, 30_000);

  wss.on('close', () => clearInterval(aliveTimer));

  logger.info('WebSocket server ready at /ws');
}

export function broadcast(channel, data) {
  if (!wss) return;
  const msg = JSON.stringify({ type: 'update', channel, data, ts: Date.now() });
  for (const client of wss.clients) {
    if (client.readyState === 1 && client.subscriptions?.has(channel)) {
      client.send(msg);
    }
  }
}