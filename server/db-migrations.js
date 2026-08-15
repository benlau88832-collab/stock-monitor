// ============================================================
// v9.142.0 可操作闭环迁移：logic_ledger + simulated 口径
// 独立于 db.js 的历史 SCHEMA，避免改坏既有建表脚本。
// v9.147.0（数据基建·阶段一）：kline_daily（本地日K缓存）+ swing_signals（波段信号闭环）
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

// v9.145.0（P2）：本地 SQL 基本面历史 / 催化剂日历 / cron checkpoint
const FUNDAMENTAL_HISTORY_SQL = `
CREATE TABLE IF NOT EXISTS fundamental_history (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT,
  report_date DATE NOT NULL,
  roe NUMERIC,
  debt NUMERIC,
  gross NUMERIC,
  rev_yoy NUMERIC,
  profit_yoy NUMERIC,
  eps NUMERIC,
  cash_ps NUMERIC,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(code, report_date)
);
`;

const CATALYST_CALENDAR_SQL = `
CREATE TABLE IF NOT EXISTS catalyst_calendar (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT,
  type TEXT NOT NULL,
  title TEXT,
  event_date DATE NOT NULL,
  source TEXT,
  status TEXT DEFAULT 'scheduled',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(code, type, event_date, title)
);
CREATE INDEX IF NOT EXISTS idx_catalyst_code_date ON catalyst_calendar(code, event_date);
`;

const CRON_CHECKPOINT_SQL = `
CREATE TABLE IF NOT EXISTS cron_checkpoint (
  task TEXT PRIMARY KEY,
  last_start TIMESTAMPTZ,
  last_end TIMESTAMPTZ,
  last_status TEXT,
  last_error TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);
`;

// v9.146.0（第三轮报告执行）：AI-Swing 留痕表（服务端波段决策审计）
const AI_DECISION_LOG_SQL = `
CREATE TABLE IF NOT EXISTS ai_decision_log (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  verdict TEXT,
  score NUMERIC,
  holding_horizon_days INTEGER,
  review_cycle_days INTEGER,
  source TEXT NOT NULL DEFAULT 'AI-Swing',
  from_llm BOOLEAN NOT NULL DEFAULT true,
  llm_error TEXT,
  raw_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_adl_code_ts ON ai_decision_log(code, ts DESC);
CREATE INDEX IF NOT EXISTS idx_adl_source_ts ON ai_decision_log(source, ts DESC);
`;

// v9.146.0（第三轮报告执行）：独立基本面研判留痕
const FUNDAMENTAL_JUDGMENT_SQL = `
CREATE TABLE IF NOT EXISTS fundamental_judgment (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  quality_score INTEGER,
  valuation TEXT,
  key_points JSONB DEFAULT '[]'::jsonb,
  raw_json JSONB,
  source TEXT DEFAULT 'AI-Swing'
);
CREATE INDEX IF NOT EXISTS idx_fj_code_ts ON fundamental_judgment(code, ts DESC);
`;

// v9.147.0（数据基建·阶段一）：本地日K落库 —— 通达信 .day 全市场导入 + 增量更新
// 背景：波段决策卡 K 线实时抓 push2his（断源时"K线数据不足<30根"），600487 本地有 5401 根却报错。
// 本表为 K 线权威缓存：读路径本地优先，实时源仅兜底回填。
// 复权口径：通达信 .day 为不复权原始价；实时回填（腾讯 fqkline qfq）为前复权 ——
//   swingStage 仅用 MA 排列/平台/突破形态，短窗口内两者形态一致，注释声明口径差异。
const KLINE_DAILY_SQL = `
CREATE TABLE IF NOT EXISTS kline_daily (
  code       TEXT NOT NULL,
  date       TEXT NOT NULL,
  open       DOUBLE PRECISION,
  high       DOUBLE PRECISION,
  low        DOUBLE PRECISION,
  close      DOUBLE PRECISION,
  volume     DOUBLE PRECISION,
  amount     DOUBLE PRECISION,
  source     TEXT NOT NULL DEFAULT 'tdx',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (code, date)
);
CREATE INDEX IF NOT EXISTS idx_kline_code_date ON kline_daily(code, date DESC);
`;

// v9.147.0（阶段二B·波段信号闭环）：波段买点信号落库 + T+20/T+60 盈亏回填
// 信号来源：swing 决策 stage.buyPoint（放量首板/首板次日低吸/平台突破/主升回踩）
// 回填：cron 每日用本地 kline_daily 计算 T+20/T+60 收盘涨跌幅 → 胜率归因（样本≥10 才下结论）
const SWING_SIGNALS_SQL = `
CREATE TABLE IF NOT EXISTS swing_signals (
  id            SERIAL PRIMARY KEY,
  code          TEXT NOT NULL,
  name          TEXT,
  signal_type   TEXT NOT NULL,
  signal_date   TEXT NOT NULL,
  price         DOUBLE PRECISION,
  close_t20     DOUBLE PRECISION,
  close_t60     DOUBLE PRECISION,
  pnl_t20       DOUBLE PRECISION,
  pnl_t60       DOUBLE PRECISION,
  status        TEXT NOT NULL DEFAULT 'open',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(code, signal_type, signal_date)
);
CREATE INDEX IF NOT EXISTS idx_swsig_code ON swing_signals(code, signal_date DESC);
CREATE INDEX IF NOT EXISTS idx_swsig_type_date ON swing_signals(signal_type, signal_date);
`;

async function runMigrations() {
  await pool.query(LOGIC_LEDGER_SQL);
  await pool.query(DECISION_FEEDBACK_SQL);
  await pool.query(CHAIN_EVENT_SQL);
  await pool.query(FUNDAMENTAL_HISTORY_SQL);
  await pool.query(CATALYST_CALENDAR_SQL);
  await pool.query(CRON_CHECKPOINT_SQL);
  await pool.query(AI_DECISION_LOG_SQL);
  await pool.query(FUNDAMENTAL_JUDGMENT_SQL);
  await pool.query(KLINE_DAILY_SQL);
  await pool.query(SWING_SIGNALS_SQL);
  await pool.query(`ALTER TABLE trade_ledger ADD COLUMN IF NOT EXISTS simulated BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE decision_post ADD COLUMN IF NOT EXISTS simulated BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE logic_ledger ADD COLUMN IF NOT EXISTS invalidation_conditions JSONB DEFAULT '[]'::jsonb`);
  await pool.query(`ALTER TABLE logic_ledger ADD COLUMN IF NOT EXISTS review_cycle_days INTEGER DEFAULT 20`);
  await pool.query(`ALTER TABLE logic_ledger ADD COLUMN IF NOT EXISTS next_review_at DATE`);
  await pool.query(`ALTER TABLE decision_post ADD COLUMN IF NOT EXISTS pnl_t20 DOUBLE PRECISION`);
  await pool.query(`ALTER TABLE decision_post ADD COLUMN IF NOT EXISTS pnl_t60 DOUBLE PRECISION`);
  await pool.query(`ALTER TABLE decision_post ADD COLUMN IF NOT EXISTS pnl_source TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_logic_updated ON logic_ledger(updated_at DESC)`);
  console.log("[db-migrations] logic_ledger/simulated/chain_event/fundamental_history/catalyst/cron/ai_decision_log/fundamental_judgment/kline_daily/swing_signals ready");
}

module.exports = { runMigrations };
