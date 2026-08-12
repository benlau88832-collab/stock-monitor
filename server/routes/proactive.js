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
      const hhmm = String(req.query.phase ?? "");
      const phaseName = String(req.query.phaseName ?? "");
      const useLatest = !hhmm && !phaseName; // 无时段参数 → 返回当前时段（优先 cron 润色版 kv）
      if (useLatest) {
        // v9.119.0（S3-3 补全）：优先读 cron 时段调度落库的润色版（proactive:latest）
        const r = await pool.query("SELECT value FROM kv_store WHERE key=$1", ["proactive:latest"]);
        if (r.rows[0]?.value) {
          let v = r.rows[0].value;
          if (v && typeof v === "object" && "__raw" in v) { try { v = JSON.parse(v.__raw); } catch { v = null; } }
          if (v && v.session) return res.json(v);
        }
      }
      const cog = await getCog();
      // v9.122.0（卓越 S3-2b）：推理层预判接入（实时路径）—— forecast.conditions 触发源
      let reasoning = null;
      try {
        const { buildReasoning } = require("./reasoning");
        reasoning = await buildReasoning();
      } catch { reasoning = null; }
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
      const { insights, budget } = runProactiveTick(cog, session, undefined, reasoning);
      res.json({ cognitionVersion: cog.version, session, insights, budget });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
};
