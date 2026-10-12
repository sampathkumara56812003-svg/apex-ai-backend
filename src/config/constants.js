// backend/src/config/constants.js

export const MODEL_VERSION = 'v1.4.2-ensemble';

export const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'];

export const TIMEFRAMES = ['5m', '15m', '1h', '4h'];

export const TF_SECONDS = {
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14400,
};

export const TF_LABEL = {
  '5m': '5M',
  '15m': '15M',
  '1h': '1H',
  '4h': '4H',
};

export const HORIZON_BARS = {
  '5m': 48,
  '15m': 24,
  '1h': 12,
  '4h': 8,
};

export const THRESHOLDS = {
  waitBelow: 0.55,
  weakFrom: 0.55,
  strongFrom: 0.65,
  veryStrongFrom: 0.75,
};

export const RISK = {
  lowBelow: 30,
  mediumBelow: 50,
  highBelow: 70,
};

export const TRADING = {
  takerFeeBps: Number(process.env.TAKER_FEE_BPS || 5),
  slippageBps: Number(process.env.SLIPPAGE_BPS || 3),
  riskPerTradePct: Number(process.env.RISK_PER_TRADE_PCT || 1.0),
  initialPaperBalance: Number(process.env.INITIAL_PAPER_BALANCE || 10000),
};

export const COIN_META = {
  BTCUSDT: { name: 'Bitcoin',  base: 'BTC', color: '#f7931a' },
  ETHUSDT: { name: 'Ethereum', base: 'ETH', color: '#8ba3f8' },
  SOLUSDT: { name: 'Solana',   base: 'SOL', color: '#9d6bf5' },
  BNBUSDT: { name: 'BNB',      base: 'BNB', color: '#f3ba2f' },
};

export const REGIME_COLORS = {
  STRONG_BULL:     '#00e5a0',
  WEAK_BULL:       '#7ef0c8',
  SIDEWAYS:        '#8b9bb4',
  WEAK_BEAR:       '#ff9a92',
  STRONG_BEAR:     '#ff4d6d',
  HIGH_VOLATILITY: '#ffb224',
  LOW_VOLATILITY:  '#5eead4',
};

export const SIM_BASE_PRICE = {
  BTCUSDT: 67400,
  ETHUSDT: 3520,
  SOLUSDT: 168,
  BNBUSDT: 605,
};

/* ------------------ Phase A — Signal Policy ------------------ */

export const SIGNAL_POLICY = {
  allowedTimeframes: ['4h'],
  allowedSymbols: ['BTCUSDT', 'ETHUSDT'],
  minProbability: 0.65,
  strongProbability: 0.70,
  allowSyntheticSignals: false,
};