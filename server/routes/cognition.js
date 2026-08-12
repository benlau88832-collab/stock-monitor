// ============================================================
// server/routes/cognition.js —— GET /api/cognition（v9.115.0，S1-1/S1-2）
// 全站唯一认知端点：优先读 cognition_snapshots 表最新行（cron 驱动刷新的权威版本，
//   version 单调递增、hash 随内容变化 —— 双端同构 golden 校验源）；
// 表空（cron 尚未跑）→ 即时构建并落库（version = 表 max+1，与 cron 共用序列）。
// ============================================================
const { pool } = require("../db");
const { buildCognition, rawFromBrainContext, nextVersion, persistCognition, latestCognition } = require("../lib/cognition");
// v9.123.0（卓越审查 P1-1）：兜底构建时注入真实时段（此前硬编码"盘中"）
const { currentSession } = require("../lib/proactiveSession");

/** 全站唯一认知（表最新优先；无行则构建+落库） */
async function getCognition() {
  const latest = await latestCognition(pool);
  if (latest) return latest;
  const { buildBrainContext } = require("../lib/brainContext");
  const ctx = await buildBrainContext(pool);
  const ver = await nextVersion(pool);
  const cog = buildCognition(rawFromBrainContext(ctx), ver, currentSession());
  await persistCognition(pool, cog);
  return cog;
}

module.exports = function cognitionRoutes(app) {
  app.get("/api/cognition", async (req, res) => {
    try {
      const cog = await getCognition();
      res.json(cog);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
};

// 供其他路由/测试复用（/api/health 的 cognition check 等）
module.exports.getCognition = getCognition;
