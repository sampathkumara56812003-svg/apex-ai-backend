/* eslint-disable */
// Pure-JS port of the TypeScript indicator engine. All functions are causal.

export function smaArr(values, period) {
  const out = new Array(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function emaArr(values, period) {
  const out = new Array(values.length).fill(NaN);
  const k = 2 / (period + 1);
  let ema = 0, started = false, sum = 0;
  for (let i = 0; i < values.length; i++) {
    if (!started) {
      sum += values[i];
      if (i === period - 1) {
        ema = sum / period;
        started = true;
        out[i] = ema;
      }
    } else {
      ema = values[i] * k + ema * (1 - k);
      out[i] = ema;
    }
  }
  return out;
}

export function stdevArr(values, period) {
  const out = new Array(values.length).fill(NaN);
  let sum = 0, sumSq = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    sumSq += values[i] * values[i];
    if (i >= period) {
      sum -= values[i - period];
      sumSq -= values[i - period] * values[i - period];
    }
    if (i >= period - 1) {
      const mean = sum / period;
      out[i] = Math.sqrt(Math.max(sumSq / period - mean * mean, 0));
    }
  }
  return out;
}

export function rsiArr(closes, period = 14) {
  const out = new Array(closes.length).fill(NaN);
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    if (i <= period) {
      avgGain += gain / period;
      avgLoss += loss / period;
      if (i === period) out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
  }
  return out;
}

export function macdArr(closes, fast = 12, slow = 26, signalP = 9) {
  const emaFast = emaArr(closes, fast);
  const emaSlow = emaArr(closes, slow);
  const macd = closes.map((_, i) =>
    Number.isNaN(emaFast[i]) || Number.isNaN(emaSlow[i]) ? NaN : emaFast[i] - emaSlow[i]
  );
  const firstValid = macd.findIndex((v) => !Number.isNaN(v));
  const signal = new Array(closes.length).fill(NaN);
  if (firstValid >= 0) {
    const k = 2 / (signalP + 1);
    let s = 0, started = false, sum = 0;
    for (let i = firstValid; i < macd.length; i++) {
      if (!started) {
        sum += macd[i];
        if (i === firstValid + signalP - 1) {
          s = sum / signalP;
          started = true;
          signal[i] = s;
        }
      } else {
        s = macd[i] * k + s * (1 - k);
        signal[i] = s;
      }
    }
  }
  const hist = macd.map((v, i) =>
    Number.isNaN(v) || Number.isNaN(signal[i]) ? NaN : v - signal[i]
  );
  return { macd, signal, hist };
}

export function atrArr(candles, period = 14) {
  const out = new Array(candles.length).fill(NaN);
  let atr = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const prevClose = i > 0 ? candles[i - 1].close : c.open;
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prevClose),
      Math.abs(c.low - prevClose)
    );
    if (i < period) {
      atr += tr / period;
      if (i === period - 1) out[i] = atr;
    } else {
      atr = (atr * (period - 1) + tr) / period;
      out[i] = atr;
    }
  }
  return out;
}

export function adxArr(candles, period = 14) {
  const n = candles.length;
  const adx = new Array(n).fill(NaN);
  const plusDI = new Array(n).fill(NaN);
  const minusDI = new Array(n).fill(NaN);
  let trS = 0, pdmS = 0, mdmS = 0;
  const dxs = [];
  let adxStarted = false;

  for (let i = 1; i < n; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    const upMove = c.high - p.high;
    const downMove = p.low - c.low;
    const pdm = upMove > downMove && upMove > 0 ? upMove : 0;
    const mdm = downMove > upMove && downMove > 0 ? downMove : 0;
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - p.close),
      Math.abs(c.low - p.close)
    );

    if (i <= period) {
      trS += tr; pdmS += pdm; mdmS += mdm;
      if (i === period) {
        const pdi = trS === 0 ? 0 : (100 * pdmS) / trS;
        const mdi = trS === 0 ? 0 : (100 * mdmS) / trS;
        plusDI[i] = pdi;
        minusDI[i] = mdi;
        const dx = pdi + mdi === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / (pdi + mdi);
        dxs.push(dx);
      }
    } else {
      trS = trS - trS / period + tr;
      pdmS = pdmS - pdmS / period + pdm;
      mdmS = mdmS - mdmS / period + mdm;
      const pdi = trS === 0 ? 0 : (100 * pdmS) / trS;
      const mdi = trS === 0 ? 0 : (100 * mdmS) / trS;
      plusDI[i] = pdi;
      minusDI[i] = mdi;
      const dx = pdi + mdi === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / (pdi + mdi);

      if (!adxStarted) {
        dxs.push(dx);
        if (dxs.length === period) {
          adx[i] = dxs.reduce((s, v) => s + v, 0) / period;
          adxStarted = true;
        }
      } else {
        adx[i] = (adx[i - 1] * (period - 1) + dx) / period;
      }
    }
  }
  return { adx, plusDI, minusDI };
}

