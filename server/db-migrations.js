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
  closed_at         TIMESTAMPTZ,
  invalidation_conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
  review_cycle_days  INTEGER NOT NULL DEFAULT 20,
  next_review_at     DATE
);
CREATE INDEX IF NOT EXISTS idx_logic_code_status ON logic_ledger(code, status);
`;

const DECISION_FEEDBACK_SQL = `
CREATE TABLE IF NOT EXISTS decision_feedback (
  id             SERIAL PRIMARY KEY,
  ticket_id      TEXT,
  code           TEXT,
  mainline       TEXT,
  feedback       TEXT NOT NULL,
  attribution    TEXT,
  note           TEXT,
  created_at     TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_df_ticket ON decision_feedback(ticket_id);
`;

// v9.145.0（第二轮 P1-4）：产业链传导事件表，供“一次推理、多票复用”
const CHAIN_EVENT_SQL = `
CREATE TABLE IF NOT EXISTS industry_chain_event (
  id             SERIAL PRIMARY KEY,
  chain_id       TEXT NOT NULL,
  origin_node_id INTEGER,
  title          TEXT,
  summary        TEXT,
  impact_path    JSONB DEFAULT '[]'::jsonb,
  impacted_nodes JSONB DEFAULT '[]'::jsonb,
  confidence     INTEGER,
  model_generated BOOLEAN DEFAULT true,
  published_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ice_chain ON industry_chain_event(chain_id, published_at DESC);
`;

async function runMigrations() {
  await pool.query(LOGIC_LEDGER_SQL);
  await pool.query(DECISION_FEEDBACK_SQL);
  await pool.query(CHAIN_EVENT_SQL);
  await pool.query(`ALTER TABLE trade_ledger ADD COLUMN IF NOT EXISTS simulated BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE decision_post ADD COLUMN IF NOT EXISTS simulated BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE logic_ledger ADD COLUMN IF NOT EXISTS invalidation_conditions JSONB DEFAULT '[]'::jsonb`);
  await pool.query(`ALTER TABLE logic_ledger ADD COLUMN IF NOT EXISTS review_cycle_days INTEGER DEFAULT 20`);
  await pool.query(`ALTER TABLE logic_ledger ADD COLUMN IF NOT EXISTS next_review_at DATE`);
  await pool.query(`ALTER TABLE decision_post ADD COLUMN IF NOT EXISTS pnl_t20 DOUBLE PRECISION`);
  await pool.query(`ALTER TABLE decision_post ADD COLUMN IF NOT EXISTS pnl_t60 DOUBLE PRECISION`);
  await pool.query(`ALTER TABLE decision_post ADD COLUMN IF NOT EXISTS pnl_source TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_logic_updated ON logic_ledger(updated_at DESC)`);
  console.log("[db-migrations] logic_ledger/simulated/chain_event ready");
}

module.exports = { runMigrations };
