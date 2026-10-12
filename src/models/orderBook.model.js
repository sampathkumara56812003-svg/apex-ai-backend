import { query } from '../config/database.js';

export const OrderBookSnapshot = {
  insert: (data) =>
    query(
      `INSERT INTO order_book_snapshots
        (symbol, snapshot_time, bid_volume, ask_volume, imbalance, spread_pct,
         buy_wall_price, buy_wall_size, sell_wall_price, sell_wall_size,
         depth_json, source)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE imbalance = VALUES(imbalance)`,
      [
        data.symbol, data.snapshotTime, data.bidVolume ?? null,
        data.askVolume ?? null, data.imbalance ?? null, data.spreadPct ?? null,
        data.buyWall?.price ?? null, data.buyWall?.size ?? null,
        data.sellWall?.price ?? null, data.sellWall?.size ?? null,
        data.depth ? JSON.stringify(data.depth) : null, data.source,
      ]
    ),
};