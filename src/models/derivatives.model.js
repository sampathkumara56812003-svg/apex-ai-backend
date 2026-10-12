import { query } from '../config/database.js';

export const Derivatives = {
  insert: (data) =>
    query(
      `INSERT INTO derivatives
        (symbol, snapshot_time, funding_rate, open_interest, open_interest_change,
         long_short_ratio, liquidation_volume, mark_price, basis, source)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
        funding_rate = VALUES(funding_rate),
        open_interest = VALUES(open_interest)`,
      [
        data.symbol, data.snapshotTime, data.fundingRate ?? null,
        data.openInterest ?? null, data.openInterestChange ?? null,
        data.longShortRatio ?? null, data.liquidationVolume ?? null,
        data.markPrice ?? null, data.basis ?? null, data.source,
      ]
    ),

  latest: (symbol) =>
    query(
      'SELECT * FROM derivatives WHERE symbol = ? ORDER BY snapshot_time DESC LIMIT 1',
      [symbol]
    ),
};