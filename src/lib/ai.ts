// AI 统一调用中枢（多模型支持）
// 机制：缓存(秒开+防重复) / 单飞(去重) / 分钟限速 / 降级

import { type AITask, type AITaskPayload, FALLBACKS, buildPrompt, TASK_CONFIG } from "./aiPrompts";
import { loadSettings, saveSettings } from "./aiSettings";
import { localDateStr } from "./format";
import { isLocalServer } from "./cloudStore";

// ============== Agnes 备用域名（仅 provider=agnes 时作 fallback） ==============
// v9.26.2：官方公告国际站用户改 Endpoint 为 .cn 继续用原 Key（apihub.agnes-ai.cn 是国际站镜像端点）
export const AGNES_ENDPOINTS = [
  "https://apihub.agnes-ai.cn/v1/chat/completions",
] as const;

// v9.26.2：按用户要求用回 agnes-2.5-flash（免费模型；agnes-2.5-pro 需付费）
export const AGNES_MODEL = "agnes-2.5-flash";

// ============== API Key 读写（兼容旧调用方签名） ==============
export const APIKEY_STORAGE_KEY = "llm_api_key";

// ============== v9.26.7：可用 AI 检测（浏览器 Key 或服务端中转均可） ==============
let serverAICached: { ok: boolean; ts: number } | null = null;
const SERVER_CHECK_TTL = 30_000; // 30 秒缓存，避免每次渲染都 fetch
/**
 * 是否存在可用的 AI 通道：
 *   ① 浏览器 localStorage 有 apiKey（浏览器直连模式）
 *   ② 本地服务端已配置 AI_API_KEY（服务端中转模式）
 * 用于前端组件判断"立即分析"按钮是否可点、是否显示"请配置 Key"提示
 */
export async function hasAvailableAI(): Promise<boolean> {
  // 浏览器有 Key 直接可用
  if (loadSettings().apiKey) return true;
  // 服务端模式：fetch /api/ai/config 看是否 enabled
  if (!isLocalServer()) return false;
  if (serverAICached && Date.now() - serverAICached.ts < SERVER_CHECK_TTL) return serverAICached.ok;
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 5000);
    const resp = await fetch("/api/ai/config", { signal: ctrl.signal });
    clearTimeout(t);
    const j = await resp.json();
    serverAICached = { ok: Boolean(j?.enabled), ts: Date.now() };
    return serverAICached.ok;
  } catch {
    return false;
  }
}

/** 同步估算（用于初始渲染占位，不阻塞）：有浏览器 Key 立即 true，否则假定服务端可用给乐观状态 */
export function hasAIOptimistic(): boolean {
  return Boolean(loadSettings().apiKey) || isLocalServer();
}

export function getApiKey(): string { return loadSettings().apiKey; }
export function setApiKey(key: string): void {
  const s = loadSettings(); s.apiKey = key; saveSettings(s);
}

// ============== 常量（可调，注释说明用途） ==============

/** 单次请求超时(ms)：思考模式长 prompt 需要更多时间 */
const AI_TIMEOUT_MS = 30_000;

/** ai:cache:* 条目上限，超过按时间删最旧 */
const MAX_CACHE_ENTRIES = 300;

/** AI 缓存 TTL(ms)：2 小时。盘前预案类任务不应永远命中旧结果，超过 TTL 强制重打。 */
const CACHE_TTL_MS = 2 * 60 * 60 * 1000;

/** 每分钟滑动窗口限速：超过直接走规则版，不排队等待 */
export const AI_RATE_PER_MIN = 10;

// ============== 返回类型 ==============
export interface AIResult {
  text: string;
  /** true = 命中缓存 */
  fromCache: boolean;
  /** true = 走了规则降级 */
  degraded: boolean;
  /** 请求耗时(ms)；缓存命中为0 */
  latencyMs: number;
}

// ============== 缓存层 ==============
// key: ai:cache:task:YYYY-MM-DD:hash   value: {text, ts}

function simpleHash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return h >>> 0; // 转无符号
}

