import WebSocket from 'ws';
import logger from '../config/logger.js';
import { broadcast } from './wsServer.js';
import { CHANNELS } from './channels.js';
import { SYMBOLS } from '../config/constants.js';

/* =====================================================================
 * Binance Public WebSocket Bridge
 * ----------------------------------------------------------------
 * Streams subscribed (per symbol):
 *   - <symbol>@ticker          24h rolling ticker      ~1000ms
 *   - <symbol>@kline_1m        1-minute klines         ~2000ms
 *   - <symbol>@kline_5m        5-minute klines         ~2000ms
 *   - <symbol>@depth20@100ms   top-20 partial book     100ms
 *
 * Public spot stream endpoints (no API key required):
 *   wss://stream.binance.com:9443  (has rate limits)
 *   wss://data-stream.binance.vision  (market-data only, preferred)
 *
 * Binance force-closes connections after 24h. We proactively rotate at
 * 23h to avoid a race. On any error/close we reconnect with exponential
 * backoff capped at 30s.
 * ===================================================================== */

const BINANCE_WS_BASE =
  process.env.BINANCE_WS_BASE || 'wss://data-stream.binance.vision';

const STREAMS_PER_SYMBOL = ['@ticker', '@kline_1m', '@kline_5m', '@depth20@100ms'];

const ROTATE_MS = 23 * 60 * 60 * 1000; // reconnect before Binance's 24h cutoff
const MAX_BACKOFF_MS = 30_000;
const HEARTBEAT_MS = 30_000; // watchdog: if no data for this long, force reconnect

let ws = null;
let reconnectAttempts = 0;
let reconnectTimer = null;
let rotateTimer = null;
let heartbeatTimer = null;
let lastMessageAt = 0;
let shuttingDown = false;

/* ------------------------- subscription URL builder ------------------------- */

function buildStreamUrl() {
  const streams = [];
  for (const sym of SYMBOLS) {
    const lower = sym.toLowerCase();
    for (const suffix of STREAMS_PER_SYMBOL) {
      streams.push(`${lower}${suffix}`);
    }
  }
  return `${BINANCE_WS_BASE}/stream?streams=${streams.join('/')}`;
}

/* -------------------------------- parsers --------------------------------- */

function parseTicker(symbol, d) {
  return {
    symbol,
    price: Number(d.c),
    change24h: Number(d.P),
    changeAbs24h: Number(d.p),
    high24h: Number(d.h),
    low24h: Number(d.l),
    open24h: Number(d.o),
    volume24h: Number(d.v),
    quoteVolume24h: Number(d.q),
    trades24h: Number(d.n),
    eventTime: d.E,
  };
}

function parseKline(symbol, k) {
  return {
    symbol,
    timeframe: k.i,
    time: Math.floor(k.t / 1000),
    closeTime: Math.floor(k.T / 1000),
    open: Number(k.o),
    high: Number(k.h),
    low: Number(k.l),
    close: Number(k.c),
    volume: Number(k.v),
    quoteVolume: Number(k.q),
    trades: Number(k.n),
    isClosed: Boolean(k.x),
    eventTime: k.T,
  };
}

function parseDepth(symbol, d) {
  const bids = (d.bids || []).map(([p, a]) => ({
    price: Number(p),
    amount: Number(a),
  }));
  const asks = (d.asks || []).map(([p, a]) => ({
    price: Number(p),
    amount: Number(a),
  }));
  const bidVolume = bids.reduce((s, b) => s + b.amount, 0);
  const askVolume = asks.reduce((s, a) => s + a.amount, 0);
  const bestBid = bids[0]?.price ?? 0;
  const bestAsk = asks[0]?.price ?? 0;
  const mid = (bestBid + bestAsk) / 2;

  return {
    symbol,
    bids,
    asks,
    bidVolume,
    askVolume,
    imbalance: bidVolume / Math.max(bidVolume + askVolume, 1e-9),
    spreadPct: mid > 0 ? ((bestAsk - bestBid) / mid) * 100 : 0,
    eventTime: Date.now(),
  };
}

/* ----------------------------- dispatch ----------------------------------- */

