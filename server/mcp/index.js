// ============================================================
// stock-monitor MCP server (v0.1.0 / v9.147.0 重建)
// Exposes local PostgreSQL as read-only SQL tools plus stable
// stock-monitor domain tools for DeepSeek Harness.
// Transport: stdio (spawned by @deepseek-ai/dsh-mcp-client)
// ============================================================
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const { pool } = require("../db");
const BASE_URL = process.env.SM_MCP_BASE_URL || `http://127.0.0.1:${process.env.PORT || 8080}`;
const READ_ONLY_PREFIX = /^\s*(select|with|explain)\b/i;
const WRITE_KEYWORDS = /\b(insert|update|delete|alter|drop|create|truncate|grant|revoke|copy|call|do|vacuum|reindex)\b/i;

function textResult(value) {
  return {
    content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
  };
}

async function getLocalToken() {
  if (process.env.LOCAL_TOKEN) return process.env.LOCAL_TOKEN;
  try {
    const r = await pool.query("SELECT value FROM kv_store WHERE key='local_token'");
    const v = r.rows[0]?.value;
    if (v && typeof v === "object" && "__raw" in v) return String(v.__raw);
    if (typeof v === "string") return v;
    return v?.token ? String(v.token) : null;
  } catch {
    return null;
  }
}

async function apiJson(apiPath, { method = "GET", body, timeoutMs = 60000 } = {}) {
  const token = await getLocalToken();
  const headers = { accept: "application/json" };
  if (token) headers["x-local-token"] = token;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${BASE_URL}${apiPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${apiPath}: ${JSON.stringify(json).slice(0, 500)}`);
  return json;
}

async function listPublicTables() {
  const r = await pool.query(
    `SELECT t.table_name,
            COALESCE(s.n_live_tup, 0) AS row_count
     FROM information_schema.tables t
     LEFT JOIN pg_stat_user_tables s
       ON s.schemaname = t.table_schema AND s.relname = t.table_name
     WHERE t.table_schema = 'public'
       AND t.table_type IN ('BASE TABLE', 'VIEW')
     ORDER BY t.table_name`,
  );
  return r.rows.map((x) => ({ table: x.table_name, rowCount: Number(x.row_count) || 0 }));
}

async function runReadOnlySql(rawSql, rawLimit) {
  const sql = String(rawSql || "").trim().replace(/;\s*$/, "");
  if (!sql) throw new Error("sql required");
  if (!READ_ONLY_PREFIX.test(sql)) {
    throw new Error("只允许 SELECT/WITH/EXPLAIN 只读查询");
  }
  if (WRITE_KEYWORDS.test(sql)) {
    throw new Error("检测到写语句关键字，已拒绝执行");
  }
  if (/;/.test(sql)) {
    throw new Error("只允许单条 SQL，不允许分号分隔多条语句");
  }
  const limit = Math.max(1, Math.min(200, Number(rawLimit) || 50));
  const r = await pool.query(sql);
  return { columns: r.fields.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })), rowCount: r.rowCount ?? 0, truncated: r.rowCount > limit, rows: r.rows.slice(0, limit) };
}

async function inspectTableSchema(table) {
  const t = String(table || "").trim();
  if (!t) throw new Error("table required");
  const schemaR = await pool.query(
    `SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
    [t],
  );
  const pkR = await pool.query(
    `SELECT a.attname FROM pg_index i
     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
     WHERE i.indrelid = $1::regclass AND i.indisprimary`,
    [t],
  );
  const countR = await pool.query(`SELECT count(*)::int AS n FROM ${t}`);
  return {
    table: t,
    rowCount: countR.rows[0]?.n ?? 0,
    columns: schemaR.rows,
    primaryKey: pkR.rows.map((x) => x.attname),
  };
}

async function queryKlineDaily(code, days) {
  const c = String(code || "").trim();
  if (!/^\d{6}$/.test(c)) throw new Error("code 需为 6 位数字");
  const r = await pool.query(
    `SELECT date, open, high, low, close, volume, amount, source FROM kline_daily
     WHERE code=$1 ORDER BY date DESC LIMIT $2`,
    [c, Math.max(1, Math.min(3000, Number(days) || 160))],
  );
  return { code: c, bars: r.rows };
}

