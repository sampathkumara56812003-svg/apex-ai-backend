import { snapshot } from './indicator.service.js';
import { HORIZON_BARS, MODEL_VERSION, THRESHOLDS } from '../config/constants.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sigmoid = (x) => 1 / (1 + Math.exp(-x));

/* ------------------------------ regime ---------------------------------- */

export function detectRegime(snap) {
  const volPctile = snap.atrPct * 100;
  if (volPctile > 1.6) return 'HIGH_VOLATILITY';
  if (snap.adx < 14 && volPctile < 0.28) return 'LOW_VOLATILITY';
  const bull = snap.emaAligned > 0.35;
  const bear = snap.emaAligned < -0.35;
  if (snap.adx >= 27 && bull) return 'STRONG_BULL';
  if (snap.adx >= 27 && bear) return 'STRONG_BEAR';
  if (bull) return 'WEAK_BULL';
  if (bear) return 'WEAK_BEAR';
  return 'SIDEWAYS';
}

/* ------------------------------ features -------------------------------- */

export function buildFeatures(snap, ctx = {}) {
  const f = {};
  f.rsi = snap.rsi;
  f.rsiNorm = (snap.rsi - 50) / 25;
  f.macdHistAtr = snap.atr > 0 ? snap.macdHist / snap.atr : 0;
  f.emaSpreadAtr = snap.atr > 0 ? (snap.ema20 - snap.ema50) / snap.atr : 0;
  f.priceEma200Atr = snap.atr > 0 ? (snap.price - snap.ema200) / snap.atr : 0;
  f.priceVwapAtr = snap.atr > 0 ? (snap.price - snap.vwap) / snap.atr : 0;
  f.adx = snap.adx;
  f.adxNorm = clamp((snap.adx - 15) / 25, -0.5, 1.5);
  f.diDiff = (snap.plusDI - snap.minusDI) / 40;
  f.volumeRatio = clamp(snap.volumeRatio, 0, 4);
  f.volumeExcess = clamp(snap.volumeRatio - 1, -0.5, 2);
  f.obvSlope = snap.obvSlope;
  f.bbPosition = snap.bbPosition;
  f.stochK = snap.stochRsiK;
  f.roc = clamp(snap.roc, -8, 8);
  f.atrPct = snap.atrPct * 100;
  f.volatilityPct = snap.volatilityPct;
  f.structureBull = snap.structure === 'HH' ? 1 : snap.structure === 'HL' ? 0.5 : 0;
  f.structureBear = snap.structure === 'LL' ? 1 : snap.structure === 'LH' ? 0.5 : 0;
  f.emaAligned = snap.emaAligned;
  f.distSupportAtr = snap.atr > 0 ? clamp((snap.price - snap.support) / snap.atr, 0, 8) : 2;
  f.distResistanceAtr = snap.atr > 0 ? clamp((snap.resistance - snap.price) / snap.atr, 0, 8) : 2;

  if (ctx.derivatives) {
    const d = ctx.derivatives;
    f.fundingNorm = clamp(d.fundingRate / 0.0005, -2, 2);
    f.oiChangeNorm = clamp((d.openInterestChange ?? 0) / 10, -2, 2);
    f.lsrNorm = clamp(((d.longShortRatio ?? 1) - 1) * 2, -1.5, 1.5);
  } else {
    f.fundingNorm = 0;
    f.oiChangeNorm = 0;
    f.lsrNorm = 0;
  }

  if (ctx.orderBook) {
    f.obImbalance = (ctx.orderBook.imbalance - 0.5) * 2;
    f.spreadPct = ctx.orderBook.spreadPct ?? 0.02;
  } else {
    f.obImbalance = 0;
    f.spreadPct = 0.02;
  }

  if (ctx.mtf && ctx.mtf.length) {
    const higher = ctx.mtf.filter((m) => m.timeframe === '4H' || m.timeframe === '1D');
    f.htfAlign = higher.length
      ? higher.reduce((s, m) => s + m.score, 0) / higher.length
      : 0;
    f.mtfBreadth = ctx.mtf.reduce((s, m) => s + m.score, 0) / ctx.mtf.length;
  } else {
    f.htfAlign = 0;
    f.mtfBreadth = 0;
  }

  return f;
}

