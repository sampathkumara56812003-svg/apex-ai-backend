import { query, queryOne } from '../config/database.js';

export const Coin = {
  listActive: () =>
    query('SELECT * FROM coins WHERE active = 1 ORDER BY sort_order'),

  findBySymbol: (symbol) =>
    queryOne('SELECT * FROM coins WHERE symbol = ?', [symbol]),
};