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
    // v9.81（安全加固）：出站 host 白名单 —— 防未来改动把用户可控字符串拼进 URL 造成 SSRF
    try { require("./hostGuard").assertHostAllowed(url); } catch (e) { reject(e); return; }
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
    // v9.85.1（P1-17）：仅"网络失败"（超时/连接错）才走代理重试 ——
    // 原实现任何失败都重试：429/5xx 重试可能重复计费、坏 JSON 重试无意义
    attempt(null, Math.floor(timeoutMs * 0.4)).then(resolve, (e) => {
      if (!isNetworkErr(e)) return reject(e); // HTTP 4xx/5xx / 坏 JSON → 直接失败（不重试不计费）
      if (PROXY_AGENT) attempt(PROXY_AGENT, Math.floor(timeoutMs * 0.6)).then(resolve, reject);
      else reject(e);
    });
  });
}

// v9.86.0（P2-7）：提升为模块级导出，供统一出站客户端 outbound.js 复用错误分类语义
function isNetworkErr(e) {
  return /timeout|ECONN|ENOTFOUND|socket|hang up|network/i.test(String(e?.message ?? ""))
    && !/http \d{3}/.test(String(e?.message ?? ""));
}

// ---------- 调 LLM 拿纯文本（cron.js 的 callLLM 语义） ----------
// opts: { system?, maxTokens?, temperature?, thinking? }
// 返回 message.content 字符串（空则 reject）
// v9.83（模型切换）：支持 DeepSeek 推理模型 —— max_tokens 600→2000（推理模型思考会占用 token，
// 实测 600 时思考占满导致 content 为空）；chat_template_kwargs 是 Agnes 专属参数，非 agnes 不传
async function callModelText(payloadText, opts = {}) {
  const baseUrl = process.env.AI_BASE_URL || "https://apihub.agnes-ai.cn/v1/chat/completions";
  const model = process.env.AI_MODEL || "agnes-2.5-flash";
  const isAgnes = (process.env.AI_PROVIDER || "agnes") === "agnes";
  const body = {
    model,
    messages: [
      { role: "system", content: opts.system || "你是A股资深盘面分析师。基于今日快讯与公告数据，输出当日市场速览（≤150字）：1) 主线方向 2) 强催化公告要点 3) 风险提示。直接输出正文，不要markdown。" },
      { role: "user", content: payloadText },
    ],
    max_tokens: opts.maxTokens || 2000,
    temperature: opts.temperature ?? 0.2,
    stream: false,
  };
  if (isAgnes) body.chat_template_kwargs = { enable_thinking: opts.thinking ?? false };
  // v9.93.3-fix（cron 主题分析 empty content）：60s → 90s —— v9.92.3 只放宽了 routes/ai.js，
  // cron 的 callModelText 仍是 60s：DeepSeek 长思考被截断 → content 空 → 主题分析整管线失败
  // v9.93.3-fix2：empty content 重试 2 次（退避 2s/4s）—— DeepSeek 网关在并发限流时偶发空响应
  // （cron 启动链的公告评分/快讯分级/主题分析同时调 LLM 实测触发），重试即恢复
  const MAX_EMPTY_RETRY = 2;
  for (let attempt = 0; attempt <= MAX_EMPTY_RETRY; attempt++) {
    try {
      const json = await postJSON(baseUrl, body, 90000, {
        Authorization: "Bearer " + (process.env.AI_API_KEY || ""),
      });
      const content = (json.choices?.[0]?.message?.content || "").trim();
      if (!content) {
        if (attempt < MAX_EMPTY_RETRY) {
          console.warn(`[callModelText] empty content，重试 ${attempt + 1}/${MAX_EMPTY_RETRY}…`);
          await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }
        throw new Error("empty content");
      }
      return content;
    } catch (e) {
      if (attempt < MAX_EMPTY_RETRY && /empty content/.test(String(e?.message ?? ""))) continue;
      throw e;
    }
  }
  throw new Error("empty content");
}

module.exports = { postJSON, callModelText, PROXY_URL, isNetworkErr };
