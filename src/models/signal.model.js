import { query, queryOne } from '../config/database.js';

export const Signal = {
  insert: async (data) => {
    const result = await query(
      `INSERT INTO signals
        (user_id, symbol, timeframe, direction, strength, probability,
         raw_probability, confidence, confidence_score, risk, risk_score,
         regime, price, entry, tp1, tp2, stop_loss, risk_reward,
         model_probs, features, reasons, warnings, horizon_bars,
         target_definition, data_source, model_version, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        data.userId ?? null,
        data.symbol, data.timeframe, data.direction, data.strength ?? null,
        data.probability, data.rawProbability, data.confidence,
        data.confidenceScore ?? null, data.risk, data.riskScore ?? null,
        data.regime, data.price, data.entry ?? null, data.tp1 ?? null,
        data.tp2 ?? null, data.stopLoss ?? null, data.riskReward ?? null,
        data.models ? JSON.stringify(data.models) : null,
        data.features ? JSON.stringify(data.features) : null,
        JSON.stringify(data.reasons || []),
        JSON.stringify(data.warnings || []),
        data.horizonBars, data.target ?? null,
        data.dataSource, data.modelVersion, data.status || 'ACTIVE',
      ]
    );
    return result.insertId;
  },

  findById: (id) => queryOne('SELECT * FROM signals WHERE id = ?', [id]),

  lastFor: (userId, symbol, timeframe) =>
    queryOne(
      `SELECT id, direction, status, created_at FROM signals
       WHERE user_id = ? AND symbol = ? AND timeframe = ?
       ORDER BY created_at DESC LIMIT 1`,
      [userId, symbol, timeframe]
    ),

  listActive: (userId) =>
    query(
      `SELECT * FROM signals WHERE user_id = ? AND status = 'ACTIVE'
       ORDER BY created_at DESC`,
      [userId]
    ),

  listResolved: (userId, limit = 200) =>
    query(
      `SELECT * FROM signals WHERE user_id = ?
       AND status IN ('WIN','LOSS','EXPIRED')
       ORDER BY resolved_at DESC LIMIT ?`,
      [userId, limit]
    ),

  listAll: (userId, filters = {}) => {
    const conds = ['user_id = ?'];
    const args = [userId];
    if (filters.status) { conds.push('status = ?'); args.push(filters.status); }
    if (filters.symbol) { conds.push('symbol = ?'); args.push(filters.symbol); }
    if (filters.direction) { conds.push('direction = ?'); args.push(filters.direction); }
    args.push(Math.min(filters.limit || 100, 500));
    return query(
      `SELECT * FROM signals WHERE ${conds.join(' AND ')}
       ORDER BY created_at DESC LIMIT ?`,
      args
    );
  },

  cancelActive: (id) =>
    query(
      "UPDATE signals SET status = 'CANCELLED', resolved_at = NOW() WHERE id = ?",
      [id]
    ),

  resolve: (id, { status, exitPrice, pnlPct, exitTime }) =>
    query(
      `UPDATE signals SET status = ?, exit_price = ?, pnl_pct = ?,
                          resolved_at = FROM_UNIXTIME(?)
       WHERE id = ?`,
      [status, exitPrice, pnlPct, exitTime, id]
    ),
};