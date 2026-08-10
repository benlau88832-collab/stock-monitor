// ============================================================
// server/lib/pgLock.js —— PG advisory lock 跨进程互斥（P2-4）
// 背景：cronBusy/watchRunning/themeRunning/intradayBusy 全是单进程布尔标志，
//   PM2 cluster / Docker 多副本部署时互斥失效 → 任务重复执行、LLM 重复计费。
// PG advisory lock 是数据库级锁：所有进程共享同一 PG 即共享同一把锁。
// 语义：
//   - withPgLock(pool, key, fn)：尝试获取锁；获取不到返回 false（任务跳过/409）；
//     获取成功执行 fn 后释放（必须同一连接）。
//   - 进程崩溃/连接断开 → 锁自动释放（天然防死锁）。
// 锁 key 为稳定整数（每类任务一个，防误撞）。
// ============================================================

const LOCK_CRON_MAIN = 154001;   // 15:40 链 / 20min 链 / 启动补抓（三方互斥，保持 cronBusy 语义）
const LOCK_THEME     = 154002;   // themeAnalysis（cron 3 点 + 前端手动触发共用）
const LOCK_WATCH     = 154003;   // 盯价 5 分钟轮询
const LOCK_INTRADAY  = 154004;   // 盘中大脑
const LOCK_REVIEW    = 154005;   // 盘后复盘（v9.94.0：cron 15:40 链 + 前端手动触发共用）

/**
 * 尝试获取 advisory lock，返回持锁连接（调用方必须 finally 调 releaseLock）。
 * 用于"响应先行 + 后台任务持锁"场景（如 /api/theme-analysis/trigger）。
 * @returns {Promise<import("pg").PoolClient | null>} 持锁连接；锁被占用 → null
 */
async function acquireLock(pool, key) {
  const client = await pool.connect();
  try {
    const r = await client.query("SELECT pg_try_advisory_lock($1) AS ok", [key]);
    if (r.rows[0]?.ok !== true) { client.release(); return null; }
    return client;
  } catch (e) { client.release(); throw e; }
}

/** 释放 acquireLock 拿到的锁并归还连接（幂等安全） */
async function releaseLock(client, key) {
  try { await client.query("SELECT pg_advisory_unlock($1)", [key]); } catch { /* 连接释放时 PG 自动清理 */ }
  client.release();
}

/**
 * 在 PG advisory lock 保护下执行 fn（同步场景）。
 * @param {import("pg").Pool} pool
 * @param {number} key 锁 key（稳定整数）
 * @param {(client: import("pg").PoolClient) => Promise<any>} fn
 * @returns {Promise<boolean>} true=获取到锁并执行完成；false=锁被占用（未执行）
 */
async function withPgLock(pool, key, fn) {
  const client = await acquireLock(pool, key);
  if (!client) return false;
  try {
    await fn(client);
    return true;
  } finally {
    await releaseLock(client, key);
  }
}

module.exports = { withPgLock, acquireLock, releaseLock, LOCK_CRON_MAIN, LOCK_THEME, LOCK_WATCH, LOCK_INTRADAY, LOCK_REVIEW };
