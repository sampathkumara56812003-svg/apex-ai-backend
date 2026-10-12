import { PaperTrade } from '../models/paperTrade.model.js';
import { PaperAccount } from '../models/paperAccount.model.js';
import { Signal } from '../models/signal.model.js';
import { TRADING } from '../config/constants.js';
import { ApiError } from '../utils/ApiError.js';
import * as binance from './binance.service.js';
import * as synthetic from './synthetic.service.js';
import { broadcast } from '../websocket/wsServer.js';
import { getModeledDerivatives } from './synthetic.service.js';

async function currentPrice(symbol) {
  try {
    const { candles } = await binance.getKlines(symbol, '5m', 3);
    return candles[candles.length - 1].close;
  } catch {
    const cs = synthetic.getSyntheticKlines(symbol, '5m', 3);
    return cs[cs.length - 1].close;
  }
}

export async function getDesk(userId) {
  const account = await PaperAccount.ensure(userId);
  const open = await PaperTrade.findOpen(userId);

  const marks = {};
  for (const t of open) {
    if (marks[t.symbol] == null) marks[t.symbol] = await currentPrice(t.symbol);
  }
  const openWithMarks = open.map((t) => {
    const mark = marks[t.symbol] ?? t.entry;
    const unreal = (t.side === 'LONG' ? mark - t.entry : t.entry - mark) * t.quantity;
    return {
      ...t,
      mark,
      unrealizedPnl: unreal,
      unrealizedPct: (unreal / t.notional) * 100,
    };
  });

  const closed = await PaperTrade.findClosed(userId, 60);

  const wins = closed.filter((t) => (t.pnl ?? 0) > 0);
  const grossWin = wins.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const grossLoss = Math.abs(
    closed.filter((t) => (t.pnl ?? 0) <= 0).reduce((s, t) => s + (t.pnl ?? 0), 0)
  );

  return {
    account,
    open: openWithMarks,
    closed,
    stats: {
      closedCount: closed.length,
      winRate: closed.length ? (wins.length / closed.length) * 100 : 0,
      totalPnl: closed.reduce((s, t) => s + (t.pnl ?? 0), 0),
      profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99 : 0,
      unrealized: openWithMarks.reduce((s, t) => s + t.unrealizedPnl, 0),
      exposure: openWithMarks.reduce((s, t) => s + t.notional, 0),
    },
  };
}

export async function openPaperTrade(userId, body) {
  const { symbol, side, riskPct, tp: tpArg, sl: slArg, signalId } = body;

  const openCount = await PaperTrade.countOpen(userId);
  if (openCount[0].n >= 8) {
    throw new ApiError(400, 'Max 8 concurrent paper positions');
  }

  const account = await PaperAccount.ensure(userId);
  const balance = account.balance;

  const price = await currentPrice(symbol);

  let tp = tpArg ?? null;
  let sl = slArg ?? null;

  if (signalId) {
    const s = await Signal.findById(signalId);
    if (s) {
      tp = tp ?? s.tp1;
      sl = sl ?? s.stop_loss;
    }
  }
  if (!sl) sl = side === 'LONG' ? price * 0.986 : price * 1.014;
  if (!tp) tp = side === 'LONG' ? price * 1.021 : price * 0.979;

  const pct = Math.min(Math.max(riskPct ?? TRADING.riskPerTradePct, 0.25), 5);
  const riskUsd = balance * (pct / 100);
  const stopDist = Math.abs(price - sl);
  if (stopDist / price < 0.0005) {
    throw new ApiError(400, 'Stop loss too tight');
  }

  const quantity = riskUsd / stopDist;
  const notional = quantity * price;
  const fees = notional * (TRADING.takerFeeBps / 10000);

  const id = await PaperTrade.insert({
    userId, signalId: signalId ?? null,
    symbol, side, entry: price,
    quantity, notional, tp, sl, fees,
  });

  broadcast('paper', { action: 'opened', id, symbol, side });
  return { id, symbol, side, entry: price, quantity, notional, tp, sl };
}

export async function closePaperTrade(userId, id, reason = 'MANUAL') {
  const trade = await PaperTrade.findById(id);
  if (!trade || trade.user_id !== userId || trade.status !== 'OPEN') {
    throw new ApiError(404, 'Open trade not found');
  }

  const exitPrice = await currentPrice(trade.symbol);
  const exitFee = trade.notional * (TRADING.takerFeeBps / 10000);
  const grossPnl =
    (trade.side === 'LONG' ? exitPrice - trade.entry : trade.entry - exitPrice) *
    trade.quantity;
  const pnl = grossPnl - exitFee;
  const pnlPct = (pnl / trade.notional) * 100;

  await PaperTrade.close(id, {
    exitPrice,
    pnl,
    pnlPct,
    reason,
    fees: trade.fees + exitFee,
  });

  const account = await PaperAccount.findByUser(userId);
  await PaperAccount.updateBalance(userId, {
    balance: account.balance + pnl,
    realizedPnl: account.realized_pnl + pnl,
  });

  broadcast('paper', { action: 'closed', id, pnl });
  return { ok: true, pnl, exitPrice };
}

export async function resetAccount(userId) {
  await PaperTrade.deleteAllForUser(userId);
  await PaperAccount.reset(userId);
  return { ok: true, balance: TRADING.initialPaperBalance };
}

/* ------------------------- settle open positions ------------------------- */

let lastSettle = 0;

export async function settlePaperTrades() {
  if (Date.now() - lastSettle < 30_000) return;
  lastSettle = Date.now();

  const open = await PaperTrade.findAllOpen();
  for (const t of open) {
    if (!t.tp || !t.sl) continue;

    let candles;
    try {
      candles = (await binance.getKlines(t.symbol, '5m', 300)).candles;
    } catch {
      candles = synthetic.getSyntheticKlines(t.symbol, '5m', 300);
    }

    const openSec = Math.floor(new Date(t.opened_at).getTime() / 1000);
    const after = candles.filter((c) => c.time > openSec);
    if (!after.length) continue;

    let exit = null, reason = null, exitTime = after[after.length - 1].time;
    for (const bar of after) {
      if (t.side === 'LONG') {
        if (bar.low <= t.sl) { exit = t.sl; reason = 'SL'; exitTime = bar.time; break; }
        if (bar.high >= t.tp) { exit = t.tp; reason = 'TP'; exitTime = bar.time; break; }
      } else {
        if (bar.high >= t.sl) { exit = t.sl; reason = 'SL'; exitTime = bar.time; break; }
        if (bar.low <= t.tp) { exit = t.tp; reason = 'TP'; exitTime = bar.time; break; }
      }
    }

    if (exit !== null && reason) {
      const exitFee = t.notional * (TRADING.takerFeeBps / 10000);
      const pnl =
        (t.side === 'LONG' ? exit - t.entry : t.entry - exit) * t.quantity - exitFee;
      const pnlPct = (pnl / t.notional) * 100;

      await PaperTrade.close(t.id, {
        exitPrice: exit,
        pnl,
        pnlPct,
        reason,
        fees: t.fees + exitFee,
      });

      const account = await PaperAccount.findByUser(t.user_id);
      await PaperAccount.updateBalance(t.user_id, {
        balance: account.balance + pnl,
        realizedPnl: account.realized_pnl + pnl,
      });

      broadcast('paper', { action: 'auto-closed', id: t.id, reason, pnl });
    }
  }
}