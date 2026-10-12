CREATE DATABASE IF NOT EXISTS apex_ai
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE apex_ai;

CREATE TABLE users (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username        VARCHAR(50)  NOT NULL UNIQUE,
  email           VARCHAR(120) NOT NULL UNIQUE,
  password_hash   VARCHAR(255) NOT NULL,
  role            ENUM('ADMIN','USER') NOT NULL DEFAULT 'USER',
  is_active       TINYINT(1)   NOT NULL DEFAULT 1,
  last_login_at   DATETIME     NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_users_email (email)
) ENGINE=InnoDB;

CREATE TABLE refresh_tokens (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id      BIGINT UNSIGNED NOT NULL,
  token        VARCHAR(500) NOT NULL UNIQUE,
  expires_at   DATETIME     NOT NULL,
  revoked      TINYINT(1)   NOT NULL DEFAULT 0,
  user_agent   VARCHAR(255) NULL,
  ip_address   VARCHAR(45)  NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_rt_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_rt_user (user_id),
  INDEX idx_rt_expires (expires_at)
) ENGINE=InnoDB;

CREATE TABLE password_resets (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT UNSIGNED NOT NULL,
  token       VARCHAR(255) NOT NULL UNIQUE,
  expires_at  DATETIME     NOT NULL,
  used        TINYINT(1)   NOT NULL DEFAULT 0,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pr_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE coins (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  symbol       VARCHAR(20)  NOT NULL UNIQUE,
  base_asset   VARCHAR(10)  NOT NULL,
  quote_asset  VARCHAR(10)  NOT NULL,
  display_name VARCHAR(60)  NOT NULL,
  color        VARCHAR(9)   NULL,
  active       TINYINT(1)   NOT NULL DEFAULT 1,
  sort_order   INT          NOT NULL DEFAULT 0,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE ohlcv (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  symbol      VARCHAR(20)   NOT NULL,
  timeframe   VARCHAR(5)    NOT NULL,
  open_time   BIGINT        NOT NULL,
  open        DECIMAL(20,8) NOT NULL,
  high        DECIMAL(20,8) NOT NULL,
  low         DECIMAL(20,8) NOT NULL,
  close       DECIMAL(20,8) NOT NULL,
  volume      DECIMAL(20,8) NOT NULL,
  quote_vol   DECIMAL(20,8) NULL,
  trades      INT UNSIGNED  NULL,
  source      ENUM('BINANCE','SIMULATION') NOT NULL DEFAULT 'BINANCE',
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_ohlcv (symbol, timeframe, open_time),
  INDEX idx_ohlcv_lookup (symbol, timeframe, open_time DESC)
) ENGINE=InnoDB;

CREATE TABLE technical_features (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  symbol         VARCHAR(20)  NOT NULL,
  timeframe      VARCHAR(5)   NOT NULL,
  open_time      BIGINT       NOT NULL,
  rsi            DECIMAL(10,4) NULL,
  macd           DECIMAL(20,8) NULL,
  macd_signal    DECIMAL(20,8) NULL,
  macd_hist      DECIMAL(20,8) NULL,
  ema20          DECIMAL(20,8) NULL,
  ema50          DECIMAL(20,8) NULL,
  ema200         DECIMAL(20,8) NULL,
  atr            DECIMAL(20,8) NULL,
  atr_pct        DECIMAL(10,6) NULL,
  adx            DECIMAL(10,4) NULL,
  plus_di        DECIMAL(10,4) NULL,
  minus_di       DECIMAL(10,4) NULL,
  vwap           DECIMAL(20,8) NULL,
  bb_upper       DECIMAL(20,8) NULL,
  bb_middle      DECIMAL(20,8) NULL,
  bb_lower       DECIMAL(20,8) NULL,
  bb_position    DECIMAL(6,4)  NULL,
  obv_slope      DECIMAL(10,6) NULL,
  stoch_k        DECIMAL(10,4) NULL,
  stoch_d        DECIMAL(10,4) NULL,
  roc            DECIMAL(10,6) NULL,
  volume_ratio   DECIMAL(10,4) NULL,
  volatility_pct DECIMAL(10,6) NULL,
  support        DECIMAL(20,8) NULL,
  resistance     DECIMAL(20,8) NULL,
  structure      ENUM('HH','HL','LH','LL','RANGE') NULL,
  regime         ENUM('STRONG_BULL','WEAK_BULL','SIDEWAYS','WEAK_BEAR','STRONG_BEAR','HIGH_VOLATILITY','LOW_VOLATILITY') NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_features (symbol, timeframe, open_time)
) ENGINE=InnoDB;

CREATE TABLE derivatives (
  id                    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  symbol                VARCHAR(20) NOT NULL,
  snapshot_time         BIGINT      NOT NULL,
  funding_rate          DECIMAL(12,8) NULL,
  open_interest         DECIMAL(24,4) NULL,
  open_interest_change  DECIMAL(10,4) NULL,
  long_short_ratio      DECIMAL(10,4) NULL,
  liquidation_volume    DECIMAL(24,4) NULL,
  mark_price            DECIMAL(20,8) NULL,
  basis                 DECIMAL(10,6) NULL,
  source                ENUM('LIVE','MODELED') NOT NULL DEFAULT 'LIVE',
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_deriv (symbol, snapshot_time)
) ENGINE=InnoDB;

CREATE TABLE order_book_snapshots (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  symbol          VARCHAR(20) NOT NULL,
  snapshot_time   BIGINT      NOT NULL,
  bid_volume      DECIMAL(24,8) NULL,
  ask_volume      DECIMAL(24,8) NULL,
  imbalance       DECIMAL(6,4)  NULL,
  spread_pct      DECIMAL(10,6) NULL,
  buy_wall_price  DECIMAL(20,8) NULL,
  buy_wall_size   DECIMAL(20,8) NULL,
  sell_wall_price DECIMAL(20,8) NULL,
  sell_wall_size  DECIMAL(20,8) NULL,
  depth_json      JSON NULL,
  source          ENUM('LIVE','MODELED') NOT NULL DEFAULT 'LIVE',
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_ob (symbol, snapshot_time)
) ENGINE=InnoDB;

CREATE TABLE signals (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id           BIGINT UNSIGNED NULL,
  symbol            VARCHAR(20)  NOT NULL,
  timeframe         VARCHAR(5)   NOT NULL,
  direction         ENUM('LONG','SHORT','WAIT','NO_TRADE') NOT NULL,
  strength          ENUM('WEAK','STRONG','VERY_STRONG') NULL,
  probability       DECIMAL(6,4) NOT NULL,
  raw_probability   DECIMAL(6,4) NOT NULL,
  confidence        ENUM('LOW','MEDIUM','HIGH') NOT NULL,
  confidence_score  DECIMAL(6,4) NULL,
  risk              ENUM('LOW','MEDIUM','HIGH','EXTREME') NOT NULL,
  risk_score        DECIMAL(6,2) NULL,
  regime            VARCHAR(30)  NOT NULL,
  price             DECIMAL(20,8) NOT NULL,
  entry             DECIMAL(20,8) NULL,
  tp1               DECIMAL(20,8) NULL,
  tp2               DECIMAL(20,8) NULL,
  stop_loss         DECIMAL(20,8) NULL,
  risk_reward       DECIMAL(10,4) NULL,
  model_probs       JSON NULL,
  features          JSON NULL,
  reasons           JSON NOT NULL,
  warnings          JSON NOT NULL,
  horizon_bars      INT  NOT NULL DEFAULT 12,
  target_definition VARCHAR(255) NULL,
  data_source       ENUM('BINANCE','SIMULATION') NOT NULL DEFAULT 'BINANCE',
  model_version     VARCHAR(30)  NOT NULL,
  status            ENUM('ACTIVE','WIN','LOSS','EXPIRED','CANCELLED') NOT NULL DEFAULT 'ACTIVE',
  exit_price        DECIMAL(20,8) NULL,
  pnl_pct           DECIMAL(10,4) NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at       DATETIME NULL,
  INDEX idx_sig_user (user_id, created_at DESC),
  INDEX idx_sig_status (user_id, status),
  INDEX idx_sig_symbol (symbol, timeframe, status)
) ENGINE=InnoDB;

CREATE TABLE signal_results (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  signal_id       BIGINT UNSIGNED NOT NULL,
  actual_result   ENUM('WIN','LOSS','EXPIRED','CANCELLED') NOT NULL,
  target_hit      TINYINT(1) NOT NULL DEFAULT 0,
  stop_hit        TINYINT(1) NOT NULL DEFAULT 0,
  profit_loss     DECIMAL(20,8) NULL,
  profit_loss_pct DECIMAL(10,4) NULL,
  bars_held       INT NULL,
  completed_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sr_signal FOREIGN KEY (signal_id) REFERENCES signals(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE backtests (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id        BIGINT UNSIGNED NULL,
  symbol         VARCHAR(20) NOT NULL,
  timeframe      VARCHAR(5)  NOT NULL,
  bars           INT NOT NULL,
  params         JSON NOT NULL,
  metrics        JSON NOT NULL,
  equity_curve   JSON NULL,
  trades_count   INT NOT NULL DEFAULT 0,
  data_source    ENUM('BINANCE','SIMULATION') NOT NULL DEFAULT 'BINANCE',
  model_version  VARCHAR(30) NOT NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_bt_user (user_id, created_at DESC)
) ENGINE=InnoDB;

CREATE TABLE backtest_trades (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  backtest_id    BIGINT UNSIGNED NOT NULL,
  entry_time     BIGINT NOT NULL,
  exit_time      BIGINT NOT NULL,
  side           ENUM('LONG','SHORT') NOT NULL,
  entry          DECIMAL(20,8) NOT NULL,
  exit_price     DECIMAL(20,8) NOT NULL,
  pnl_pct        DECIMAL(10,4) NOT NULL,
  pnl_usd        DECIMAL(20,8) NULL,
  exit_reason    ENUM('TP1','TP2','SL','TIMEOUT') NOT NULL,
  probability    DECIMAL(6,4) NULL,
  CONSTRAINT fk_bt_trade FOREIGN KEY (backtest_id) REFERENCES backtests(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE paper_account (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id           BIGINT UNSIGNED NOT NULL UNIQUE,
  initial_balance   DECIMAL(20,8) NOT NULL DEFAULT 10000.00000000,
  balance           DECIMAL(20,8) NOT NULL DEFAULT 10000.00000000,
  realized_pnl      DECIMAL(20,8) NOT NULL DEFAULT 0.00000000,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_pa_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE paper_trades (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id       BIGINT UNSIGNED NOT NULL,
  signal_id     BIGINT UNSIGNED NULL,
  symbol        VARCHAR(20) NOT NULL,
  side          ENUM('LONG','SHORT') NOT NULL,
  entry         DECIMAL(20,8) NOT NULL,
  exit_price    DECIMAL(20,8) NULL,
  quantity      DECIMAL(24,8) NOT NULL,
  notional      DECIMAL(24,8) NOT NULL,
  tp            DECIMAL(20,8) NULL,
  sl            DECIMAL(20,8) NULL,
  fees          DECIMAL(20,8) NOT NULL DEFAULT 0,
  pnl           DECIMAL(20,8) NULL,
  pnl_pct       DECIMAL(10,4) NULL,
  status        ENUM('OPEN','CLOSED') NOT NULL DEFAULT 'OPEN',
  close_reason  ENUM('MANUAL','TP','SL','TIMEOUT') NULL,
  opened_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at     DATETIME NULL,
  CONSTRAINT fk_pt_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_pt_user_status (user_id, status)
) ENGINE=InnoDB;

CREATE TABLE watchlist (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT UNSIGNED NOT NULL,
  symbol      VARCHAR(20) NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_watch (user_id, symbol),
  CONSTRAINT fk_wl_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE alerts (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id        BIGINT UNSIGNED NOT NULL,
  symbol         VARCHAR(20) NULL,
  alert_type     ENUM('SIGNAL','PRICE','PERFORMANCE') NOT NULL,
  condition_json JSON NOT NULL,
  channel        ENUM('PUSH','EMAIL','TELEGRAM') NOT NULL,
  is_active      TINYINT(1) NOT NULL DEFAULT 1,
  last_fired_at  DATETIME NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_al_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE user_settings (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    BIGINT UNSIGNED NOT NULL UNIQUE,
  settings   JSON NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_us_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE audit_logs (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT UNSIGNED NULL,
  action      VARCHAR(80) NOT NULL,
  entity      VARCHAR(60) NULL,
  entity_id   VARCHAR(60) NULL,
  metadata    JSON NULL,
  ip_address  VARCHAR(45) NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_user (user_id, created_at DESC)
) ENGINE=InnoDB;