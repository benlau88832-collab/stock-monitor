// AI 设置存储（OpenAI 兼容，多厂商）
export type ProviderId = "agnes" | "deepseek" | "zhipu" | "moonshot" | "qwen" | "openai" | "custom";

export interface ProviderPreset {
  label: string; baseUrl: string; model: string;
  thinking: boolean; supportsThinking: boolean; corsOk: boolean; note?: string;
}
export const PROVIDERS: Record<ProviderId, ProviderPreset> = {
  agnes:    { label: "Agnes 2.5 Flash", baseUrl: "https://apihub.agnes-ai.cn/v1/chat/completions", model: "agnes-2.5-flash", thinking: false, supportsThinking: true, corsOk: true, note: "官方Key·改cn端点·免费flash模型" },
  deepseek: { label: "DeepSeek",        baseUrl: "https://api.deepseek.com/v1/chat/completions", model: "deepseek-chat", thinking: false, supportsThinking: false, corsOk: false, note: "需后端代理" },
  zhipu:    { label: "智谱 GLM",          baseUrl: "https://open.bigmodel.cn/api/paas/v4/chat/completions", model: "glm-4-flash", thinking: false, supportsThinking: true, corsOk: false, note: "需后端代理" },
  moonshot: { label: "Moonshot Kimi",    baseUrl: "https://api.moonshot.cn/v1/chat/completions", model: "moonshot-v1-8k", thinking: false, supportsThinking: false, corsOk: false, note: "需后端代理" },
  qwen:     { label: "通义千问 Qwen",     baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", model: "qwen-plus", thinking: false, supportsThinking: true, corsOk: false, note: "需后端代理" },
  openai:   { label: "OpenAI",           baseUrl: "https://api.openai.com/v1/chat/completions", model: "gpt-4o-mini", thinking: false, supportsThinking: false, corsOk: false, note: "需代理" },
  custom:   { label: "自定义(OpenAI兼容)", baseUrl: "", model: "", thinking: false, supportsThinking: true, corsOk: true },
};

export interface AISettings {
  provider: ProviderId; baseUrl: string; apiKey: string; model: string;
  thinking: boolean; maxTokens: number; // 0 = 用任务默认
}
const KEY = "ai_settings_v1";
function defaults(): AISettings {
  const p = PROVIDERS.agnes;
  return { provider: "agnes", baseUrl: p.baseUrl, apiKey: "", model: p.model, thinking: p.thinking, maxTokens: 0 };
}
export function loadSettings(): AISettings {
  const d = defaults();
  try { const raw = localStorage.getItem(KEY); if (raw) return { ...d, ...JSON.parse(raw) }; } catch {}
  // 迁移旧 key
  try { const old = localStorage.getItem("llm_api_key"); if (old) { d.apiKey = old; saveSettings(d); return d; } } catch {}
  return d;
}
export function saveSettings(s: AISettings): void { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} }
export function applyProvider(id: ProviderId): Partial<AISettings> {
  const p = PROVIDERS[id];
  return { provider: id, baseUrl: p.baseUrl, model: p.model, thinking: p.supportsThinking ? p.thinking : false };
}
// 测试连接
export async function testAISettings(s: AISettings): Promise<{ ok: boolean; msg: string }> {
  if (!s.apiKey || !s.baseUrl || !s.model) return { ok: false, msg: "请先填写 BaseURL/模型/Key" };
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 15000);
    const resp = await fetch(s.baseUrl, {
      method: "POST", headers: { Authorization: `Bearer ${s.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: s.model, messages: [{ role: "user", content: "ping" }], max_tokens: 8, stream: false }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!resp.ok) return { ok: false, msg: `HTTP ${resp.status}` };
    const j = await resp.json();
    return j.error ? { ok: false, msg: j.error.message || "API错误" } : { ok: true, msg: "连接成功" };
  } catch (e: any) {
    return { ok: false, msg: e?.name === "AbortError" ? "超时" : (e?.message || "网络/CORS错误") };
  }
}

// ============== v9.26.2 方案A：服务端 AI 中转（本地部署） ==============
export interface ServerAIConfig { enabled: boolean; provider: string; model: string; }

/** 读取本地服务端 AI 配置（仅本地部署时有效；线上 github.io 返回 null） */
export async function fetchServerAIConfig(): Promise<ServerAIConfig | null> {
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 5000);
    const resp = await fetch("/api/ai/config", { signal: ctrl.signal });
    clearTimeout(t);
    if (!resp.ok) return null;
    const j = await resp.json();
    return j && typeof j.enabled === "boolean"
      ? { enabled: j.enabled, provider: String(j.provider ?? ""), model: String(j.model ?? "") }
      : null;
  } catch { return null; }
}

/** 服务端中转实测（走 /api/ai/call，Key 在服务端 .env，浏览器不持有） */
export async function testServerAI(): Promise<{ ok: boolean; msg: string }> {
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 30000);
    const resp = await fetch("/api/ai/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task: "eventExplain",
        system: "你是一个严谨的A股分析师，回答不超过30字。",
        user: "测试连接：请用一句话说明A股主线是什么。",
        temperature: 0.1,
        maxTokens: 100,
        thinking: false,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!resp.ok) return { ok: false, msg: `服务端 HTTP ${resp.status}` };
    const j = await resp.json();
    if (j.error) return { ok: false, msg: String(j.error) };
    return { ok: true, msg: `服务端调通：${String(j.text ?? "").slice(0, 36)}` };
  } catch (e: any) {
    return { ok: false, msg: e?.name === "AbortError" ? "服务端超时" : (e?.message || "服务端不可达") };
  }
}
