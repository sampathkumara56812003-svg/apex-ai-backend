const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const CURRENT = LEVELS[process.env.LOG_LEVEL || 'debug'] ?? 0;

function log(level, msg, meta) {
  if (LEVELS[level] < CURRENT) return;
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level.toUpperCase()}] ${msg}`;
  const fn = level === 'debug' ? 'log' : level;
  meta !== undefined ? console[fn](line, meta) : console[fn](line);
}

export default {
  debug: (m, x) => log('debug', m, x),
  info: (m, x) => log('info', m, x),
  warn: (m, x) => log('warn', m, x),
  error: (m, x) => log('error', m, x),
};