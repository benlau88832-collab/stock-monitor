// ============================================================
// server/routes/cognition.js —— GET /api/cognition（v9.115.0，S1-1/S1-2）
// 全站唯一认知端点：优先读 cognition_snapshots 表最新行（cron 驱动刷新的权威版本，
//   version 单调递增、hash 随内容变化 —— 双端同构 golden 校验源）；
// v9.128.0（一致性审查 P0-3）：统一走 getFreshCognition —— 盘中陈旧 >30min 即时重建落库。
// v9.144.0：新增 POST /api/cognition/rebuild —— 用户可手动强制重建，不依赖自动窗口。
// ============================================================
const { pool } = require("../db");
const { getFreshCognition } = require("../lib/cognition");

/** 全站唯一认知（新鲜优先：盘中陈旧 >30min → 重建+落库） */
async function getCognition() {
  return getFreshCognition(pool);
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

  app.post("/api/cognition/rebuild", async (req, res) => {
    try {
      const { buildBrainContext } = require("../lib/brainContext");
      const { buildCognition, rawFromBrainContext, nextVersion, persistCognition } = require("../lib/cognition");
      const { currentSession } = require("../lib/proactiveSession");
      const ctx = await buildBrainContext(pool);
      const cog = buildCognition(rawFromBrainContext(ctx), await nextVersion(pool), currentSession());
      await persistCognition(pool, cog);
      res.json(cog);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
};

// 供其他路由/测试复用（/api/health 的 cognition check 等）
module.exports.getCognition = getCognition;
