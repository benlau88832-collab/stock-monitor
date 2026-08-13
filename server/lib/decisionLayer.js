// ============================================================
// server/lib/decisionLayer.js —— 决策直达数据装配层（v9.116.0，S2-1）
// v9.123.0（卓越审查 P0-1/P0-2）：
//   P0-1 个股数据真实装配——原只传 {code}，tactics 三件（买点/梯队位置/诱多个股）在生产名存实亡；
//        现装配 name/pct/price/turnoverRate/mainNet/limitUp（stockSnapshot.js：push2delay→腾讯，失败降级 {code}）
//        + relay（PG zt_snapshot 今日池，PG-first）。
//   P0-2 认知表权威优先——原每次调用 buildBrainContext 全量重建（10+ PG 并行查询）+ version=0 绕过认知表；
//        现 latestCognition 优先（cron 5min 权威），表空才重建+落库（与 /api/cognition 同源，version/hash golden）。
// 不经过 LLM → 秒级、永不降级（决策窗口 9:25/13:00 刚需）。
// 前端等价：src/lib/decisions/kernel.ts（同规则双端同构）。
// ============================================================
const { getFreshCognition } = require("./cognition");
const { pool } = require("../db");
const { composeDecisionCore, cognSubset } = require("./decisionCore");
const { fetchStockSnapshotServer } = require("./stockSnapshot");

/** 决策直达入口：{code?, mainline?} → 五支柱裁决 + 游资战术（PG 认知权威 + 个股快照装配）
 * @param {object} input {code?, mainline?}
 * @param {object} [dbPool] 依赖注入（单测用；缺省 server/db.js pool）
 */
async function composeDecision(input = {}, dbPool = null) {
  const t0 = Date.now();
  const p = dbPool || pool; // v9.123.0（卓越审查 P0-2 测试性）：pool 可注入
  // v9.128.0（一致性审查 P0-3）：getFreshCognition —— 盘中陈旧 >30min 即时重建（不重建 brainContext 双份聚合）
  const cog = await getFreshCognition(p);
  const date = typeof cog.asOf === "string" ? cog.asOf.slice(0, 10) : null;
  // v9.123.0（卓越审查 P0-1）：个股数据真实装配（装配失败 → 保留 {code} 降级，永不崩）
  let stock = null;
  if (input.code) {
    stock = { code: String(input.code) };
    try {
      const snap = await fetchStockSnapshotServer(String(input.code));
      if (snap && typeof snap === "object") {
        let relay = 1;
        try {
          const ds = date ?? new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
          const r = await p.query(`SELECT data FROM zt_snapshot WHERE date=$1 LIMIT 1`, [ds]);
          const rawData = r.rows?.[0]?.data;
          const poolArr = Array.isArray(rawData) ? rawData : rawData?.pool;
          const row = (poolArr ?? []).find((pp) => String(pp?.c ?? pp?.code) === String(input.code));
          if (row) relay = Number(row.lbc) || 1;
        } catch { /* relay 查询失败用 1 */ }
        stock = {
          ...stock,
          name: snap.name || null,
          pct: snap.pct ?? null,
          price: snap.price ?? null,
          turnoverRate: snap.turnoverRate ?? null,
          mainNet: snap.mainNet ?? null,
          // v9.123.0（卓越审查 P0-1）：涨停判定用 9.5% 近似（创业板/科创板 20cm 口径另算，caliber 已注明）
          limitUp: typeof snap.pct === "number" && snap.pct >= 9.5,
          relay,
        };
      }
    } catch { /* 装配失败 → 保留 {code} 降级 */ }
  }
  // v9.121.0（卓越 S2-1b）+ v9.123.0（P1-1）：真实时段注入（buyPoint 竞价判断用；session 经 cognSubset 透传）
  const { currentSession } = require("./proactiveSession");
  const v = composeDecisionCore(stock, cognSubset(cog), { riskAppetite: "短线" }, currentSession().phase);
  return { ...v, latencyMs: Date.now() - t0, asOf: cog?.asOf ?? date };
}

module.exports = { composeDecision };