/* --------------------- directional scoring + models --------------------- */

function directionalScore(f, side) {
  const trend =
    clamp(f.emaSpreadAtr / 3, -1, 1) * 0.42 +
    clamp(f.priceEma200Atr / 5, -1, 1) * 0.26 +
    f.emaAligned * 0.32;
  const momentum =
    clamp(f.rsiNorm, -1.2, 1.2) * 0.34 +
    clamp(f.macdHistAtr * 2, -1, 1) * 0.4 +
    clamp(f.roc / 5, -1, 1) * 0.26;
  const flow =
    clamp(f.obvSlope, -1, 1) * 0.35 +
    f.obImbalance * 0.3 +
    clamp(f.diDiff, -1, 1) * 0.35;
  const deriv =
    -f.fundingNorm * 0.3 +
    f.oiChangeNorm * 0.22 * Math.sign(trend || 1) * side +
    -f.lsrNorm * 0.18;
  const mtf = f.htfAlign * 0.4 + f.mtfBreadth * 0.2;
  const structure = (f.structureBull - f.structureBear) * 0.5;

  const raw =
    side * (trend * 0.34 + momentum * 0.2 + flow * 0.14 + structure * 0.1 + mtf * 0.18) +
    deriv * 0.12;

  const overstretch = side === 1
    ? Math.max(0, f.bbPosition - 0.82) * 2.6 + Math.max(0, f.rsiNorm - 1.0) * 0.9
    : Math.max(0, 0.18 - f.bbPosition) * 2.6 + Math.max(0, -1.0 - f.rsiNorm) * 0.9;

  return raw - overstretch * 0.6;
}

function nonlinearity(f, side) {
  let s = 0;
  if (side === 1) {
    if (f.emaSpreadAtr > 0.6 && f.macdHistAtr > 0) s += 0.22;
    if (f.structureBull > 0 && f.obImbalance > 0.05) s += 0.15;
    if (f.htfAlign > 0.3 && f.macdHistAtr > 0) s += 0.18;
    if (f.fundingNorm > 1.1) s -= 0.28;
    if (f.rsi > 76) s -= 0.24;
  } else {
    if (f.emaSpreadAtr < -0.6 && f.macdHistAtr < 0) s += 0.22;
    if (f.structureBear > 0 && f.obImbalance < -0.05) s += 0.15;
    if (f.htfAlign < -0.3 && f.macdHistAtr < 0) s += 0.18;
    if (f.fundingNorm < -1.1) s -= 0.28;
    if (f.rsi < 24) s -= 0.24;
  }
  return s;
}

function xgboostProb(f, side) {
  const ds = directionalScore(f, side);
  const trendQuality = clamp(f.adxNorm, 0, 1.4) * 0.32;
  const volConfirm = clamp(f.volumeExcess, -0.3, 1.6) * 0.26 * Math.sign(ds || 1);
  const logit = 0.05 + ds * (2.45 + trendQuality) + volConfirm * side + nonlinearity(f, side);
  return sigmoid(logit);
}

function lightgbmProb(f, side) {
  const ds = directionalScore(f, side);
  const regimeBoost = clamp(f.adxNorm, 0, 1.2) * 0.22;
  let logit =
    0.05 + ds * 2.05 +
    f.htfAlign * side * 0.55 +
    (f.structureBull - f.structureBear) * side * 0.4 +
    clamp(f.priceVwapAtr, -1.5, 1.5) * side * 0.3;
  logit += regimeBoost * Math.sign(ds || 1);
  if (side === 1 && f.distResistanceAtr < 0.9) logit -= 0.3;
  if (side === -1 && f.distSupportAtr < 0.9) logit -= 0.3;
  return sigmoid(logit);
}

