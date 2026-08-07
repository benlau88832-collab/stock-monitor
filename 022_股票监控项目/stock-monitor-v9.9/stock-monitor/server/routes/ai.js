// ============================================================
// /api/ai/call  服务端 LLM 中转（v9.26 F-03）
// 目的：浏览器不再持有模型 API Key —— Key 只存服务端 .env
// 前端在 isLocalServer() 时优先调此接口；线上 GitHub Pages 无此后端，自动回退本地 Key
// 同时实现简单令牌桶限速（F-04 基础版）：10 次/分钟
// v9.38.1（V3-P0）：LLM 转发抽公共层 server/lib/httpProxy.js（惰性+容错，消除重复实现）
// ============================================================
const { postJSON, PROXY_URL } = require("../lib/httpProxy");

// 任务白名单（与前端 src/lib/aiPrompts.ts TASK_CONFIG 保持一致）
// v9.28（P1-9）：新增独立业务 task themeNewsScore/stockNewsScore/dailyIntel
// v9.33（缺口2/3）：新增 dailyReviewAuto/nextDayScenarios/leaderPredict/riskRadar
const TASK_ALLOW = new Set([
  "preopenPlan", "closeReview", "annRank", "ladderScan", "newsDigest",
  "weeklyCoach", "stockJudge", "policyDiff", "supervisor",
  "mainlineClassify", "mainlineDiagnosis", "mainlineRank", "eventExplain",
  "themeNewsScore", "stockNewsScore", "dailyIntel",
  "dailyReviewAuto", "nextDayScenarios", "leaderPredict", "riskRadar",
  "eventClassify", "eventDeepDive", "agentReason",
]);

// ---------- v9.45（V5-1）：分级令牌桶（按任务优先级分桶，互不抢占） ----------
// 原单一 60/min 桶被页面并发 10+ 任务打爆 → Agent 静默降级回规则（"AI 主导"名存实亡）。
// 现在分三桶：Agent 决策类（agentReason）独占 30/min 最高优先级；
// 分析类（情报/复盘/事件/预案）20/min；解释类（异动/快讯/个股）10/min。
const PERIOD_MS = 60000;
const BUCKETS = {
  agent: { rate: 30, tokens: 30, lastRefill: Date.now() },
  analysis: { rate: 20, tokens: 20, lastRefill: Date.now() },
  explain: { rate: 10, tokens: 10, lastRefill: Date.now() },
};
/** 任务 → 桶映射（与前端 aiPrompts TASK_CONFIG 保持一致） */
function bucketOf(task) {
  if (task === "agentReason") return "agent"; // 决策 Agent（decideForMainline）独占最高优先桶
  if (["eventExplain", "stockJudge", "stockNewsScore", "themeNewsScore", "leaderPredict", "riskRadar", "eventDeepDive", "supervisor"].includes(task)) return "explain";
  return "analysis";
}
function takeToken(bucket) {
  const b = BUCKETS[bucket];
  const now = Date.now();
  if (now - b.lastRefill >= PERIOD_MS) { b.tokens = b.rate; b.lastRefill = now; }
  if (b.tokens <= 0) return false;
  b.tokens -= 1;
  return true;
}

