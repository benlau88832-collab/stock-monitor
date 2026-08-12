// ============================================================
// server/lib/llmCore.js —— 统一 chat 完成（v9.109.0，L-2 根治 RC-A/B/C）
// 背景：v9.107.x empty content 高发根因（审查《彻底修复方案》）：
//   RC-A enable_thinking 被 AI_PROVIDER 字符串门控 → openai 提供商下永不发 enable_thinking:false
//        → 网关思考默认开 → 只产 reasoning_content 不产 content（实测：显式关后 content 立即正常）
//   RC-B 助手路径（/api/ai/call）无 empty content 重试（cron callModelText 有重试 2 次）
//   RC-C 单端点无 failover（sources.js 已注册 agnes+opencode 双端点但调用代码只用主端点）
// 本模块统一三件事：empty content 重试（重试时强制 enable_thinking:false）+
//   thinking 恒发 enable_thinking（根治 RC-A，实测 opencode 网关接受且 content 正常）+
//   网络/超时端点 failover（根治 RC-C，AI_FALLBACK 环境变量配备用链）。
// ============================================================
const { postJSON, isNetworkErr } = require("./httpProxy");
// v9.109.2（L-6）：端点健康/自愈熔断 —— empty 连续 N 次熔断该端点 M 分钟（llmCore 跳过熔断端点）
const { recordResult, isCircuitOpen } = require("./aiHealth");

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * 端点链：主 + 备用（AI_FALLBACK 格式："base|model|key;base2|model2|key2"，分号分隔多备用）
 */
function endpointChain() {
  const main = {
    base: process.env.AI_BASE_URL || "https://apihub.agnes-ai.cn/v1/chat/completions",
    model: process.env.AI_MODEL || "agnes-2.5-flash",
    key: process.env.AI_API_KEY || "",
  };
  const chain = [main];
  for (const part of String(process.env.AI_FALLBACK || "").split(";").filter(Boolean)) {
    const [base, model, key] = part.split("|");
    if (base) chain.push({ base, model: model || main.model, key: key || main.key });
  }
  return chain;
}

/**
 * 统一 chat 完成（非流式）。
 * - empty content（reasoning-only）：重试 emptyRetries 次，重试时强制 enable_thinking:false（RC-A 残留兜底）
 * - 网络/超时：切下一个端点（failover，RC-C）
 * - 4xx/5xx/坏 JSON：直接抛（不计费不重试）
 * @param opts._post 可选依赖注入（单测用；默认 httpProxy.postJSON）
 * @returns {Promise<{ text: string, toolCalls?: Array<{id,name,args}>, endpoint: number, finish_reason?: string }>}
 */
async function chatComplete(
  { system, user, history = [], tools, maxTokens = 4000, temperature = 0.2, thinking = false, _post },
  { emptyRetries = 2 } = {},
) {
  const post = _post || postJSON;
  const chain = endpointChain();
  let lastErr = null;
  for (let ei = 0; ei < chain.length; ei++) {
    const ep = chain[ei];
    // v9.109.2（L-6）：熔断端点跳过（empty 连续 N 次 → 熔断 M 分钟，到期自动半开放行）
    if (isCircuitOpen(ep.base)) {
      console.warn(`[llmCore] 端点熔断中跳过: ${ep.base}`);
      continue;
    }
    for (let attempt = 0; attempt <= emptyRetries; attempt++) {
      const forceOff = attempt > 0; // empty 重试一律强制关思考
      const body = {
        model: ep.model,
        messages: [...(system ? [{ role: "system", content: system }] : []), ...history, { role: "user", content: user }],
        max_tokens: Math.min(maxTokens, 8000),
        temperature: Math.max(0, Math.min(1, temperature)),
        stream: false,
        // v9.109.0（L-1/L-2）：恒发 enable_thinking（不依赖 AI_PROVIDER 字符串）——
        // thinking 非 true 一律 false（实测 opencode 网关接受且 content 正常；未知字段被忽略）
        chat_template_kwargs: { enable_thinking: forceOff ? false : thinking === true },
      };
      if (Array.isArray(tools) && tools.length) {
        body.tools = tools.map(t => ({ type: "function", function: t }));
      }
      try {
        const json = await post(ep.base, body, 90000, { Authorization: "Bearer " + ep.key });
        const msg = (json && json.choices && json.choices[0] && json.choices[0].message) || {};
        const tc = Array.isArray(msg.tool_calls) && msg.tool_calls.length
          ? msg.tool_calls.map(x => ({ id: String(x.id ?? ""), name: String(x.function?.name ?? ""), args: x.function?.arguments ?? "{}" }))
          : undefined;
        const content = String(msg.content || "").trim();
        if (!content && !tc) {
          recordResult(ep.base, false); // L-6：empty 计数（连续 N 次熔断）
          if (attempt < emptyRetries) {
            console.warn(`[llmCore] empty content endpoint=${ei} retry ${attempt + 1}/${emptyRetries} (force thinking off)`);
            await sleep(1500 * (attempt + 1));
            continue;
          }
          lastErr = new Error("empty content");
          break; // 本端点耗尽 → 换下一个端点
        }
        recordResult(ep.base, true); // L-6：成功清零 streak
        return { text: content, toolCalls: tc, endpoint: ei, finish_reason: json?.choices?.[0]?.finish_reason };
      } catch (e) {
        if (/empty content/i.test(String(e?.message)) && attempt < emptyRetries) continue;
        if (isNetworkErr(e) && ei < chain.length - 1) { lastErr = e; break; } // 网络错 → 换端点
        throw e; // 4xx/5xx/坏 JSON 直接抛
      }
    }
  }
  throw lastErr || new Error("empty content");
}

module.exports = { chatComplete, endpointChain };
