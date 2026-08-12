// ============================================================
// server/routes/proactive.js —— 主动智能流 API（v9.117.0，S3-3）
// GET /api/proactive?phase=09:25 | ?phaseName=盘后 → 时段洞察 + LLM 预算
// 数据源：认知层（buildCognition，PG 权威）+ 时段引擎 resolveSession。
// 规则前置过滤：绝大多数洞察 0 token；LLM 仅标记（预算内可选润色）。
// ============================================================
const { pool } = require("../db");
const { buildCognition, rawFromBrainContext, latestCognition } = require("../lib/cognition");
const { buildBrainContext } = require("../lib/brainContext");
const { resolveSession, currentSession, PHASE_TIME } = require("../lib/proactiveSession");
const { runProactiveTick } = require("../lib/proactiveScheduler");

/** 认知层（表最新优先，cron 驱动）；表空则构建 */
async function getCog() {
  const latest = await latestCognition(pool);
  if (latest) return latest;
  const ctx = await buildBrainContext(pool);
  return buildCognition(rawFromBrainContext(ctx), 1);
}

module.exports = function proactiveRoutes(app) {
  app.get("/api/proactive", async (req, res) => {
    try {
      const cog = await getCog();
      const hhmm = String(req.query.phase ?? "");
      const phaseName = String(req.query.phaseName ?? "");
      let session;
      if (/^\d{2}:\d{2}$/.test(hhmm)) {
        const [h, m] = hhmm.split(":").map(Number);
        session = resolveSession(h, m);
      } else if (phaseName && PHASE_TIME[phaseName]) {
        const [h, m] = PHASE_TIME[phaseName].split(":").map(Number);
        session = resolveSession(h, m);
      } else {
        session = currentSession();
      }
      const { insights, budget } = runProactiveTick(cog, session);
      res.json({ cognitionVersion: cog.version, session, insights, budget });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
};