function cacheKey(task: AITask, payload: unknown): string {
  // 修复：用本地日期（CST 凌晨 0-8 点 toISOString 仍返回昨天，会导致缓存命中旧结果）
  const today = localDateStr();
  const h = simpleHash(JSON.stringify(payload) || "");
  return `ai:cache:${task}:${today}:${h}`;
}

function getCache(key: string): string | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { text, ts } = JSON.parse(raw);
    // TTL 校验：超过 CACHE_TTL_MS 视为过期，强制重新请求
    if (ts != null && Date.now() - ts > CACHE_TTL_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return text ?? null;
  } catch { return null; }
}

function setCache(key: string, text: string): void {
  try {
    localStorage.setItem(key, JSON.stringify({ text, ts: Date.now() }));
    pruneCache();
  } catch { /* localStorage 满 → 静默 */ }
}

function pruneCache(): void {
  try {
    const entries: { key: string; ts: number }[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith("ai:cache:")) {
        try {
          const { ts } = JSON.parse(localStorage.getItem(k)!);
          entries.push({ key: k, ts: ts ?? 0 });
        } catch { entries.push({ key: k, ts: 0 }); }
      }
    }
    if (entries.length <= MAX_CACHE_ENTRIES) return;
    entries.sort((a, b) => a.ts - b.ts);
    const toDelete = entries.length - MAX_CACHE_ENTRIES;
    for (let i = 0; i < toDelete; i++) localStorage.removeItem(entries[i].key);
  } catch { /* 静默 */ }
}

// ============== 分钟限速（滑动窗口，v9.26 F-04：预留-释放模型） ==============
// 旧版：请求开始前检查+失败不占配额 → 并发可超限、失败不计数
// 新版：请求开始时先占位（reserveSlot），失败时释放（releaseSlot）—— 只有真实成功才占配额
// v9.26.9：修复双计数（成功不再重复 push）+ 按时间戳精确释放（并发安全）
// v9.26.10：token 模型 —— reserveSlot 返回唯一 token，releaseSlot(token) 精确释放自己（并发错配修复）
const recentCalls: number[] = []; // timestamps of reserved API calls

/** 占位成功返回 token（时间戳+序号），失败返回 null */
function reserveSlot(): number | null {
  const now = Date.now();
  // 清除 1 分钟前的记录
  while (recentCalls.length > 0 && recentCalls[0] < now - 60_000) {
    recentCalls.shift();
  }
  if (recentCalls.length >= AI_RATE_PER_MIN) return null;
  const token = now * 1000 + (recentCalls.length % 1000); // 时间戳+序号，保证唯一
  recentCalls.push(token);
  return token;
}

/** 失败时释放自己占的槽位（按 token 精确删除，并发安全） */
function releaseSlot(token: number | null): void {
  if (token == null) return;
  const idx = recentCalls.indexOf(token);
  if (idx >= 0) recentCalls.splice(idx, 1);
}

/** 统计成功调用（不再往 recentCalls 加第二次 —— 避免双计数） */
function recordCall(): void {
  // 占位已由 reserveSlot 记录，这里仅推进统计计数（stats 用）
}

// ============== 每日统计 ==============
interface DailyStats {
  calls: number;
  totalLatency: number;
  failures: number;
}

function statsKey(): string {
  // 修复：与 cacheKey 对齐用本地日期，避免凌晨跨日统计错位
  return `ai:stats:${localDateStr()}`;
}

function loadStats(): DailyStats {
  try {
    const raw = localStorage.getItem(statsKey());
    return raw ? JSON.parse(raw) : { calls: 0, totalLatency: 0, failures: 0 };
  } catch { return { calls: 0, totalLatency: 0, failures: 0 }; }
}

function saveStats(s: DailyStats): void {
  try { localStorage.setItem(statsKey(), JSON.stringify(s)); } catch { /* 静默 */ }
}

function recordSuccess(latencyMs: number): void {
  const s = loadStats();
  s.calls++;
  s.totalLatency += latencyMs;
  saveStats(s);
}

