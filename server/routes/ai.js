// ============================================================
// /api/ai/call  服务端 LLM 中转（v9.26 F-03）
// 目的：浏览器不再持有模型 API Key —— Key 只存服务端 .env
// 前端在 isLocalServer() 时优先调此接口；线上 GitHub Pages 无此后端，自动回退本地 Key
// 同时实现简单令牌桶限速（F-04 基础版）：10 次/分钟
// ============================================================
const https = require("https");
const http = require("http");
const { HttpsProxyAgent } = require("https-proxy-agent");

// 本机走代理（Clash 等 127.0.0.1:7897）：node 原生 https.request 不读 HTTP_PROXY 环境变量，
// 而 curl/浏览器会走系统代理。ai.js 必须显式挂代理才能访问 apihub.agnes-ai.com（直连超时）。
const PROXY_URL = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "http://127.0.0.1:7897";

// 任务白名单（与前端 src/lib/aiPrompts.ts TASK_CONFIG 保持一致）
const TASK_ALLOW = new Set([
  "preopenPlan", "closeReview", "annRank", "ladderScan", "newsDigest",
  "weeklyCoach", "stockJudge", "policyDiff", "supervisor",
  "mainlineClassify", "mainlineDiagnosis", "mainlineRank", "eventExplain",
]);

// ---------- 简单令牌桶：60 次/分钟 ----------
// v9.26.5：10 → 60（页面一次刷新会并发触发 10+ 个 AI 任务，10/min 必然被打爆 → 429 降级）
const RATE = 60;
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

// v9.26.10：单例 HttpsProxyAgent（每次 new 且不销毁 → 失败重试时 socket 泄漏堆积）
const PROXY_AGENT = new HttpsProxyAgent(PROXY_URL);

function postJSON(url, body, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const data = JSON.stringify(body);
    const opts = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
        "Authorization": "Bearer " + (process.env.AI_API_KEY || ""),
      },
    };
    // v9.26.5：.cn 端点直连最稳（Clash 会把 .cn 域名绕到国外节点反而超时/不稳）。
    // 策略：先直连（timeoutMs*0.4），失败再走代理重试一次（timeoutMs*0.6）。
    // v9.26.10：超时按比例分配 + 校验 statusCode（非 2xx 不再走代理重试，避免重复计费）
    const attempt = (agent, timeout) => new Promise((res2, rej2) => {
      const req = lib.request(u, { ...opts, ...(agent ? { agent } : {}) }, r => {
        const chunks = [];
        r.on("data", c => chunks.push(c));
        r.on("end", () => {
          if (r.statusCode && (r.statusCode < 200 || r.statusCode >= 300)) {
            const raw = Buffer.concat(chunks).toString("utf8").slice(0, 200);
            return rej2(new Error(`model http ${r.statusCode}: ${raw}`));
          }
          const raw = Buffer.concat(chunks).toString("utf8");
          try { res2(JSON.parse(raw)); }
          catch { rej2(new Error("bad json from model")); }
        });
      });
      req.on("error", rej2);
      req.setTimeout(timeout, () => { req.destroy(new Error("model timeout")); });
      req.write(data);
      req.end();
    });
    // 直连失败（超时/网络错/非2xx）→ 走代理重试一次
    attempt(null, Math.floor(timeoutMs * 0.4)).then(resolve, () => {
      attempt(PROXY_AGENT, Math.floor(timeoutMs * 0.6)).then(resolve, reject);
    });
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
      if (!process.env.AI_API_KEY) {
        return res.status(400).json({ error: "server AI key not configured (.env AI_API_KEY)" });
      }
      // v9.26.10：Key 校验后才扣令牌（未配 Key 时白名单请求不消耗配额）
      if (!takeToken()) {
        return res.status(429).json({ error: `server rate limited (${RATE}/min)` });
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
      // 2026-08-04 公告后：Endpoint=.cn + agnes-2.5-flash（免费）；thinking 显式关闭才有 content。
      // 必须显式传 enable_thinking:false 才返回 content（JSON 任务尤其需要）。
      // 任务要求 thinking=true 时（复盘/周教练）才开启。
      body.chat_template_kwargs = { enable_thinking: Boolean(thinking) };

      const json = await postJSON(baseUrl, body);
      const msg = (json && json.choices && json.choices[0] && json.choices[0].message) || {};
      if (!msg.content) {
        return res.json({ error: "empty content", finish_reason: json && json.choices && json.choices[0] ? json.choices[0].finish_reason : undefined });
      }
      res.json({ text: msg.content });
    } catch (e) {
      console.error("[ai] call failed:", e && e.message, "| proxy:", PROXY_URL);
      res.status(502).json({ error: (e && e.message) || "model call failed" });
    }
  });
};