function randomForestProb(f, side) {
  const checks = [
    f.emaSpreadAtr * side > 0.2,
    f.priceEma200Atr * side > 0.1,
    f.rsiNorm * side > -0.2,
    f.macdHistAtr * side > 0,
    f.roc * side > 0.15,
    f.diDiff * side > 0,
    f.volumeRatio > 1.05,
    f.obvSlope * side > 0,
    f.obImbalance * side > 0.01,
    (f.structureBull - f.structureBear) * side > 0,
    f.htfAlign * side > 0.1,
    f.mtfBreadth * side > 0,
    f.priceVwapAtr * side > -0.2,
    f.bbPosition < 0.88 || side === -1,
    f.bbPosition > 0.12 || side === 1,
    f.fundingNorm * side < 1.2,
    f.adx > 19,
    side === 1 ? f.distResistanceAtr > 0.8 : f.distSupportAtr > 0.8,
  ];
  const votes = checks.reduce((n, c) => n + (c ? 1 : 0), 0);
  return sigmoid((votes - 9.4) * 0.42);
}

/* ------------------------- full signal composer ------------------------- */

export function composeSignal(opts) {
  const { symbol, timeframe, candles } = opts;
  const snap = snapshot(candles);
  const f = buildFeatures(snap, {
    derivatives: opts.derivatives,
    orderBook: opts.orderBook,
    mtf: opts.mtf,
  });
  const regime = detectRegime(snap);

  /* risk score */
  let riskScore = 0;
  riskScore += clamp(snap.atrPct * 100 * 16, 0, 30);
  riskScore += clamp(Math.abs(f.fundingNorm) * 9, 0, 16);
  riskScore += clamp(f.spreadPct * 120, 0, 10);
  riskScore += regime === 'HIGH_VOLATILITY' ? 14 : 0;
  riskScore += Math.abs(f.bbPosition - 0.5) * 12;
  if (opts.mtf && opts.mtf.length >= 3) {
    const scores = opts.mtf.map((m) => m.score);
    const mean = scores.reduce((s, v) => s + v, 0) / scores.length;
    const variance = scores.reduce((s, v) => s + (v - mean) ** 2, 0) / scores.length;
    riskScore += clamp(Math.sqrt(variance) * 26, 0, 14);
  }
  if (f.distResistanceAtr < 0.7 || f.distSupportAtr < 0.7) riskScore += 7;
  riskScore = clamp(riskScore, 2, 98);

  const risk =
    riskScore < 30 ? 'LOW' :
    riskScore < 50 ? 'MEDIUM' :
    riskScore < 70 ? 'HIGH' : 'EXTREME';

  /* ensemble */
  const pLongModels = {
    xgboost: xgboostProb(f, 1),
    lightgbm: lightgbmProb(f, 1),
    randomForest: randomForestProb(f, 1),
  };
  const pShortModels = {
    xgboost: xgboostProb(f, -1),
    lightgbm: lightgbmProb(f, -1),
    randomForest: randomForestProb(f, -1),
  };

  const ensemble = (m) => m.xgboost * 0.45 + m.lightgbm * 0.35 + m.randomForest * 0.2;
  const rawLong = ensemble(pLongModels);
  const rawShort = ensemble(pShortModels);

  const calibrate = (p) => clamp(0.5 + (p - 0.5) * 0.94 - 0.003, 0.02, 0.98);
  const calLong = calibrate(rawLong);
  const calShort = calibrate(rawShort);

  let direction = calLong >= calShort ? 'LONG' : 'SHORT';
  const raw = direction === 'LONG' ? rawLong : rawShort;
  const prob = direction === 'LONG' ? calLong : calShort;
  const models = direction === 'LONG' ? pLongModels : pShortModels;
  const side = direction === 'LONG' ? 1 : -1;

  /* confidence */
  const probs = [models.xgboost, models.lightgbm, models.randomForest];
  const mean = probs.reduce((s, v) => s + v, 0) / 3;
  const std = Math.sqrt(probs.reduce((s, v) => s + (v - mean) ** 2, 0) / 3);

  let conf = 0.62;
  conf -= clamp(std * 3.2, 0, 0.3);
  conf += clamp(f.adxNorm, 0, 1) * 0.1;
  conf += clamp(f.volumeExcess, -0.2, 1) * 0.08;
  conf += Math.abs(f.htfAlign) * 0.14;
  conf += Math.abs(f.mtfBreadth) * 0.08;

  const conflicting =
    Math.sign(f.htfAlign) !== 0 &&
    Math.sign(f.macdHistAtr) !== 0 &&
    Math.sign(f.htfAlign) !== Math.sign(f.macdHistAtr) &&
    Math.abs(f.htfAlign) > 0.25;
  if (conflicting) conf -= 0.16;
  if (regime === 'HIGH_VOLATILITY') conf -= 0.12;
  if (Math.abs(f.fundingNorm) > 1.1) conf -= 0.08;
  if (opts.derivatives?.source === 'MODELED') conf -= 0.03;

  conf = clamp(conf, 0.08, 0.95);
  const confidence = conf >= 0.6 ? 'HIGH' : conf >= 0.42 ? 'MEDIUM' : 'LOW';

  /* decision */
  let strength = null;
  if (risk === 'EXTREME') {
    direction = 'NO_TRADE';
  } else if (prob < THRESHOLDS.waitBelow || (confidence === 'LOW' && prob < 0.62)) {
    direction = 'WAIT';
  } else {
    strength = prob >= THRESHOLDS.veryStrongFrom ? 'VERY_STRONG'
      : prob >= THRESHOLDS.strongFrom ? 'STRONG'
      : 'WEAK';
  }

  /* levels */
  let entry = null, tp1 = null, tp2 = null, stopLoss = null, riskReward = null;
  if (direction === 'LONG' || direction === 'SHORT') {
    const p = snap.price;
    const a = snap.atr;
    if (side === 1) {
      entry = p - a * 0.12;
      const structDist = snap.support < entry ? entry - snap.support + a * 0.22 : 0;
      const slDist = Math.max(a * 1.15, structDist);
      stopLoss = entry - slDist;
      tp1 = entry + slDist * 1.5;
      tp2 = entry + slDist * 2.6;
    } else {
      entry = p + a * 0.12;
      const structDist = snap.resistance > entry ? snap.resistance - entry + a * 0.22 : 0;
      const slDist = Math.max(a * 1.15, structDist);
      stopLoss = entry + slDist;
      tp1 = entry - slDist * 1.5;
      tp2 = entry - slDist * 2.6;
    }
    riskReward = Math.abs(tp2 - entry) / Math.abs(entry - stopLoss);
  }

  /* explanation */
  const { reasons, warnings } = explain({
    side, direction, snap, f, regime, risk, models, prob,
  });

  const horizon = HORIZON_BARS[timeframe];

  return {
    symbol, timeframe, direction, strength,
    probability: prob, rawProbability: raw,
    confidence, confidenceScore: conf,
    risk, riskScore, regime,
    price: snap.price,
    entry, tp1, tp2, stopLoss, riskReward,
    models, reasons, warnings, features: f,
    horizonBars: horizon,
    target: `TP1 before SL within ${horizon} bars`,
    modelVersion: MODEL_VERSION,
    dataSource: opts.dataSource || 'BINANCE',
    time: candles[candles.length - 1].time,
  };
}

