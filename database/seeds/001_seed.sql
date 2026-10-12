USE apex_ai;

INSERT INTO users (username, email, password_hash, role) VALUES
('admin', 'admin@apex.local',
 '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
 'ADMIN');

INSERT INTO coins (symbol, base_asset, quote_asset, display_name, color, sort_order) VALUES
('BTCUSDT', 'BTC', 'USDT', 'Bitcoin',  '#f7931a', 1),
('ETHUSDT', 'ETH', 'USDT', 'Ethereum', '#8ba3f8', 2),
('SOLUSDT', 'SOL', 'USDT', 'Solana',   '#9d6bf5', 3),
('BNBUSDT', 'BNB', 'USDT', 'BNB',      '#f3ba2f', 4);

INSERT INTO paper_account (user_id, initial_balance, balance)
SELECT id, 10000, 10000 FROM users WHERE username = 'admin';

INSERT INTO user_settings (user_id, settings)
SELECT id, JSON_OBJECT('theme','dark','notifications', true)
FROM users WHERE username = 'admin';