function handleMessage(raw) {
  lastMessageAt = Date.now();

  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }

  // Combined-stream format: { stream, data }
  const stream = msg.stream;
  const data = msg.data;
  if (!stream || !data) return;

  const [streamName] = stream.split('@');
  const symbol = streamName.toUpperCase();

  // Ticker
  if (stream.endsWith('@ticker')) {
    if (data.e !== '24hrTicker') return;
    const payload = parseTicker(symbol, data);
    broadcast(CHANNELS.PRICE, payload);
    broadcast(`price:${symbol}`, payload);
    return;
  }

  // Kline
  if (stream.includes('@kline_')) {
    if (data.e !== 'kline') return;
    const payload = parseKline(symbol, data.k);
    broadcast(`kline:${payload.timeframe}:${symbol}`, payload);
    broadcast(CHANNELS.PRICE, {
      symbol,
      price: payload.close,
      change24h: null,
      source: 'binance-ws-kline',
      eventTime: payload.eventTime,
    });
    return;
  }

  // Partial depth
  if (stream.includes('@depth')) {
    if (!data.bids || !data.asks) return;
    const payload = parseDepth(symbol, data);
    broadcast(`depth:${symbol}`, payload);
    return;
  }
}

/* ---------------------------- lifecycle ----------------------------------- */

function clearTimers() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (rotateTimer)    { clearTimeout(rotateTimer);    rotateTimer = null; }
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
}

function scheduleReconnect(reason) {
  if (shuttingDown) return;
  clearTimers();

  const delay = Math.min(
    1000 * 2 ** reconnectAttempts + Math.random() * 500,
    MAX_BACKOFF_MS
  );
  reconnectAttempts++;
  logger.warn(`Binance WS reconnect in ${Math.round(delay)}ms (${reason})`);

  reconnectTimer = setTimeout(() => {
    connect();
  }, delay);
}

function startHeartbeatWatchdog() {
  lastMessageAt = Date.now();
  heartbeatTimer = setInterval(() => {
    if (Date.now() - lastMessageAt > HEARTBEAT_MS) {
      logger.warn('Binance WS silent for >30s — forcing reconnect');
      try { ws?.terminate(); } catch { /* ignore */ }
    }
  }, HEARTBEAT_MS);
}

function connect() {
  if (shuttingDown) return;

  const url = buildStreamUrl();
  logger.info(`Binance WS connecting… (${SYMBOLS.length} symbols, ${STREAMS_PER_SYMBOL.length} streams each)`);

  try {
    ws = new WebSocket(url, {
      handshakeTimeout: 10_000,
      perMessageDeflate: false,
    });
  } catch (err) {
    scheduleReconnect(`construct-failed: ${err.message}`);
    return;
  }

  ws.on('open', () => {
    logger.info('Binance WS connected');
    reconnectAttempts = 0;
    startHeartbeatWatchdog();

    // Rotate before Binance's 24h hard cutoff
    rotateTimer = setTimeout(() => {
      logger.info('Binance WS 23h rotation — reconnecting');
      try { ws.close(1000, 'rotate'); } catch { /* ignore */ }
    }, ROTATE_MS);

    // Notify local clients that feed is live
    broadcast('feed', { status: 'connected', source: 'binance-ws', ts: Date.now() });
  });

  ws.on('message', handleMessage);

  ws.on('error', (err) => {
    logger.warn(`Binance WS error: ${err.message}`);
    // 'close' will follow; just log
  });

  ws.on('close', (code, reason) => {
    const r = reason?.toString?.() || '';
    logger.warn(`Binance WS closed (${code} ${r})`);
    clearTimers();
    broadcast('feed', { status: 'disconnected', source: 'binance-ws', ts: Date.now() });

    // 1000 = normal rotation → reconnect immediately-ish
    // anything else → backoff
    if (code === 1000 && reason === 'rotate') {
      reconnectAttempts = 0;
      reconnectTimer = setTimeout(connect, 1500);
    } else {
      scheduleReconnect(`close ${code}`);
    }
  });

  ws.on('ping', () => {
    // The 'ws' library auto-replies with pong. Nothing to do.
  });
}

/* ------------------------------ public API -------------------------------- */

export function initBinanceStream() {
  if (process.env.BINANCE_WS_ENABLED === 'false') {
    logger.info('Binance WS disabled via env');
    return;
  }
  shuttingDown = false;
  connect();
}

export function stopBinanceStream() {
  shuttingDown = true;
  clearTimers();
  try { ws?.close(1000, 'shutdown'); } catch { /* ignore */ }
  ws = null;
  logger.info('Binance WS stopped');
}

export function getBinanceStreamStatus() {
  const open = ws?.readyState === WebSocket.OPEN;
  return {
    open,
    readyState: ws?.readyState ?? null,
    lastMessageAt,
    silenceMs: lastMessageAt ? Date.now() - lastMessageAt : null,
    reconnectAttempts,
    endpoint: BINANCE_WS_BASE,
  };
}