function recordFailure(): void {
  const s = loadStats();
  s.calls++;
  s.failures++;
  saveStats(s);
}

/** 导出供调试/显示 */
export function getAIStats(): DailyStats & { avgLatency: number } {
  const s = loadStats();
  return { ...s, avgLatency: s.calls > 0 ? Math.round(s.totalLatency / s.calls) : 0 };
}

/** 今日调用次数（顶栏显示用） */
export function getTodayCalls(): number {
  return loadStats().calls;
}

// ============== 单飞控制 ==============
const inflightMap = new Map<string, Promise<AIResult>>();

// ============== 核心：callAI ==============
/**
 * 统一 AI 调用入口
 * @param task    任务类型
 * @param payload 传给模板函数的数据
 * @returns {text, fromCache, degraded, latencyMs}
 *
 * 优先级：缓存 → 限速检查 → 真实调用(主域名→备域名) → 规则版降级
 */
export function callAI<T extends AITask>(
  task: T,
  payload: AITaskPayload[T],
): Promise<AIResult> {
  const ck = cacheKey(task, payload);

  // 1. 缓存命中
  const cached = getCache(ck);
  if (cached) {
    return Promise.resolve({ text: cached, fromCache: true, degraded: false, latencyMs: 0 });
  }

  // 2. 单飞
  const existing = inflightMap.get(ck);
  if (existing) return existing;

  // 3. 实际执行
  const promise = executeAI(task, payload, ck);
  inflightMap.set(ck, promise);
  return promise;
}

// ============== v9.26 F-03：服务端 AI 中转（本地部署时 Key 只存服务端 .env） ==============
async function callAIviaServer(
  task: AITask,
  system: string,
  user: string,
  config: { temperature: number; maxTokens: number; thinking: boolean },
): Promise<{ text: string; error?: string } | null> {
  if (!isLocalServer()) return null;
  // v9.26.5：加 35s 超时（服务端 postJSON 30s 超时兜底；避免 fetch 无限等待拖垮页面）
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 35_000);
  try {
    const resp = await fetch("/api/ai/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task,
        system,
        user,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        thinking: config.thinking,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) {
      // v9.26.5：429/403 等错误透传给上层（不再静默 return null 导致误判"服务端不可用"去走本地Key降级）
      let errMsg = `服务端拒绝(HTTP ${resp.status})`;
      try { const j = await resp.json(); if (j?.error) errMsg = j.error; } catch { /* keep */ }
      return { text: "", error: errMsg };
    }
    const j = await resp.json();
    if (j.error) return { text: "", error: j.error };
    return { text: j.text ?? "" };
  } catch (e) {
    clearTimeout(timer);
    if (e instanceof DOMException && e.name === "AbortError") return { text: "", error: "服务端超时(35s)" };
    return null; // 网络错误 → 回退本地
  }
}

