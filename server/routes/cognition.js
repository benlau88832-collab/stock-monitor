// ============================================================
// server/routes/cognition.js —— GET /api/cognition（v9.115.0，S1-1/S1-2）
// 全站唯一认知端点：优先读 cognition_snapshots 表最新行（cron 驱动刷新的权威版本，
//   version 单调递增、hash 随内容变化 —— 双端同构 golden 校验源）；
// v9.128.0（一致性审查 P0-3）：统一走 getFreshCognition —— 盘中陈旧 >30min 即时重建落库
//   （cron 认知链与精灵共享锁被 skip 时不再把昨夜数据喂给全站）。
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
};

// 供其他路由/测试复用（/api/health 的 cognition check 等）
module.exports.getCognition = getCognition;
