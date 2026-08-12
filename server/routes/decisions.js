// ============================================================
// server/routes/decisions.js —— 决策直达 API（v9.116.0，S2-2）
// GET /api/decisions —— 批量预生成（认知层主线 top3 龙头标的，首屏秒级呈现决策卡）
// POST /api/decisions {code} —— 单标的五支柱裁决（纯函数，不依赖 LLM，秒级）
// ============================================================
const { composeDecision } = require("../lib/decisionLayer");

module.exports = function decisionsRoutes(app) {
  // GET 批量：默认裁决主线龙头（无 code 入参）
  app.get("/api/decisions", async (req, res) => {
    try {
      const v = await composeDecision({});
      res.json({ verdicts: [v] });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST 单标的
  app.post("/api/decisions", async (req, res) => {
    try {
      const body = req.body || {};
      const code = String(body.code ?? "").trim();
      if (!code) return res.status(400).json({ error: "missing code" });
      const v = await composeDecision({ code, mainline: body.mainline });
      res.json(v);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
};