module.exports = function aiRoutes(app) {
  // v9.28（P2-3）：可选鉴权 —— server/.env 配置 LOCAL_TOKEN 后，
  // /api/ai/call 必须携带 header `x-local-token`（防局域网/公网白嫖 Agnes 配额）
  const LOCAL_TOKEN = process.env.LOCAL_TOKEN || null;
  function checkAuth(req, res) {
    if (!LOCAL_TOKEN) return true;
    if (req.headers["x-local-token"] === LOCAL_TOKEN) return true;
    res.status(401).json({ error: "unauthorized: missing/invalid x-local-token" });
    return false;
  }

  // 配置查询（不返回 Key）：前端判断服务端是否可用
  app.get("/api/ai/config", (req, res) => {
    res.json({
      enabled: Boolean(process.env.AI_API_KEY),
      provider: process.env.AI_PROVIDER || "agnes",
      model: process.env.AI_MODEL || "agnes-2.5-flash",
    });
  });

  app.post("/api/ai/call", async (req, res) => {
    if (!checkAuth(req, res)) return;
    try {
      const { task, system, user, temperature, maxTokens, thinking, tools, toolChoice } = req.body || {};

      // 白名单校验
      if (!task || !TASK_ALLOW.has(task)) {
        return res.status(403).json({ error: "task not allowed: " + task });
      }
      if (!process.env.AI_API_KEY) {
        return res.status(400).json({ error: "server AI key not configured (.env AI_API_KEY)" });
      }
      // v9.26.10：Key 校验后才扣令牌（未配 Key 时白名单请求不消耗配额）
      // v9.45（V5-1）：按任务分桶扣令牌；429 带 rateLimited 标识（前端显式标注"配额受限"，不再静默降级）
      const bucket = bucketOf(task);
      if (!takeToken(bucket)) {
        return res.status(429).json({ error: `rate limited (${BUCKETS[bucket].rate}/min, bucket=${bucket})`, rateLimited: true, bucket });
      }

      const baseUrl = process.env.AI_BASE_URL || "https://apihub.agnes-ai.cn/v1/chat/completions";
      const model = process.env.AI_MODEL || "agnes-2.5-flash";
      // v9.66.1：支持 history（多轮对话上下文）—— AIConsole 深度调研"继续/深入查询"类指令能衔接上文
      const history = Array.isArray(req.body?.history)
        ? req.body.history.slice(-8).map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content ?? "").slice(0, 1200) }))
        : [];
      const body = {
        model,
        messages: [
          { role: "system", content: String(system || "") },
          ...history,
          { role: "user", content: String(user || "") },
        ],
        max_tokens: Math.min(Number(maxTokens) || 1200, 8000),
        temperature: temperature != null ? Number(temperature) : 0.2,
        stream: false,
      };
      // 2026-08-04 公告后：Endpoint=.cn + agnes-2.5-flash（免费）；thinking 显式关闭才有 content。
      // 必须显式传 enable_thinking:false 才返回 content（JSON 任务尤其需要）。
      // 任务要求 thinking=true 时（复盘/周教练）才开启。
      body.chat_template_kwargs = { enable_thinking: Boolean(thinking) };
      // v9.41（V4-A）：Agent 原生 tool_calls 透传（Agnes OpenAI 兼容 /v1/chat/completions）
      if (Array.isArray(tools) && tools.length > 0) {
        // OpenAI 格式要求 {type:"function", function:{name,description,parameters}} 包装层
        body.tools = tools.map(t => ({ type: "function", function: t }));
        if (toolChoice) body.tool_choice = toolChoice;
      }

      // v9.67：30s → 20s（PM2 日志反复 upstream timeout 30s，缩短超时让前端快速拿到降级响应而不是 35s 卡死）
      const json = await postJSON(baseUrl, body, 20000, { Authorization: "Bearer " + (process.env.AI_API_KEY || "") });
      const msg = (json && json.choices && json.choices[0] && json.choices[0].message) || {};
      // v9.41：Agent 需要 tool_calls（LLM 决定下一步调哪个工具）
      const toolCalls = Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0
        ? msg.tool_calls.map(tc => ({ id: String(tc.id ?? ""), name: String(tc.function?.name ?? ""), args: tc.function?.arguments ?? "{}" }))
        : undefined;
      if (!msg.content && !toolCalls) {
        return res.json({ error: "empty content", finish_reason: json && json.choices && json.choices[0] ? json.choices[0].finish_reason : undefined });
      }
      res.json({ text: msg.content || "", toolCalls });
    } catch (e) {
      console.error("[ai] call failed:", e && e.message, "| proxy:", PROXY_URL);
      // v9.67：分类降级原因（前端可显式标注）—— timeout / network / model
      const msg = String(e?.message ?? "");
      const reason = /timeout|ETIMEDOUT|aborted/i.test(msg) ? "timeout" : /proxy|ENOTFOUND|ECONN/i.test(msg) ? "network" : "model";
      res.status(502).json({ error: msg || "model call failed", reason });
    }
  });
};
