// ============================================================
// server/scripts/tdx-import.js —— 通达信 .day 全市场日K导入（v9.147.0 数据基建·阶段一）
// 用法：
//   node scripts/tdx-import.js                全量导入（幂等，已有行跳过）
//   node scripts/tdx-import.js --force        全量导入（覆盖已有行）
//   node scripts/tdx-import.js --incremental  增量导入（mtime 过滤 + 本地 max(date) 跳过）
//   node scripts/tdx-import.js --since=2026-08-01  增量且仅处理 mtime 晚于该时间的文件
// 数据源：F:\通达信金融终端(开心果整合版)V2025.08\vipdoc\{sh,sz,bj}\lday\*.day
// 约 1.2 万文件 / 2900 万根日K，COPY 批量入库预计 1-3 分钟。
// ============================================================
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { pool } = require("../db");
const { importTdxDir } = require("../lib/klineDb");

const DEFAULT_TDX = "F:/通达信金融终端(开心果整合版)V2025.08/vipdoc";

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const incremental = args.includes("--incremental");
  const sinceArg = args.find((a) => a.startsWith("--since="));
  const sinceMs = sinceArg
    ? new Date(sinceArg.split("=")[1] + "T00:00:00+08:00").getTime()
    : Date.now() - 3 * 86400000; // 默认近 3 天
  const base = process.env.TDX_VIPDOC || DEFAULT_TDX;

  console.log(`[tdx-import] base=${base} force=${force} incremental=${incremental} since=${new Date(sinceMs).toISOString()}`);
  const t0 = Date.now();
  const stats = await importTdxDir(pool, base, { incremental, sinceMs, force });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[tdx-import] 完成 files=${stats.files} bars=${stats.bars} skipped=${stats.skippedFiles} errors=${stats.errors.length} 耗时=${secs}s`);
  if (stats.errors.length) {
    console.log("[tdx-import] 错误样例:", stats.errors.slice(0, 5));
  }
  const chk = await pool.query(`SELECT count(*)::int AS n, count(DISTINCT code)::int AS codes, min(date) AS d0, max(date) AS d1 FROM kline_daily`);
  console.log("[tdx-import] kline_daily 现状:", chk.rows[0]);
  await pool.end();
}

main().catch(async (e) => {
  console.error("[tdx-import] 失败:", e);
  try { await pool.end(); } catch {}
  process.exit(1);
});