export function bollingerArr(closes, period = 20, mult = 2) {
  const mid = smaArr(closes, period);
  const sd = stdevArr(closes, period);
  return {
    upper: mid.map((m, i) => (Number.isNaN(m) ? NaN : m + mult * sd[i])),
    middle: mid,
    lower: mid.map((m, i) => (Number.isNaN(m) ? NaN : m - mult * sd[i])),
  };
}

export function obvArr(candles) {
  const out = new Array(candles.length).fill(0);
  for (let i = 1; i < candles.length; i++) {
    const dir = Math.sign(candles[i].close - candles[i - 1].close);
    out[i] = out[i - 1] + dir * candles[i].volume;
  }
  return out;
}

export function vwapArr(candles, period = 48) {
  const out = new Array(candles.length).fill(NaN);
  let pvSum = 0, vSum = 0;
  const pvSeries = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const tp = (c.high + c.low + c.close) / 3;
    const pv = tp * c.volume;
    pvSeries.push(pv);
    pvSum += pv;
    vSum += c.volume;
    if (i >= period) {
      pvSum -= pvSeries[i - period];
      vSum -= candles[i - period].volume;
    }
    if (i >= 1) out[i] = vSum === 0 ? c.close : pvSum / vSum;
  }
  return out;
}

export function stochRsiArr(closes, rsiPeriod = 14, stochPeriod = 14, kP = 3, dP = 3) {
  const rsi = rsiArr(closes, rsiPeriod);
  const n = closes.length;
  const stoch = new Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (i < stochPeriod || Number.isNaN(rsi[i])) continue;
    let min = Infinity, max = -Infinity, ok = true;
    for (let j = i - stochPeriod + 1; j <= i; j++) {
      if (Number.isNaN(rsi[j])) { ok = false; break; }
      min = Math.min(min, rsi[j]);
      max = Math.max(max, rsi[j]);
    }
    if (ok) stoch[i] = max === min ? 50 : ((rsi[i] - min) / (max - min)) * 100;
  }
  const k = smaArr(stoch.map((v) => (Number.isNaN(v) ? 0 : v)), kP);
  for (let i = 0; i < n; i++) if (Number.isNaN(stoch[i])) k[i] = NaN;
  const d = smaArr(k.map((v) => (Number.isNaN(v) ? 0 : v)), dP);
  for (let i = 0; i < n; i++) if (Number.isNaN(k[i])) d[i] = NaN;
  return { k, d };
}

export function realizedVol(closes, period = 30) {
  if (closes.length < period + 1) return NaN;
  const rets = [];
  for (let i = closes.length - period; i < closes.length; i++) {
    rets.push(Math.log(closes[i] / closes[i - 1]));
  }
  const mean = rets.reduce((s, v) => s + v, 0) / rets.length;
  const varr = rets.reduce((s, v) => s + (v - mean) * (v - mean), 0) / Math.max(rets.length - 1, 1);
  return Math.sqrt(varr) * 100;
}

