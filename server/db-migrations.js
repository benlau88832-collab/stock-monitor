// ============================================================
// v9.142.0 可操作闭环迁移：logic_ledger + simulated 口径
// 独立于 db.js 的历史 SCHEMA，避免改坏既有建表脚本。
// ============================================================
const { pool } = require("./db");

const LOGIC_LEDGER_SQL = `
CREATE TABLE IF NOT EXISTS logic_ledger (
  id                SERIAL PRIMARY KEY,
  code              TEXT NOT NULL,
  name              TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT '验证中' CHECK (status IN ('验证中','已兑现','已证伪','已离场')),
  thesis            TEXT NOT NULL,
  catalysts         JSONB NOT NULL DEFAULT '[]'::jsonb,
  break_line        NUMERIC,
  board             TEXT,
  decision_ref      TEXT,
  trade_ref         INTEGER,
  simulated         BOOLEAN DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_logic_code_status ON logic_ledger(code, status);
`;

async function runMigrations() {
  await pool.query(LOGIC_LEDGER_SQL);
  await pool.query(`ALTER TABLE trade_ledger ADD COLUMN IF NOT EXISTS simulated BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE decision_post ADD COLUMN IF NOT EXISTS simulated BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE decision_post ADD COLUMN IF NOT EXISTS pnl_t20 DOUBLE PRECISION`);
  await pool.query(`ALTER TABLE decision_post ADD COLUMN IF NOT EXISTS pnl_t60 DOUBLE PRECISION`);
  await pool.query(`ALTER TABLE decision_post ADD COLUMN IF NOT EXISTS pnl_source TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_logic_updated ON logic_ledger(updated_at DESC)`);
  console.log("[db-migrations] logic_ledger/simulated ready");
}

module.exports = { runMigrations };
