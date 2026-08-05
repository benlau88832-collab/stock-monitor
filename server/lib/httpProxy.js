// ============================================================
// server/lib/httpProxy.js —— LLM/HTTP 公共转发层（V3-P0）
// 目的：消除 ai.js 与 cron.js 两份重复的 postJSON/callLLM。
// 设计要点（V3-P0 验收）：
//   1. https-proxy-agent 惰性 require + 容错 —— 未安装时降级直连，
//      不再因"模块顶层 require 幽灵依赖"导致干净部署启动即崩。
//   2. 单例 HttpsProxyAgent（每次 new 且不销毁 → socket 泄漏堆积）。
//   3. 直连优先（.cn 端点最稳），失败走代理重试一次（超时按比例分配）。
//   4. 非 2xx 不再走代理重试（避免重复计费）。
// ============================================================
const https = require("https");
const http = require("http");

// ---- 惰性 + 容错加载 https-proxy-agent ----
let HttpsProxyAgentCtor = null;
let agentWarned = false;
function getHttpsProxyAgent(url) {
  if (!url) return null;
  try {
    if (!HttpsProxyAgentCtor) {
      // 惰性 require：找不到包时不抛致命错，降级直连（V3-P0 核心）
      const mod = require("https-proxy-agent");
      HttpsProxyAgentCtor = mod.HttpsProxyAgent || mod.default || mod;
    }
    return new HttpsProxyAgentCtor(url);
  } catch (e) {
    if (!agentWarned) {
      console.warn("[httpProxy] https-proxy-agent 不可用（走直连）:", e.message);
      agentWarned = true;
    }
    return null;
  }
}

const PROXY_URL = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "http://127.0.0.1:7897";
// 单例代理（v9.26.10：避免每次 new 泄漏 socket）
const PROXY_AGENT = getHttpsProxyAgent(PROXY_URL);

// ---------- POST JSON（直连 → 代理重试） ----------
// 返回完整响应 JSON（ai.js 用）；非 2xx / 坏 JSON 均 reject
function postJSON(url, body, timeoutMs = 30000, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const data = JSON.stringify(body);
    const opts = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
        ...extraHeaders,
      },
    };
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
          catch { rej2(new Error("bad json from upstream")); }
        });
      });
      req.on("error", rej2);
      req.setTimeout(timeout, () => { req.destroy(new Error("upstream timeout")); });
      req.write(data);
      req.end();
    });
    // 直连失败（超时/网络错/非2xx）→ 走代理重试一次
    attempt(null, Math.floor(timeoutMs * 0.4)).then(resolve, () => {
      if (PROXY_AGENT) attempt(PROXY_AGENT, Math.floor(timeoutMs * 0.6)).then(resolve, reject);
      else reject(new Error("direct failed & no proxy agent"));
    });
  });
}

// ---------- 调 Agnes 拿纯文本（cron.js 的 callLLM 语义） ----------
// opts: { system?, maxTokens?, temperature?, thinking? }
// 返回 message.content 字符串（空则 reject）
function callModelText(payloadText, opts = {}) {
  const baseUrl = process.env.AI_BASE_URL || "https://apihub.agnes-ai.cn/v1/chat/completions";
  const model = process.env.AI_MODEL || "agnes-2.5-flash";
  const body = {
    model,
    messages: [
      { role: "system", content: opts.system || "你是A股资深盘面分析师。基于今日快讯与公告数据，输出当日市场速览（≤150字）：1) 主线方向 2) 强催化公告要点 3) 风险提示。直接输出正文，不要markdown。" },
      { role: "user", content: payloadText },
    ],
    max_tokens: opts.maxTokens || 600,
    temperature: opts.temperature ?? 0.2,
    stream: false,
    chat_template_kwargs: { enable_thinking: opts.thinking ?? false },
  };
  return postJSON(baseUrl, body, 40000, {
    Authorization: "Bearer " + (process.env.AI_API_KEY || ""),
  }).then(json => {
    const content = (json.choices?.[0]?.message?.content || "").trim();
    if (!content) throw new Error("empty content");
    return content;
  });
}

module.exports = { postJSON, callModelText, PROXY_URL };
