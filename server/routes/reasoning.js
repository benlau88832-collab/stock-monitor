// ============================================================
// server/routes/reasoning.js —— 认知推理端点（v9.120.0，卓越 S1-1c）
// GET /api/reasoning → enrichCognition(getCognition(), raw, prevCog)
//   raw：buildBrainContext（PG 聚合）+ 最近利好快讯注入（deriveDrivers 催化用）
//   prevCog：cognition_snapshots 上一版（computeDelta 环比）
// 全部纯函数 0 LLM token；前端推理面板/助手注入 narrative 共用。
// ============================================================
const { pool } = require("../db");
const { latestCognition, prevCognition } = require("../lib/cognition");
const { enrichCognition } = require("../lib/reasoning");

/** 推理层数据源：认知（表最新）+ raw（brainContext + 利好快讯）+ prevCog（历史版） */
async function buildReasoning() {
  const { buildBrainContext } = require("../lib/brainContext");
  const [cog, ctx, prev] = await Promise.all([
    latestCognition(pool),
    buildBrainContext(pool),
    prevCognition(pool),
  ]);
  if (!cog) {
    const { buildCognition, rawFromBrainContext } = require("../lib/cognition");
    return enrichCognition(buildCognition(rawFromBrainContext(ctx), 1), rawFromBrainContext(ctx), null);
  }
  // v9.120.0（S1-1b 催化真实化）：最近利好快讯注入 raw.news（deriveDrivers catalyst 用）
  let news = [];
  try {
    const r = await pool.query(
      `SELECT title, sentiment FROM news WHERE sentiment='利好' ORDER BY time DESC LIMIT 3`,
    );
    news = r.rows;
  } catch { news = []; }
  const raw = { news };
  return enrichCognition(cog, raw, prev);
}

module.exports = function reasoningRoutes(app) {
  app.get("/api/reasoning", async (req, res) => {
    try {
      res.json(await buildReasoning());
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
};

module.exports.buildReasoning = buildReasoning;
