// ============================================================
// server/lib/pushDedup.js —— 跨引擎推送统一冷却（v9.130.0，终审 N7）
// 背景：盘中精灵（intradaySprint）与盘中大脑（runIntradayBrain）双引擎各自
//   sendPushIfConfigured，同板块同类告警可能 30 分钟内双推。
// 本模块：kv push_seen:日期:severity:board 共享冷却——两引擎共用同一去重键，
//   首个命中者推送，30 分钟内同 severity+board 不再推。
// 失败放行（去重服务不可用不阻塞推送可用性）。
// ============================================================
const COOLDOWN_MS = 30 * 60 * 1000;

/** 是否允许推送（true=可推并占用冷却位；false=冷却期内跳过） */
async function shouldPush(pool, severity, board) {
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const key = `push_seen:${today}:${severity ?? "info"}:${board ?? ""}`;
  try {
    const r = await pool.query("SELECT value FROM kv_store WHERE key=$1", [key]).catch(() => ({ rows: [] }));
    const last = Number(r.rows[0]?.value ?? 0);
    if (Number.isFinite(last) && Date.now() - last < COOLDOWN_MS) return false;
    await pool.query(
      `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now())
       ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
      [key, Date.now()],
    ).catch(() => {});
    return true;
  } catch { return true; } // 去重服务失败 → 放行（可用性优先）
}

module.exports = { shouldPush };
