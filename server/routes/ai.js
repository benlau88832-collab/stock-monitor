// ============================================================
// /api/ai/call  服务端 LLM 中转（v9.26 F-03）
// 目的：浏览器不再持有模型 API Key —— Key 只存服务端 .env
// 前端在 isLocalServer() 时优先调此接口；线上 GitHub Pages 无此后端，自动回退本地 Key
// 同时实现简单令牌桶限速（F-04 基础版）：10 次/分钟
// v9.38.1（V3-P0）：LLM 转发抽公共层 server/lib/httpProxy.js（惰性+容错，消除重复实现）
// ============================================================
const { postJSON, PROXY_URL } = require("../lib/httpProxy");
const { pool } = require("../db");
// P2-3：流式输出需要原生 https 直连（SSE），不走 postJSON（一次性返回）
const https = require("https");

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
  // v9.87.0（P2-1）：补齐前端有调用点的 task —— 此前 403 后前端回退浏览器直连（服务端不可观测）
  "criticReview", "factorAttribution", "nextGatePredict",
  // v9.99.2（全栈体检 B1）：补齐服务端模式仍活跃的 task —— marginSentiment/stockAggregate 此前不在白名单，
  //   服务端部署形态（浏览器无 Key、走 /api/ai/call）恒 403 "task not allowed" → 两大功能 LLM 从未生效、永远规则版；
  //   emotionReport/newsAnalysis 前端有调用者，一并放行防未来 403
  // v9.137.0：userStyleProfile 移除（死任务，前端 aiPrompts.ts 与服务端 aiPrompts.js 模板已同步删除）
  "marginSentiment", "stockAggregate", "emotionReport", "newsAnalysis",
  // v9.104.0（第四批 C，T-C3）：盘中 LLM 快评（重要新闻四段式）
  "intradayQuickComment",
  // v9.105.0（第五批 E）：政策首写裁决 / 政策解读报告
  "policyFirstWrite", "policyInterpretation",
  // v9.85.1（P1-2）：AIConsole 快速问答（SSE 流式专用，与 /call 共用白名单口径）
  "quickChat",
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

const { parseLLMJSON, SCHEMAS } = require("../lib/llmJson");
const { buildPrompt, TASK_CONFIG } = require("../lib/aiPrompts");