export function swings(candles, left = 3, right = 3) {
  const out = [];
  const n = candles.length;
  for (let j = left; j < n - right; j++) {
    let isHigh = true, isLow = true;
    for (let k = j - left; k <= j + right; k++) {
      if (k === j) continue;
      if (candles[k].high >= candles[j].high) isHigh = false;
      if (candles[k].low <= candles[j].low) isLow = false;
    }
    if (isHigh) out.push({ index: j, price: candles[j].high, kind: 'high' });
    if (isLow) out.push({ index: j, price: candles[j].low, kind: 'low' });
  }
  return out;
}

export function supportResistance(candles) {
  const n = candles.length;
  const price = candles[n - 1].close;
  const sw = swings(candles, 3, 3);
  const lows = sw.filter((s) => s.kind === 'low').slice(-6);
  const highs = sw.filter((s) => s.kind === 'high').slice(-6);

  const below = lows.map((l) => l.price).filter((p) => p < price);
  const above = highs.map((h) => h.price).filter((p) => p > price);

  const lookback = candles.slice(-60);
  const fbSup = Math.min(...lookback.map((c) => c.low));
  const fbRes = Math.max(...lookback.map((c) => c.high));

  const support = below.length ? Math.max(...below) : fbSup;
  const resistance = above.length ? Math.min(...above) : fbRes;

  let structure = 'RANGE';
  if (highs.length >= 2 && lows.length >= 2) {
    const h1 = highs[highs.length - 2].price;
    const h2 = highs[highs.length - 1].price;
    const l1 = lows[lows.length - 2].price;
    const l2 = lows[lows.length - 1].price;
    const hh = h2 > h1, hl = l2 > l1;
    if (hh && hl) structure = 'HH';
    else if (!hh && !hl) structure = 'LL';
    else if (hl) structure = 'HL';
    else structure = 'LH';
  }
  return { support, resistance, structure };
}

export function resample(candles, factor) {
  const out = [];
  for (let i = 0; i + factor <= candles.length; i += factor) {
    const slice = candles.slice(i, i + factor);
    out.push({
      time: slice[0].time,
      open: slice[0].open,
      high: Math.max(...slice.map((c) => c.high)),
      low: Math.min(...slice.map((c) => c.low)),
      close: slice[slice.length - 1].close,
      volume: slice.reduce((s, c) => s + c.volume, 0),
    });
  }
  return out;
}

const last = (arr) => arr[arr.length - 1];

