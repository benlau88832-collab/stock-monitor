// ============================================================
// stock-monitor 本地服务端 · 数据库层
// PostgreSQL 16 (stock_monitor 库) · node-postgres 连接池
// v9.27（P0-2）：移除明文密码 fallback —— 密码只存在 server/.env（不入 git）
// ============================================================
const { Pool } = require("pg");
require("dotenv").config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("[db] DATABASE_URL 未配置（请复制 server/.env.example 为 server/.env 并填写）");
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// ============== 建表 ==============
const SCHEMA = `
CREATE TABLE IF NOT EXISTS news (
  code       TEXT PRIMARY KEY,
  title      TEXT,
  summary    TEXT,
  boards     JSONB DEFAULT '[]'::jsonb,
  sentiment  TEXT,
  stars      INT DEFAULT 1,
  is_overseas BOOLEAN DEFAULT false,
  time       TEXT,
  url        TEXT
);
CREATE TABLE IF NOT EXISTS announcements (
  art_code   TEXT PRIMARY KEY,
  stock_code TEXT,
  stock_name TEXT,
  title      TEXT,
  column_name TEXT,
  boards     JSONB DEFAULT '[]'::jsonb,
  score      INT,
  logic      TEXT,
  time       TEXT,
  url        TEXT
);
CREATE TABLE IF NOT EXISTS zt_snapshot (
  date       TEXT PRIMARY KEY,
  data       JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS kv_store (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);
-- v9.66：个股深度调研报告（三 skill 嵌入，全站 AI 助手产出）
CREATE TABLE IF NOT EXISTS research_reports (
  id           SERIAL PRIMARY KEY,
  code         TEXT NOT NULL,
  name         TEXT,
  report_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  phase        SMALLINT DEFAULT 0,
  summary_json JSONB,
  valuation_json JSONB,
  levels_json  JSONB,
  rr_json      JSONB,
  full_text    TEXT,
  created_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE(code, report_date)
);
-- v9.66：个股盯价监控清单（用户/AI 录入，零硬编码）
CREATE TABLE IF NOT EXISTS price_watch (
  id          SERIAL PRIMARY KEY,
  code        TEXT UNIQUE NOT NULL,
  name        TEXT,
  buy_low     NUMERIC,
  buy_high    NUMERIC,
  stop_loss   NUMERIC,
  trigger_pct NUMERIC DEFAULT 5,
  status      TEXT DEFAULT 'active',
  note        TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
-- v9.66：价格走势快照 + 触发事件（每日收盘 + 盘中）
CREATE TABLE IF NOT EXISTS price_watch_log (
  id            SERIAL PRIMARY KEY,
  code          TEXT NOT NULL,
  date          DATE NOT NULL DEFAULT CURRENT_DATE,
  price         NUMERIC,
  mid_price     NUMERIC,
  deviation_pct NUMERIC,
  triggered     BOOLEAN DEFAULT false,
  event_text    TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(code, date)
);
-- v9.66：盯价触发事件（前端轮询 → alertBus 强提示）
CREATE TABLE IF NOT EXISTS price_watch_events (
  id            SERIAL PRIMARY KEY,
  code          TEXT,
  name          TEXT,
  price         NUMERIC,
  mid_price     NUMERIC,
  deviation_pct NUMERIC,
  event_text    TEXT,
  read_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_news_time ON news(time);
CREATE INDEX IF NOT EXISTS idx_ann_time ON announcements(time);
CREATE INDEX IF NOT EXISTS idx_pwl_code_date ON price_watch_log(code, date);
-- P0-1：人类拍板台账（AI 提议 → 人类拍板闭环关键表）
CREATE TABLE IF NOT EXISTS decision_post (
  id              SERIAL PRIMARY KEY,
  date            TEXT NOT NULL,
  ts              TIMESTAMPTZ NOT NULL DEFAULT now(),
  ticket_id       TEXT NOT NULL UNIQUE,
  mainline        TEXT,
  code            TEXT,
  human_action    TEXT NOT NULL CHECK (human_action IN ('confirm','watch','reject')),
  confidence_at_post INTEGER,
  price_at_post   DOUBLE PRECISION,
  executed        BOOLEAN DEFAULT false,
  pnl             DOUBLE PRECISION,
  notes           TEXT,
  decision_log_ref TEXT
);
CREATE INDEX IF NOT EXISTS idx_dp_date ON decision_post(date);
CREATE INDEX IF NOT EXISTS idx_dp_code ON decision_post(code);
-- P0-3：成交台账（拍板后真实回填执行/平仓）
CREATE TABLE IF NOT EXISTS trade_ledger (
  id                SERIAL PRIMARY KEY,
  date              TEXT NOT NULL,
  ts                TIMESTAMPTZ NOT NULL DEFAULT now(),
  decision_post_ref TEXT,
  code              TEXT NOT NULL,
  name              TEXT,
  action            TEXT NOT NULL CHECK (action IN ('buy','sell','stop','adjust')),
  price             DOUBLE PRECISION NOT NULL,
  quantity          INTEGER DEFAULT 0,
  cost              DOUBLE PRECISION,
  pnl_pct           DOUBLE PRECISION,
  notes             TEXT
);
CREATE INDEX IF NOT EXISTS idx_tl_code ON trade_ledger(code);
CREATE INDEX IF NOT EXISTS idx_tl_date ON trade_ledger(date);
`;

async function initDb() {
  await pool.query(SCHEMA);
  console.log("[db] schema ready");
}

module.exports = { pool, initDb };