async function executeAI<T extends AITask>(
  task: T,
  payload: AITaskPayload[T],
  ck: string,
): Promise<AIResult> {
  let slotToken: number | null = null; // v9.26.10：try 外声明，catch/finally 可访问
  try {
    // v9.26 F-04：请求预留限速（失败路径 releaseSlot 释放配额）
    slotToken = reserveSlot(); // v9.26.10：token 模型，失败精确释放自己
    if (slotToken == null) {
      return degradeResult(task, payload, "每分钟限速");
    }

    const settings = loadSettings();

    // v9.26 F-03：本地部署时优先走服务端中转（Key 在服务端，浏览器不持有）
    const { system, user } = buildPrompt(task, payload);
    const config = TASK_CONFIG[task];
    const startTs = Date.now();
    const serverR = await callAIviaServer(task, system, user, config);
    if (serverR && !serverR.error && serverR.text) {
      // v9.26.9：补缓存 + 统计（此前漏记 → 缓存永不生效、今日调用数恒 0）
      const latency = Date.now() - startTs;
      recordCall();
      recordSuccess(latency);
      setCache(ck, serverR.text);
      return { text: serverR.text, fromCache: false, degraded: false, latencyMs: latency };
    }
    if (serverR?.error) {
      console.warn("[AI] 服务端中转失败:", serverR.error);
    }

    const apiKey = settings.apiKey;
    if (!apiKey) {
      releaseSlot(slotToken); // 未真正调用模型 → 释放配额
      // v9.26.5：服务端有明确错误（限速/超时/任务拒绝）时如实展示，不再误导为"未配置Key"
      const reason = serverR?.error
        ? `服务端AI失败(${serverR.error})`
        : "未配置API Key（浏览器直连模式需在设置面板填写）";
      return degradeResult(task, payload, reason);
    }

    const effectiveMaxTokens = settings.maxTokens > 0 ? Math.min(settings.maxTokens, config.maxTokens) : config.maxTokens;

    // 构建请求 body（用设置中的模型名）
    const buildBody = (thinking: boolean) => {
      const body: Record<string, unknown> = {
        model: settings.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        max_tokens: effectiveMaxTokens,
        temperature: config.temperature,
        stream: false,
      };
      // Thinking 开关：用户设置 ∧ 任务允许
      // v9.26.1：agnes 系模型必须显式传 enable_thinking（false 也要传，否则默认思考 content 为空）
      if (settings.provider === "agnes") {
        body.chat_template_kwargs = { enable_thinking: Boolean(thinking) };
      } else if (thinking) {
        body.chat_template_kwargs = { enable_thinking: true };
      }
      return body;
    };

    const start = Date.now();

    // 构建端点列表：settings.baseUrl 为主；agnes 厂商额外加备用域名（v9.24.2 已移除 .com 失效端点）
    const endpoints = [settings.baseUrl];
    if (settings.provider === "agnes") {
      for (const ep of AGNES_ENDPOINTS) {
        if (ep !== settings.baseUrl) endpoints.push(ep);
      }
    }

    // 遍历端点 × thinking 模式，任一成功即返回
    // thinking=true 失败（空/异常）→ 回退 thinking=false 重试同端点
    // 端点失败 → 下一个端点
    let lastError = "网络错误";
    for (let i = 0; i < endpoints.length; i++) {
      const endpoint = endpoints[i];
      const useThinking = settings.thinking && config.thinking;
      const variants: boolean[] = useThinking ? [true, false] : [false];

      for (const tryThinking of variants) {
        try {
          const result = await fetchWithTimeout(endpoint, apiKey, buildBody(tryThinking));
          const latency = Date.now() - start;

          if (result.error) {
            lastError = result.error;
            // 4xx = 客户端错误(key/模型/参数)，直接降级不再重试
            if (result.status && result.status >= 400 && result.status < 500) {
              releaseSlot(slotToken); // 4xx 未真正消耗模型配额 → 释放占位
              recordFailure();
              return degradeResult(task, payload, result.error);
            }
            // 5xx/其他 → 思考模式先回退关思考再试；否则跳下一个端点
            console.warn(`[AI] 端点${i} thinking=${tryThinking} 报错:`, result.error);
            continue;
          }

          const text = result.text;
          if (!text || text.trim().length < 5) {
            // 思考模式返回空 → 不直接降级，给 thinking=false 一次机会
            console.warn(`[AI] 端点${i} thinking=${tryThinking} 返回空 (text.length=${text?.length ?? 0})`);
            lastError = "返回内容为空";
            if (tryThinking) continue;  // 回退到 thinking=false
            break;  // thinking=false 也空 → 跳下一个端点
          }

          // 成功
          recordCall();
          recordSuccess(latency);
          setCache(ck, text);
          return { text, fromCache: false, degraded: false, latencyMs: latency };
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : "网络错误";
          console.warn(`[AI] 端点${i} thinking=${tryThinking} 异常:`, errMsg);
          lastError = errMsg;
          if (tryThinking) continue;  // 回退到 thinking=false
          break;  // thinking=false 也异常 → 跳下一个端点
        }
      }
    }

    // 所有端点+模式都失败（v9.26 F-04：失败释放配额）
    recordFailure();
    releaseSlot(slotToken);
    return degradeResult(task, payload, lastError);
  } catch (e) {
    // v9.26.10：buildPrompt/内部异常 → 释放配额 + 降级（防 slot 泄漏 60s）
    releaseSlot(slotToken);
    const msg = e instanceof Error ? e.message : "未知错误";
    return degradeResult(task, payload, msg);
  } finally {
    inflightMap.delete(ck);
  }
}