export function snapshot(candles) {
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const n = candles.length;
  const price = closes[n - 1];

  const ema20 = emaArr(closes, 20);
  const ema50 = emaArr(closes, 50);
  const ema200 = emaArr(closes, 200);
  const rsi = rsiArr(closes, 14);
  const { macd, signal, hist } = macdArr(closes);
  const atr = atrArr(candles, 14);
  const { adx, plusDI, minusDI } = adxArr(candles, 14);
  const bb = bollingerArr(closes, 20, 2);
  const obv = obvArr(candles);
  const vwap = vwapArr(candles, 48);
  const stoch = stochRsiArr(closes);
  const volSma = smaArr(volumes, 20);
  const sr = supportResistance(candles);

  const a = Number.isNaN(last(atr)) ? price * 0.004 : last(atr);
  const atrPct = a / price;

  const obvWin = obv.slice(-20);
  const obvFirst = obvWin[0] ?? 0;
  const obvLast = obvWin[obvWin.length - 1] ?? 0;
  const volScale = volumes.slice(-20).reduce((s, v) => s + v, 0) / Math.max(obvWin.length, 1) || 1;
  const obvSlope = Math.max(-1, Math.min(1, (obvLast - obvFirst) / (volScale * 20) / 2));

  const roc = n > 11 ? ((closes[n - 1] - closes[n - 11]) / closes[n - 11]) * 100 : 0;
  const momentum = n > 11 ? closes[n - 1] - closes[n - 11] : 0;

  const bbU = last(bb.upper);
  const bbL = last(bb.lower);
  const bbM = last(bb.middle);
  const bbRange = bbU - bbL;
  const bbPosition =
    Number.isNaN(bbRange) || bbRange <= 0 ? 0.5 : Math.max(0, Math.min(1, (price - bbL) / bbRange));

  const e20 = last(ema20);
  const e50 = last(ema50);
  const e200 = last(ema200);

  let emaAligned = 0;
  if (!Number.isNaN(e50) && !Number.isNaN(e20)) emaAligned += e20 > e50 ? 0.34 : -0.34;
  if (!Number.isNaN(e200) && !Number.isNaN(e50)) {
    emaAligned += e50 > e200 ? 0.33 : -0.33;
    emaAligned += price > e200 ? 0.33 : -0.33;
  }

  const adxV = Number.isNaN(last(adx)) ? 15 : last(adx);
  const struct = sr.structure;

  let trend = 'NEUTRAL';
  if (emaAligned > 0.3 && (struct === 'HH' || struct === 'HL')) trend = 'BULLISH';
  else if (emaAligned < -0.3 && (struct === 'LL' || struct === 'LH')) trend = 'BEARISH';
  else if (emaAligned > 0.45) trend = 'BULLISH';
  else if (emaAligned < -0.45) trend = 'BEARISH';

  return {
    price,
    rsi: Number.isNaN(last(rsi)) ? 50 : last(rsi),
    macd: Number.isNaN(last(macd)) ? 0 : last(macd),
    macdSignal: Number.isNaN(last(signal)) ? 0 : last(signal),
    macdHist: Number.isNaN(last(hist)) ? 0 : last(hist),
    ema20: Number.isNaN(e20) ? price : e20,
    ema50: Number.isNaN(e50) ? price : e50,
    ema200: Number.isNaN(e200) ? price : e200,
    atr: a,
    atrPct,
    adx: adxV,
    plusDI: Number.isNaN(last(plusDI)) ? 20 : last(plusDI),
    minusDI: Number.isNaN(last(minusDI)) ? 20 : last(minusDI),
    vwap: Number.isNaN(last(vwap)) ? price : last(vwap),
    bbUpper: Number.isNaN(bbU) ? price * 1.01 : bbU,
    bbMiddle: Number.isNaN(bbM) ? price : bbM,
    bbLower: Number.isNaN(bbL) ? price * 0.99 : bbL,
    bbPosition,
    obvSlope,
    stochRsiK: Number.isNaN(last(stoch.k)) ? 50 : last(stoch.k),
    stochRsiD: Number.isNaN(last(stoch.d)) ? 50 : last(stoch.d),
    roc,
    momentum,
    volumeRatio: Number.isNaN(last(volSma)) ? 1 : volumes[n - 1] / Math.max(last(volSma), 1e-9),
    volatilityPct: Number.isNaN(realizedVol(closes, 30)) ? atrPct * 100 : realizedVol(closes, 30),
    support: sr.support,
    resistance: sr.resistance,
    structure: sr.structure,
    trend,
    emaAligned,
  };
}

export function trendScore(candles) {
  const closes = candles.map((c) => c.close);
  const ema20 = emaArr(closes, Math.min(20, Math.max(5, Math.floor(closes.length / 4))));
  const ema50 = emaArr(closes, Math.min(50, Math.max(8, Math.floor(closes.length / 2))));
  const rsi = rsiArr(closes, 14);
  const { adx } = adxArr(candles, 14);
  const e20 = last(ema20);
  const e50 = last(ema50);
  const price = closes[closes.length - 1];

  let score = 0;
  if (!Number.isNaN(e20) && !Number.isNaN(e50)) {
    const spread = (e20 - e50) / Math.max(price * 0.004, 1e-9);
    score += Math.max(-1, Math.min(1, spread / 2)) * 0.55;
  }
  const r = Number.isNaN(last(rsi)) ? 50 : last(rsi);
  score += ((r - 50) / 50) * 0.45;
  score = Math.max(-1, Math.min(1, score));

  const trend = score > 0.18 ? 'BULLISH' : score < -0.18 ? 'BEARISH' : 'NEUTRAL';
  return {
    trend, score, rsi: r,
    adx: Number.isNaN(last(adx)) ? 15 : last(adx),
  };
}