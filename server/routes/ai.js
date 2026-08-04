// ============================================================
// /api/ai/call  服务端 LLM 中转（v9.26 F-03）
// 目的：浏览器不再持有模型 API Key —— Key 只存服务端 .env
// 前端在 isLocalServer() 时优先调此接口；线上 GitHub Pages 无此后端，自动回退本地 Key
// 同时实现简单令牌桶限速（F-04 基础版）：10 次/分钟
// ============================================================
const https = require("https");
const http = require("http");

// 任务白名单（与前端 src/lib/aiPrompts.ts TASK_CONFIG 保持一致）
const TASK_ALLOW = new Set([
  "preopenPlan", "closeReview", "annRank", "ladderScan", "newsDigest",
  "weeklyCoach", "stockJudge", "policyDiff", "supervisor",
  "mainlineClassify", "mainlineDiagnosis", "mainlineRank", "eventExplain",
]);

// ---------- 简单令牌桶：10 次/分钟 ----------
const RATE = 10;
const PERIOD_MS = 60000;
let tokens = RATE;
let lastRefill = Date.now();
function takeToken() {
  const now = Date.now();
  const elapsed = now - lastRefill;
  if (elapsed >= PERIOD_MS) {
    tokens = RATE;
    lastRefill = now;
  }
  if (tokens <= 0) return false;
  tokens -= 1;
  return true;
}

function postJSON(url, body, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const data = JSON.stringify(body);
    const req = lib.request(u, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
        "Authorization": "Bearer " + (process.env.AI_API_KEY || ""),
      },
    }, r => {
      const chunks = [];
      r.on("data", c => chunks.push(c));
      r.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        try { resolve(JSON.parse(raw)); }
        catch { reject(new Error("bad json from model")); }
      });
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => { req.destroy(new Error("model timeout")); });
    req.write(data);
    req.end();
  });
}

module.exports = function aiRoutes(app) {
  // 配置查询（不返回 Key）：前端判断服务端是否可用
  app.get("/api/ai/config", (req, res) => {
    res.json({
      enabled: Boolean(process.env.AI_API_KEY),
      provider: process.env.AI_PROVIDER || "agnes",
      model: process.env.AI_MODEL || "agnes-2.5-flash",
    });
  });

  app.post("/api/ai/call", async (req, res) => {
    try {
      const { task, system, user, temperature, maxTokens, thinking } = req.body || {};

      // 白名单校验
      if (!task || !TASK_ALLOW.has(task)) {
        return res.status(403).json({ error: "task not allowed: " + task });
      }
      if (!takeToken()) {
        return res.status(429).json({ error: "server rate limited (10/min)" });
      }
      if (!process.env.AI_API_KEY) {
        return res.status(400).json({ error: "server AI key not configured (.env AI_API_KEY)" });
      }

      const baseUrl = process.env.AI_BASE_URL || "https://apihub.agnes-ai.cn/v1/chat/completions";
      const model = process.env.AI_MODEL || "agnes-2.5-flash";
      const body = {
        model,
        messages: [
          { role: "system", content: String(system || "") },
          { role: "user", content: String(user || "") },
        ],
        max_tokens: Math.min(Number(maxTokens) || 1200, 8000),
        temperature: temperature != null ? Number(temperature) : 0.2,
        stream: false,
      };
      if (thinking) body.chat_template_kwargs = { enable_thinking: true };

      const json = await postJSON(baseUrl, body);
      const msg = (json && json.choices && json.choices[0] && json.choices[0].message) || {};
      if (!msg.content) {
        return res.json({ error: "empty content", finish_reason: json && json.choices && json.choices[0] ? json.choices[0].finish_reason : undefined });
      }
      res.json({ text: msg.content });
    } catch (e) {
      res.status(502).json({ error: (e && e.message) || "model call failed" });
    }
  });
};