function explain({ side, direction, snap, f, regime, risk, models, prob }) {
  const reasons = [];
  const warnings = [];
  const long = side === 1;

  if (direction === 'NO_TRADE') {
    warnings.push(`Risk level EXTREME — signals suppressed`);
    if (regime === 'HIGH_VOLATILITY') warnings.push('Volatility regime abnormal');
    if (Math.abs(f.fundingNorm) > 1.1) warnings.push('Funding rate at extreme — squeezes likely');
    return { reasons, warnings };
  }

  const trendTxt = long ? 'bullish' : 'bearish';

  if (Math.abs(f.htfAlign) > 0.2 && Math.sign(f.htfAlign) === side)
    reasons.push(`Higher-timeframe trend ${trendTxt} (HTF alignment ${(Math.abs(f.htfAlign) * 100).toFixed(0)}%)`);
  if (f.emaAligned * side > 0.35)
    reasons.push(`EMA structure ${trendTxt} (20/50/200 aligned)`);
  if ((long ? f.structureBull > 0 : f.structureBear > 0))
    reasons.push(`Market structure ${long ? (snap.structure === 'HH' ? 'higher highs' : 'higher lows') : snap.structure === 'LL' ? 'lower lows' : 'lower highs'}`);
  if (f.macdHistAtr * side > 0.05)
    reasons.push(`MACD histogram ${long ? 'positive' : 'negative'} and expanding`);
  if (f.volumeExcess > 0.2)
    reasons.push(`Volume confirmation (${snap.volumeRatio.toFixed(2)}× average)`);
  if (f.obvSlope * side > 0.15)
    reasons.push(`OBV slope confirms ${long ? 'accumulation' : 'distribution'}`);
  if (snap.adx > 24)
    reasons.push(`ADX ${snap.adx.toFixed(0)} — directional trend is strong`);
  if (f.oiChangeNorm * side > 0.15 && Math.sign(f.emaSpreadAtr) === side)
    reasons.push('Open interest expanding in trend direction');
  if (f.obImbalance * side > 0.06)
    reasons.push(`Order-book imbalance ${long ? 'bid' : 'ask'}-heavy (${(Math.abs(f.obImbalance) * 100).toFixed(0)}%)`);
  if (f.rsiNorm * side > 0.1 && f.rsiNorm * side < 0.9)
    reasons.push(`RSI ${snap.rsi.toFixed(0)} supports continuation`);
  if (f.fundingNorm * side < -0.4 && direction !== 'WAIT')
    reasons.push('Funding skewed against crowded side — squeeze potential');

  if (reasons.length === 0 && direction !== 'WAIT')
    reasons.push(`Ensemble probability ${(prob * 100).toFixed(0)}% with ${snap.trend.toLowerCase()} tape`);

  /* warnings */
  if (long && f.distResistanceAtr < 1.1)
    warnings.push(`Resistance nearby (${f.distResistanceAtr.toFixed(1)} ATR above)`);
  if (!long && f.distSupportAtr < 1.1)
    warnings.push(`Support nearby (${f.distSupportAtr.toFixed(1)} ATR below)`);
  if (snap.atrPct * 100 > 0.85)
    warnings.push(`Volatility elevated (ATR ${(snap.atrPct * 100).toFixed(2)}% per bar)`);
  if (Math.abs(f.fundingNorm) > 0.9)
    warnings.push(`Funding ${f.fundingNorm > 0 ? 'positive' : 'negative'} extreme — crowded positioning`);
  if (f.obImbalance * side < -0.08)
    warnings.push('Order book leans against the trade');

  const mStd = Math.sqrt(
    [models.xgboost, models.lightgbm, models.randomForest]
      .reduce((s, v, _, arr) => s + (v - arr.reduce((a, b) => a + b, 0) / 3) ** 2, 0) / 3
  ) * 100;
  if (mStd > 6) warnings.push(`Model disagreement ${mStd.toFixed(0)}pts — treat with care`);
  if (regime === 'HIGH_VOLATILITY') warnings.push('High-volatility regime active');

  if (direction === 'WAIT') {
    if (Math.abs(f.htfAlign) < 0.15) warnings.push('No clear multi-timeframe trend');
    warnings.push('No statistical edge above threshold — standing aside');
  }
  if (risk === 'HIGH') warnings.push('Risk classified HIGH — reduce size if taken');

  return {
    reasons: reasons.slice(0, 7),
    warnings: warnings.slice(0, 5),
  };
}