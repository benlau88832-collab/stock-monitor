// ============================================================
// server/routes/reasoning.js —— 认知推理端点（v9.120.0，卓越 S1-1c）
// v9.123.0（卓越审查 P1-6）：60s 内存缓存 + buildReasoningForCog 轻量变体——
//   cron 主动流已有认知快照在手，无需重聚合 buildBrainContext（10+ PG 并行查询）；
//   轻量变体只补 prevCog（环比）+ 利好快讯（催化），与 /api/reasoning 同口径。
// ============================================================
const { pool } = require("../db");
const { latestCognition, prevCognition } = require("../lib/cognition");
const { enrichCognition } = require("../lib/reasoning");

// v9.123.0（卓越审查 P1-6）：60s 缓存（同 buildBrainContext 快照缓存模式；失败不缓存）
let _cache = { at: 0, value: null };

/** 最近利好快讯（deriveDrivers 催化用；失败静默空数组） */
async function fetchBullNews() {
  try {
    const r = await pool.query(`SELECT title, sentiment FROM news WHERE sentiment='利好' ORDER BY time DESC LIMIT 3`);
    return r.rows;
  } catch { return []; }
}

/** 推理层数据源：认知（表最新）+ raw（利好快讯）+ prevCog（历史版）；60s 缓存 */
async function buildReasoning() {
  if (Date.now() - _cache.at < 60_000 && _cache.value) return _cache.value;
  const { buildBrainContext } = require("../lib/brainContext");
  const [cog, ctx, prev] = await Promise.all([
    latestCognition(pool),
    buildBrainContext(pool),
    prevCognition(pool),
  ]);
  let out;
  if (!cog) {
    const { buildCognition, rawFromBrainContext } = require("../lib/cognition");
    const { currentSession } = require("../lib/proactiveSession");
    // v9.123.0（卓越审查 P1-1）：真实时段注入
    out = enrichCognition(buildCognition(rawFromBrainContext(ctx), 1, currentSession()), rawFromBrainContext(ctx), null);
  } else {
    out = enrichCognition(cog, { news: await fetchBullNews() }, prev);
  }
  _cache = { at: Date.now(), value: out };
  return out;
}

/** 轻量变体（cron 主动流用）：认知已在手 → 只补 prevCog + 利好快讯；同 60s 缓存 */
async function buildReasoningForCog(cog) {
  if (Date.now() - _cache.at < 60_000 && _cache.value) return _cache.value;
  const prev = await prevCognition(pool).catch(() => null);
  const out = enrichCognition(cog, { news: await fetchBullNews() }, prev);
  _cache = { at: Date.now(), value: out };
  return out;
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
module.exports.buildReasoningForCog = buildReasoningForCog;