// ============== 带超时的 fetch 封装 ==============
interface FetchResult {
  text: string;
  error?: string;
  status?: number;
}

async function fetchWithTimeout(
  endpoint: string,
  apiKey: string,
  body: Record<string, unknown>,
): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const json = await resp.json();
    if (json.error) {
      return { text: "", error: json.error.message || "API错误", status: resp.status };
    }
    const msg = json.choices?.[0]?.message ?? {};
    // F-06 修复：reasoning_content（思维链）不是业务答案，绝不能当 content 用
    //（JSON 任务拿推理文本解析必失败）。content 为空 = 未生成最终答案 → 协议错误，
    // 上层会重试 thinking=false 或跳到下一端点。
    if (!msg.content) {
      console.warn("[AI] content为空 finish_reason=", json.choices?.[0]?.finish_reason);
      return { text: "", error: "empty content (reasoning only)", status: resp.status };
    }
    const text = msg.content;
    return { text, status: resp.status };
  } catch (err) {
    clearTimeout(timer);
    const msg = err instanceof DOMException && err.name === "AbortError"
      ? "30s超时" : "网络错误";
    throw new Error(msg);
  }
}

// ============== 降级 ==============
function degradeResult<T extends AITask>(
  task: T,
  payload: AITaskPayload[T],
  reason: string,
): AIResult {
  try {
    const fallback = FALLBACKS[task];
    const text = fallback
      ? `⚡ 规则版（${reason}）\n\n${fallback(payload)}`
      : `⚡ AI暂不可用（${reason}），请稍后重试`;
    return { text, fromCache: false, degraded: true, latencyMs: 0 };
  } catch {
    return { text: `⚡ AI暂不可用（${reason}）`, fromCache: false, degraded: true, latencyMs: 0 };
  }
}

// ============== JSON 鲁棒解析 ==============
/**
 * 解析 AI 返回的 JSON：
  * a. 剥除 ```代码围栏
  * b. 正则提取第一个 [ ... ] 或 { ... } 完整结构
  * c. JSON.parse 失败返回 null
  * d. 数组任务逐元素校验字段，坏元素丢弃保留其余
  * v9.75（阶段三）：增强容错 —— 完整 parse 失败时尝试"截到最后一个完整对象再补 ]"，
  *   解决 LLM 输出被 max_tokens 截断导致尾部残缺数组整体丢失的问题
  */
