// ============================================================
// server/cron/klines.js —— 本地日K增量维护（v9.147.0 数据基建·阶段一）
// 职责（收盘后调用，失败不阻塞主链）：
//   ① 通达信 lday 增量导入（mtime 过滤 + 本地 max(date) 跳过，幂等）
//   ② 自选池/持仓/决策标的腾讯 qfq 兜底（本地 <30 根才拉）
// 背景：K 线权威缓存 = kline_daily 表；读路径本地优先（见 server/lib/klineDb.js）
// ============================================================
const { importTdxDir, syncWatchlistFromTencent } = require("../lib/klineDb");

const DEFAULT_TDX_VIPDOC = "F:/通达信金融终端(开心果整合版)V2025.08/vipdoc";

/** 收盘后增量：lday 增量（近 3 天 mtime）+ 自选池腾讯兜底 */
async function runKlineIncremental(pool) {
  const base = process.env.TDX_VIPDOC || DEFAULT_TDX_VIPDOC;
  const sinceMs = Date.now() - 3 * 86400000;
  const tdxStats = await importTdxDir(pool, base, { incremental: true, sinceMs }).catch((e) => {
    console.warn(`[cron] kline 通达信增量失败（不影响主链）:`, e?.message || e);
    return null;
  });
  if (tdxStats && tdxStats.files > 0) {
    console.log(`[cron] kline 通达信增量: files=${tdxStats.files} bars=${tdxStats.bars} skipped=${tdxStats.skippedFiles}`);
  }
  const wl = await syncWatchlistFromTencent(pool, 160).catch((e) => {
    console.warn(`[cron] kline 自选池腾讯兜底失败（不影响主链）:`, e?.message || e);
    return null;
  });
  return { tdx: tdxStats, watchlist: wl };
}

module.exports = { runKlineIncremental, TDX_VIPDOC_DEFAULT: DEFAULT_TDX_VIPDOC };
