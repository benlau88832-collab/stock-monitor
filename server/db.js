// ============================================================
// stock-monitor 本地服务端 · 数据库层
// PostgreSQL 16 (stock_monitor 库) · node-postgres 连接池
// ============================================================
const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgres://postgres:StockMonitor2026@127.0.0.1:5432/stock_monitor",
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
CREATE INDEX IF NOT EXISTS idx_news_time ON news(time);
CREATE INDEX IF NOT EXISTS idx_ann_time ON announcements(time);
`;

async function initDb() {
  await pool.query(SCHEMA);
  console.log("[db] schema ready");
}

module.exports = { pool, initDb };