export function parseAIJSON<T = unknown>(
  raw: string,
  requiredFields?: string[],
): T | null {
  if (!raw) return null;
  const tryParse = (text: string): T | null => {
    try { return JSON.parse(text) as T; } catch { return null; }
  };
  const validateArray = (arr: unknown[]): unknown[] | null => {
    if (!requiredFields || requiredFields.length === 0) return arr;
    const valid = arr.filter((item) => {
      if (!item || typeof item !== "object") return false;
      return requiredFields.every((f) => f in (item as Record<string, unknown>));
    });
    return valid.length > 0 ? valid : null;
  };

  try {
    // a. 剥除代码围栏 ```json ... ``` 或 ``` ... ```
    let cleaned = raw.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();

    // b. 提取第一个 [ ... ] 或 { ... }
    const arrMatch = cleaned.match(/\[[\s\S]*\]/);
    const objMatch = cleaned.match(/\{[\s\S]*\}/);

    let target: string | null = null;
    if (arrMatch && objMatch) {
      // 取出现位置更靠前的那个
      target = (arrMatch.index ?? Infinity) < (objMatch.index ?? Infinity)
        ? arrMatch[0] : objMatch[0];
    } else {
      target = arrMatch?.[0] ?? objMatch?.[0] ?? null;
    }

    if (!target) return null;

    // c. JSON.parse（完整尝试）
    const parsed = tryParse(target);
    if (parsed !== null) {
      if (Array.isArray(parsed)) return (validateArray(parsed) as unknown as T) ?? null;
      return parsed;
    }

    // c2. v9.75（阶段三）：截断容错 —— LLM 输出被 max_tokens 截断时，
    //     从最后一个 `}` 处截断并补 `]` 重试（数组场景），避免整段丢失
    if (target.startsWith("[")) {
      for (let idx = target.lastIndexOf("}"); idx > 0; idx = target.lastIndexOf("}", idx - 1)) {
        const partial = target.slice(0, idx + 1) + "]";
        const p = tryParse(partial);
        if (p !== null) {
          if (Array.isArray(p)) return (validateArray(p) as unknown as T) ?? null;
          return p;
        }
      }
    }

    // d. 数组任务校验字段
    if (Array.isArray(parsed)) {
      const valid = validateArray(parsed);
      return (valid as unknown as T) ?? null;
    }

    return parsed as T;
  } catch {
    return null;
  }
}

// ============================================================
// v9.41（V4-A）：Agent 原生 tool_calls 通道（真·多轮 ReAct）
// 不走 callAI 缓存体系（Agent 循环是动态多轮的，缓存无意义）。
// 本地部署走 /api/ai/call（服务端透传 tools/tool_choice，返回 toolCalls）；
// 线上 GitHub Pages 无后端 → 返回 null（调用方回退规则）。
// ============================================================
export interface AgentToolCall {
  id: string;
  name: string;
  args: string; // JSON 字符串
}
export interface AgentChatResult {
  text: string;
  toolCalls?: AgentToolCall[];
  /** v9.45（V5-1）：true = 服务端配额受限（429，非模型不可用）→ 前端显式标注，不静默降级 */
  rateLimited?: boolean;
  /** v9.67：降级原因（rateLimited / timeout / network / model）→ 前端区分文案 */
  reason?: "rateLimited" | "timeout" | "network" | "model";
}

/** 单轮 Agent 对话（带工具清单；LLM 可选择返回 tool_calls 或直接出文本） */
export async function callAgentChat(
  system: string,
  user: string,
  tools: Array<{ name: string; description: string }>,
  opts?: {
    temperature?: number;
    maxTokens?: number;
    /** v9.66.1：多轮对话历史（AIConsole 深度调研衔接上文） */
    history?: Array<{ role: "user" | "assistant"; content: string }>;
  },
): Promise<AgentChatResult | null> {
  if (!isLocalServer()) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 35_000);
  try {
    const resp = await fetch("/api/ai/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task: "agentReason",
        system,
        user,
        temperature: opts?.temperature ?? 0.2,
        maxTokens: opts?.maxTokens ?? 2000,
        thinking: false,
        tools,
        history: opts?.history ?? [],
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) {
      // v9.45（V5-1）：429 配额受限 → 显式标记（区别于"服务端不可用"），AI 不再静默退回规则
      if (resp.status === 429) {
        try { const j = await resp.json(); if (j?.rateLimited) return { text: "", rateLimited: true, reason: "rateLimited" }; } catch { /* keep */ }
      }
      // v9.67：502/500 区分降级原因
      try {
        const j = await resp.json();
        const reason = (j?.reason === "timeout" || j?.reason === "network" || j?.reason === "model") ? j.reason : "model";
        return { text: "", rateLimited: false, reason };
      } catch { return { text: "", reason: "model" }; }
    }
    const j = await resp.json();
    if (j.error) return { text: "", reason: "model" };
    return { text: j.text ?? "", toolCalls: j.toolCalls };
  } catch {
    clearTimeout(timer);
    return { text: "", reason: "network" };
  }
}