module.exports = function aiRoutes(app) {
  // v9.109.2（L-6）：AI 端点健康（熔断状态/empty 率）—— 前端 AIConsole 顶部健康指示（A-2）用
  app.get("/api/ai/health", async (req, res) => {
    try {
      const { getHealth } = require("../lib/aiHealth");
      res.json(getHealth());
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // v9.110.0（MOD-3 诊断）：用真实部署配置打最小请求，对比"带/不带 chat_template_kwargs"两次，
  // 定位 empty content 真因（chat_template_kwargs 残留？relay 不稳？非标字段？length 截断？）
  // v9.137.0（审查 P3-05）：加令牌桶 —— 每次 GET 发起 3 次真实上游请求（含 90s reactProbe 烧配额），
  //   原无任何限流，本地任意页面可反复触发烧钱。1 次/分钟。
  let diagTokens = 1, diagLastRefill = Date.now();
  app.get("/api/ai/diag", async (req, res) => {
    const now = Date.now();
    if (now - diagLastRefill >= 60000) { diagTokens = 1; diagLastRefill = now; }
    if (diagTokens <= 0) return res.status(429).json({ error: "diag rate limited (1/min)" });
    diagTokens -= 1;
    if (!(await checkAuth(req, res))) return;
    const baseUrl = process.env.AI_BASE_URL || "https://opencode.ai/zen/go/v1/chat/completions" // v9.110.0（MOD-1 默认值清理）：agnes 已剔除，默认指向 DeepSeek(OpenCode Go);
    const model = process.env.AI_MODEL || "deepseek-v4-flash" // v9.110.0（MOD-1 默认值清理）：agnes 已剔除;
    const key = process.env.AI_API_KEY || "";
    const probe = async (withCtk) => {
      const body = {
        model,
        messages: [{ role: "user", content: "用一句话回答：今天A股市场情绪如何？（示例即可）" }],
        max_tokens: 4000, temperature: 0.2, stream: false,
      };
      if (withCtk) body.chat_template_kwargs = { enable_thinking: false }; // 仅这一次带，对比用
      const t0 = Date.now();
      try {
        const json = await postJSON(baseUrl, body, 30000, { Authorization: "Bearer " + key });
        const msg = (json && json.choices && json.choices[0] && json.choices[0].message) || {};
        return {
          ms: Date.now() - t0,
          httpOk: true,
          finish_reason: json?.choices?.[0]?.finish_reason,
          hasContent: !!(msg.content && String(msg.content).trim()),
          hasReasoning: !!(msg.reasoning_content && String(msg.reasoning_content).trim()),
          contentLen: String(msg.content || "").length,
          contentPreview: String(msg.content || "").slice(0, 150),
          // 打印上游返回的所有 message 字段名（防 content 在非标字段，如 text/output/answer）
          msgKeys: Object.keys(msg),
        };
      } catch (e) {
        return { ms: Date.now() - t0, httpOk: false, error: String(e?.message || e).slice(0, 200) };
      }
    };
    // v9.113.0（T3-4）：reactProbe —— 大 system + 多工具描述模拟 ReAct 体量（小 probe 不代表 ReAct，
    // 终审 D-03：ReAct 真因（length/超时）需等价体量诊断）
    const reactProbe = await (async () => {
      const sys = "你是A股短线交易助手（10年游资）。你有以下工具：" +
        Array.from({ length: 18 }, (_, i) => `\n- tool${i}: 工具描述"查询/分析/裁决标的${i}，返回真实数据"`).join("") +
        "\n规则：1.先调工具 2.输出严格JSON 3.≤300字 4.禁止编造。";
      const body = {
        model,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: "今天主线是什么，哪些是龙头哪些是跟风？请先调用工具再回答。" },
        ],
        max_tokens: 8000, temperature: 0.2, stream: false,
      };
      const t0 = Date.now();
      try {
        const json = await postJSON(baseUrl, body, 90000, { Authorization: "Bearer " + key });
        const msg = (json && json.choices && json.choices[0] && json.choices[0].message) || {};
        return {
          ms: Date.now() - t0, httpOk: true,
          finish_reason: json?.choices?.[0]?.finish_reason,
          hasContent: !!(msg.content && String(msg.content).trim()),
          contentLen: String(msg.content || "").length,
          contentPreview: String(msg.content || "").slice(0, 150),
        };
      } catch (e) {
        return { ms: Date.now() - t0, httpOk: false, error: String(e?.message || e).slice(0, 200) };
      }
    })();
    res.json({
      config: { model, baseUrl, provider: process.env.AI_PROVIDER || "agnes", hasKey: !!key, fallback: process.env.AI_FALLBACK || "" },
      withChatTemplateKwargs: await probe(true),
      withoutChatTemplateKwargs: await probe(false),
      reactProbe,
    });
  });

  // v9.28（P2-3）：可选鉴权 —— server/.env 配置 LOCAL_TOKEN 后，
  // /api/ai/call 必须携带 header `x-local-token`（防局域网/公网白嫖 Agnes 配额）
  // v9.84.3（5.4）：未配置 env 时读 kv local_token（index.js ensureLocalToken 自动生成），默认启用
  // v9.85.2（P1-1）：fail-closed —— 曾成功初始化过鉴权（kv 有 local_token）后，读取失败拒绝放行
  //   （原 catch 返回 null 被当作"未启用鉴权"→ DB 短故障即全站放行）
  let storedTokenCache = { t: null, ts: 0 };
  let tokenInitialized = false; // 是否曾成功从 kv 读取过（区分"未配置"与"读取失败"）
  async function effectiveToken() {
    if (process.env.LOCAL_TOKEN) return process.env.LOCAL_TOKEN;
    if (storedTokenCache.t && Date.now() - storedTokenCache.ts < 30000) return storedTokenCache.t;
    try {
      const r = await pool.query("SELECT value FROM kv_store WHERE key='local_token'");
      const v = r.rows[0]?.value;
      const t = v && typeof v === "object" && "__raw" in v ? v.__raw : (typeof v === "string" ? v : v?.token);
      storedTokenCache = { t: t ? String(t) : null, ts: Date.now() };
      tokenInitialized = true;
      return storedTokenCache.t;
    } catch {
      // fail-closed：已初始化过 → 用最后已知 token（拒绝未授权请求）；从未初始化 → 放行（等同未配置）
      return tokenInitialized ? storedTokenCache.t : null;
    }
  }
  async function checkAuth(req, res) {
    const token = await effectiveToken();
    if (!token) return true;
    if (req.headers["x-local-token"] === token) return true;
    res.status(401).json({ error: "unauthorized: missing/invalid x-local-token" });
    return false;
  }

  // 配置查询（不返回 Key）：前端判断服务端是否可用
  app.get("/api/ai/config", (req, res) => {
    res.json({
      enabled: Boolean(process.env.AI_API_KEY),
      provider: process.env.AI_PROVIDER || "agnes",
      model: process.env.AI_MODEL || "deepseek-v4-flash", // v9.110.0（MOD-1 默认值清理）：agnes 已剔除
    });
  });

  app.post("/api/ai/call", async (req, res) => {
    // v9.85.0（P0-1）：checkAuth 是 async，必须 await —— 原 `!checkAuth(...)` 恒为真导致鉴权形同虚设
    if (!(await checkAuth(req, res))) return;
    try {
      const { task, system, user, payload, temperature, maxTokens, thinking, tools, toolChoice } = req.body || {};

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

      const baseUrl = process.env.AI_BASE_URL || "https://opencode.ai/zen/go/v1/chat/completions" // v9.110.0（MOD-1 默认值清理）：agnes 已剔除，默认指向 DeepSeek(OpenCode Go);
      const model = process.env.AI_MODEL || "deepseek-v4-flash" // v9.110.0（MOD-1 默认值清理）：agnes 已剔除;
      // v9.66.1：支持 history（多轮对话上下文）—— AIConsole 深度调研"继续/深入查询"类指令能衔接上文
      const history = Array.isArray(req.body?.history)
        ? req.body.history.slice(-8).map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content ?? "").slice(0, 1200) }))
        : [];
      // v9.88.0（P2-1）：canonical prompt —— 客户端传 {task, payload} 由服务端模板重建 system/user
      // （防绕过中性措辞/JSON 要求/提示注入）；温度/长度以服务端 TASK_CONFIG 为准。
      // 双协议兼容：payload 缺失（老客户端/curl）→ 沿用 system/user 透传 + 长度上限。
      let sysText = String(system || "");
      let userText = String(user || "");
      if (payload !== undefined && payload !== null && TASK_CONFIG[task]) {
        const built = buildPrompt(task, payload);
        sysText = built.system;
        userText = built.user;
      }
      if (sysText.length > 4000 || userText.length > 16000) {
        return res.status(400).json({ error: "prompt too long (system<=4000, user<=16000)" });
      }
      const cfg = TASK_CONFIG[task];
      const effectiveMaxTokens = cfg ? cfg.maxTokens : (Number(maxTokens) || 4000); // v9.107.0（全站助手）：默认 2000→4000
      const effectiveTemperature = cfg ? cfg.temperature : (temperature != null ? Number(temperature) : 0.2);
      // v9.109.0（L-2 根治 RC-A/B/C）：统一走 llmCore.chatComplete —— empty content 重试（重试强制关 thinking）
      // + 恒发 enable_thinking:false（不再依赖 AI_PROVIDER 字符串门控，实测 opencode 网关接受且 content 正常）
      // + 网络/超时端点 failover（AI_FALLBACK 链）
      try {
        const { chatComplete } = require("../lib/llmCore");
        const r = await chatComplete({
          system: sysText, user: userText, history, tools,
          maxTokens: effectiveMaxTokens, temperature: effectiveTemperature, thinking: Boolean(thinking),
        });
        // v9.87.0（P1-8）：JSON 类 task 上游响应做 schema 校验 —— 仅 warn 日志不阻断
        // （前端 parseLLMJSON 仍有自己的降级链；此处让"坏 JSON 率"可观测）
        if (r.text && SCHEMAS[task]) {
          const parsed = parseLLMJSON(r.text, SCHEMAS[task]);
          if (parsed === null) {
            console.warn(`[ai] task=${task} 上游响应非法 JSON（前端将降级规则版）:`, String(r.text).slice(0, 80));
          }
        }
        res.json({ text: r.text, toolCalls: r.toolCalls, endpoint: r.endpoint, reasoningLen: r.reasoningLen ?? 0 }); // v9.111.0（R-3）：透传 reasoning 长度供会话预算
      } catch (e) {
        console.error("[ai] call failed:", e && e.message, "| proxy:", PROXY_URL);
        const msg = String(e?.message ?? "");
        // v9.109.0（L-2）：重试耗尽才到这 —— empty content 透传 error（前端走规则兜底）
        if (/empty content/i.test(msg)) {
          console.warn(`[ai] empty content task=${task}（重试耗尽）`);
          return res.json({ error: "empty content" });
        }
        // v9.113.0（T3-3 降级分真因）：length truncated 与 true empty 区分 —— 200 同口径，前端 reason:"length"
        if (/length truncated/i.test(msg)) {
          console.warn(`[ai] length truncated task=${task}（重试耗尽仍被思考截断）`);
          return res.json({ error: "length truncated" });
        }
        const reason = /timeout|ETIMEDOUT|aborted/i.test(msg) ? "timeout" : /proxy|ENOTFOUND|ECONN/i.test(msg) ? "network" : "model";
        res.status(502).json({ error: msg || "model call failed", reason });
      }
    } catch (e) {
      // v9.109.0（L-2）：外层 catch —— 前置步骤（鉴权/限流/prompt 构建）异常兜底
      console.error("[ai] call failed:", e && e.message, "| proxy:", PROXY_URL);
      const msg = String(e?.message ?? "");
      const reason = /timeout|ETIMEDOUT|aborted/i.test(msg) ? "timeout" : /proxy|ENOTFOUND|ECONN/i.test(msg) ? "network" : "model";
      res.status(502).json({ error: msg || "model call failed", reason });
    }
  });

  // ============== P2-3：流式输出（SSE，供 AIConsole 增量渲染） ==============
  // 请求体同 /api/ai/call（system/user/temperature/maxTokens/thinking）
  // 响应：SSE 流，每行 data: {"delta":"..."}；结束 data: [DONE]
  // 失败：非 2xx + {error}
  app.post("/api/ai/stream", async (req, res) => {
    // v9.85.0（P0-1）：async 鉴权必须 await
    if (!(await checkAuth(req, res))) return;
    const { task, system, user, temperature, maxTokens, thinking } = req.body || {};
    if (!process.env.AI_API_KEY) {
      return res.status(400).json({ error: "server AI key not configured" });
    }
    // v9.85.1（P1-2）：task 白名单 —— 原 stream 不验 task，调用方可提交任意 prompt 当 LLM 代理；
    // 与 /api/ai/call 同口径（quickChat = AIConsole 快速问答）
    const streamTask = String(task || "quickChat");
    if (!TASK_ALLOW.has(streamTask)) {
      return res.status(403).json({ error: "task not allowed: " + streamTask });
    }
    // v9.85.1（P1-2）：system/user 长度上限（防超大 prompt 滥用）
    const sysText = String(system || "").slice(0, 4000);
    const userText = String(user || "").slice(0, 2000);
    if (!userText) return res.status(400).json({ error: "user required" });
    // 用 explain 桶限速（流式走通用分析配额）
    if (!takeToken("explain")) {
      return res.status(429).json({ error: "rate limited", rateLimited: true });
    }
    const baseUrl = process.env.AI_BASE_URL || "https://opencode.ai/zen/go/v1/chat/completions" // v9.110.0（MOD-1 默认值清理）：agnes 已剔除，默认指向 DeepSeek(OpenCode Go);
    const model = process.env.AI_MODEL || "deepseek-v4-flash" // v9.110.0（MOD-1 默认值清理）：agnes 已剔除;
    const body = {
      model,
      messages: [
        { role: "system", content: sysText },
        { role: "user", content: userText },
      ],
      max_tokens: Math.min(Number(maxTokens) || 4000, 8000), // v9.107.0（全站助手）：stream 端点默认 2000→4000
      temperature: Math.max(0, Math.min(1, temperature != null ? Number(temperature) : 0.2)),
      stream: true,
    };
    // v9.109.0（L-1 根治 RC-A）：恒发 enable_thinking（不依赖 AI_PROVIDER 字符串门控）——
    // thinking 非 true 一律 false（实测 opencode 网关接受且 content 正常；原 Agnes 专属注释作废，
    // 见 /api/ai/call 同款改造 :147-149）
    body.chat_template_kwargs = { enable_thinking: Boolean(thinking) };
    const u = new URL(baseUrl);
    const payload = JSON.stringify(body);
    const reqOpts = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        "Authorization": "Bearer " + (process.env.AI_API_KEY || ""),
      },
    };
    // v9.85.0（P0-4）：不再先写 200 —— 先发上游请求，收到上游响应头后再决定状态码。
    // 原实现先 writeHead(200)，上游 4xx/5xx 只能伪装成 SSE error 流（前端当成功）。
    // 同时加 buf 上限（1MB）与背压（res.write 返回 false 时 pause 上游）。
    const upstream = https.request(u, reqOpts, (r) => {
      if (r.statusCode && (r.statusCode < 200 || r.statusCode >= 300)) {
        // 上游失败：透传真实状态码 + JSON error（前端 fetch 会 !resp.ok → 明确失败）
        const chunks = [];
        let total = 0;
        r.on("data", c => { total += c.length; if (total <= 4096) chunks.push(c); });
        r.on("end", () => {
          const detail = Buffer.concat(chunks).toString("utf8").slice(0, 300);
          try { res.status(r.statusCode).json({ error: `upstream ${r.statusCode}`, detail }); } catch { /* 客户端已断开 */ }
        });
        return;
      }
      // 上游 2xx：此时才写 SSE 头
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });
      let buf = "";
      const MAX_BUF = 1024 * 1024; // 1MB 缓冲上限（防异常长行内存压力）
      // v9.108.0（T-1 P0-1）：累计 content 字节（只计 choice.content，不计 reasoning_content）——
      // 上游 empty content（reasoning-only）时注入规则版兜底，杜绝空白答复（ReAct 有 fallbackAnswer，流式此前裸奔）
      let contentLen = 0;
      const safeWrite = (chunk) => {
        try {
          if (res.writableEnded) return false;
          return res.write(chunk);
        } catch { return false; }
      };
      r.on("data", (c) => {
        buf += c.toString("utf8");
        if (buf.length > MAX_BUF) {
          // 缓冲超限：终止上游，断流（防内存无限增长）
          try { upstream.destroy(); res.end(); } catch { /* 静默 */ }
          return;
        }
        // 按行解析 SSE（OpenAI 格式：data: {...}）
        let idx;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line || !line.startsWith("data:")) continue;
          const dataStr = line.slice(5).trim();
          if (dataStr === "[DONE]") {
            safeWrite(`data: [DONE]\n\n`);
            continue;
          }
          try {
            const j = JSON.parse(dataStr);
            const choice = j?.choices?.[0]?.delta ?? {};
            // v9.111.1（S-3）：转发思考过程（reasoning 本就被生成、此前全链路丢弃=白烧；零额外 token，
            // 前端 🤔 思考区展示；正文截断时用户仍能看到推理）
            const reasoning = choice.reasoning_content ?? "";
            if (reasoning) safeWrite(`data: ${JSON.stringify({ reasoning })}\n\n`);
            const delta = choice.content ?? "";
            if (delta) contentLen += delta.length; // v9.108.0（T-1）：累计真实正文（不含 reasoning）
            if (delta && !safeWrite(`data: ${JSON.stringify({ delta })}\n\n`)) {
              // 背压：客户端消费慢 → pause 上游，等 drain 再恢复
              r.pause();
              res.once("drain", () => r.resume());
            }
          } catch { /* 跳过坏行 */ }
        }
      });
      r.on("end", () => {
        // v9.108.0（T-1 P0-1）：正文为空（reasoning-only/empty content）→ 注入兜底（杜绝空白答复）
        // v9.109.0（L-5）：先尝试非流式 chatComplete（自带 empty 重试+thinking 关）回填真实正文，失败再用中性兜底
        if (contentLen === 0) {
          let recovered = null;
          try {
            const { chatComplete } = require("../lib/llmCore");
            (async () => {
              try {
                const r2 = await chatComplete({ system: sysText, user: userText, maxTokens: Number(maxTokens) || 4000, temperature: temperature != null ? Number(temperature) : 0.2, thinking: Boolean(thinking) });
                recovered = r2.text;
              } catch { /* 保持 null */ }
              const fb = recovered || "（AI 本轮未返回内容，以下为本地盘面摘要兜底）盘面数据请以页面卡片为准；如需深入分析请再问一次。";
              safeWrite(`data: ${JSON.stringify({ delta: fb })}\n\n`);
              safeWrite(`data: [DONE]\n\n`);
              try { res.end(); } catch { /* 静默 */ }
            })();
          } catch {
            const fb = "（AI 本轮未返回内容，以下为本地盘面摘要兜底）盘面数据请以页面卡片为准；如需深入分析请再问一次。";
            safeWrite(`data: ${JSON.stringify({ delta: fb })}\n\n`);
            safeWrite(`data: [DONE]\n\n`);
            try { res.end(); } catch { /* 静默 */ }
          }
          return; // 上方异步回填完成时统一收尾
        }
        safeWrite(`data: [DONE]\n\n`);
        try { res.end(); } catch { /* 静默 */ }
      });
      r.on("error", () => {
        try { res.end(); } catch { /* 静默 */ }
      });
    });
    upstream.on("error", () => {
      try { res.status(502).json({ error: "upstream error" }); } catch { /* 客户端已断开 */ }
    });
    // v9.137.0（审查 P2-01 修复）：SSE 上游超时 45s → 90s —— 与 /api/ai/call 的 chatComplete
    //   90s/attempt（llmCore.js）及项目宣称"服务端超时 90s"对齐；长思考（DeepSeek 推理）场景
    //   45s 截断会静默断流（contentLen>0 时不触发空内容兜底，用户只拿到半截答复）。
    upstream.setTimeout(90000, () => { try { upstream.destroy(); } catch { /* 静默 */ } });
    upstream.write(payload);
    upstream.end();
    // 客户端断开 → 终止上游
    res.on("close", () => { try { upstream.destroy(); } catch { /* 静默 */ } });
  });
};
