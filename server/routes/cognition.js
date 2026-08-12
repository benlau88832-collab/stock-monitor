// ============================================================
// server/routes/cognition.js —— GET /api/cognition（v9.115.0，S1-1）
// 全站唯一认知端点：实时读 PG（buildBrainContext）→ 适配 → buildCognition。
// 内存缓存 + 数据变化（date/sources 时间戳）时 version 自增 → hash 随内容变化，
// 同一次请求周期内全站消费同一份认知（双端同构 golden）。
// S1-2 将把 version/hash/payload 落库 cognition_snapshots（此处缓存为 S1-1 先行形态）。
// ============================================================
const { pool } = require("../db");
const { buildCognition, rawFromBrainContext } = require("../lib/cognition");

let cached = null;   // MarketCognition
let cacheKey = null; // 数据指纹（date + market/sentiment 落库时间戳）
let cogVersion = 0;  // 单调递增版本号（数据变化时 +1）

/** 全站唯一认知（memoized）—— 数据指纹变化才重建，version 单调递增 */
async function getCognition() {
  const { buildBrainContext } = require("../lib/brainContext");
  const ctx = await buildBrainContext(pool);
  const key = `${ctx.date}:${ctx.fallbackDate ?? ""}:${ctx.sources?.market ?? 0}:${ctx.sources?.sentiment ?? 0}`;
  if (key !== cacheKey) {
    cacheKey = key;
    cogVersion += 1;
    cached = buildCognition(rawFromBrainContext(ctx), cogVersion);
  }
  return cached;
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
