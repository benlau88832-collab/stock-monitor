// ============================================================
// server/routes/decisions.js —— 决策直达 API（v9.116.0，S2-2）
// v9.136.0（任务4 契约定案）：GET 批量端点已删除——前端零消费者
//   （决策卡走 POST 单标的；主线/龙头权威源=/api/cognition，不再经决策端点包一层）；
//   POST 契约定案 = 单标的五支柱裁决裸对象（DecisionVerdict，与前端 kernel 同构 golden 锁定），
//   现价装配（stockSnapshot）+ PG 认知权威（getFreshCognition）。
// POST /api/decisions {code, mainline?} —— 单标的五支柱裁决（纯函数，不依赖 LLM，秒级）
// ============================================================
const { composeDecision } = require("../lib/decisionLayer");

module.exports = function decisionsRoutes(app) {
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