async function healthSummary() {
  const [pg, localKlines, version] = await Promise.allSettled([
    pool.query("SELECT 1"),
    pool.query(`SELECT count(*)::int AS n, max(date) AS d1 FROM kline_daily`),
    apiJson("/api/health", { timeoutMs: 10000 }),
  ]);
  return {
    pg: pg.status === "fulfilled" ? { ok: true } : { ok: false, error: String(pg.reason?.message || pg.reason) },
    localKlines: localKlines.status === "fulfilled" ? { bars: localKlines.value.rows[0]?.n ?? 0, lastDate: localKlines.value.rows[0]?.d1 ?? null } : null,
    app: version.status === "fulfilled" ? { version: version.value?.version ?? null, ok: version.value?.ok ?? false } : null,
    at: new Date().toISOString(),
  };
}

// ---------------- domain tools (v9.147.0) ----------------
async function swingSignals() {
  return apiJson("/api/swing/signals?limit=50", { timeoutMs: 15000 });
}

async function portfolioOverview() {
  const r = await pool.query(
    `SELECT (SELECT count(*)::int FROM price_watch WHERE status='active') AS watch,
            (SELECT count(*)::int FROM logic_ledger WHERE status IN ('验证中','已兑现','已证伪')) AS logic,
            (SELECT count(*)::int FROM trade_ledger) AS trades,
            (SELECT count(*)::int FROM decision_post WHERE human_action='confirm' AND executed=true) AS executed`,
  );
  return r.rows[0];
}

async function swingDecision(code) {
  const c = String(code || "").trim();
  if (!/^\d{6}$/.test(c)) throw new Error("code 需为 6 位数字");
  return apiJson("/api/decisions/swing", { method: "POST", body: { code: c }, timeoutMs: 120000 });
}

// ============================================================
// Server registration
// ============================================================
const server = new McpServer({
  name: "stock-monitor",
  version: "0.1.0",
});

server.registerTool("sm_list_tables", { description: "列出 stock-monitor PostgreSQL 全部业务表及行数（只读）", inputSchema: z.object({}) }, async () => textResult(await listPublicTables()));

server.registerTool("sm_run_sql", { description: "对 stock-monitor PostgreSQL 执行只读 SQL（仅 SELECT/WITH/EXPLAIN，单条）", inputSchema: z.object({ sql: z.string().describe("只读 SQL"), limit: z.number().optional().describe("返回行数上限，默认 50") }) }, async (args) => textResult(await runReadOnlySql(args.sql, args.limit)));

server.registerTool("sm_inspect_schema", { description: "查看某张表的列结构/主键/行数", inputSchema: z.object({ table: z.string() }) }, async (args) => textResult(await inspectTableSchema(args.table)));

server.registerTool("sm_get_health", { description: "获取系统健康（PG/本地K线/应用版本）", inputSchema: z.object({}) }, async () => textResult(await healthSummary()));

server.registerTool("sm_get_cron_health", { description: "获取 cron 调度健康（表达式校验 + checkpoint）", inputSchema: z.object({}) }, async () => textResult(await apiJson("/api/health/cron", { timeoutMs: 10000 })));

server.registerTool("sm_get_kline", { description: "查询本地 kline_daily 日K（通达信导入，只读）", inputSchema: z.object({ code: z.string().describe("6 位股票代码"), days: z.number().optional().describe("返回最近 N 根，默认 160") }) }, async (args) => textResult(await queryKlineDaily(args.code, args.days)));

server.registerTool("sm_get_swing_decision", { description: "对单只股票生成波段决策（本地K线+产业链+AI研判）", inputSchema: z.object({ code: z.string().describe("6 位股票代码") }) }, async (args) => textResult(await swingDecision(args.code)));

server.registerTool("sm_get_swing_signals", { description: "波段信号胜率台账（T+20/T+60 回填）", inputSchema: z.object({}) }, async () => textResult(await swingSignals()));

server.registerTool("sm_get_portfolio", { description: "组合概览（盯盘/逻辑台账/成交/已执行决策）", inputSchema: z.object({}) }, async () => textResult(await portfolioOverview()));

// ============================================================
// Transport
// ============================================================
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[mcp] stock-monitor MCP server connected");
}

main().catch((e) => {
  console.error("[mcp] fatal:", e);
  process.exit(1);
});
