// AI 统一调用中枢（多模型支持）
// 机制：缓存(秒开+防重复) / 单飞(去重) / 分钟限速 / 降级

import { type AITask, type AITaskPayload, FALLBACKS, buildPrompt, TASK_CONFIG } from "./aiPrompts";
import { loadSettings, saveSettings } from "./aiSettings";

// ============== Agnes 备用域名（仅 provider=agnes 时作 fallback） ==============
export const AGNES_ENDPOINTS = [
  "https://apihub.agnes-ai.cn/v1/chat/completions",
  "https://apihub.agnes-ai.com/v1/chat/completions",
] as const;

export const AGNES_MODEL = "agnes-2.5-flash";

// ============== API Key 读写（兼容旧调用方签名） ==============
export const APIKEY_STORAGE_KEY = "llm_api_key";

export function getApiKey(): string { return loadSettings().apiKey; }
export function setApiKey(key: string): void {
  const s = loadSettings(); s.apiKey = key; saveSettings(s);
}

// ============== 常量（可调，注释说明用途） ==============

/** 单次请求超时(ms)：思考模式长 prompt 需要更多时间 */
const AI_TIMEOUT_MS = 30_000;

/** ai:cache:* 条目上限，超过按时间删最旧 */
const MAX_CACHE_ENTRIES = 300;

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
  const today = new Date().toISOString().slice(0, 10);
  const h = simpleHash(JSON.stringify(payload) || "");
  return `ai:cache:${task}:${today}:${h}`;
}

function getCache(key: string): string | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { text } = JSON.parse(raw);
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

// ============== 分钟限速（滑动窗口） ==============
const recentCalls: number[] = []; // timestamps of real API calls

function isRateLimited(): boolean {
  const now = Date.now();
  // 清除 1 分钟前的记录
  while (recentCalls.length > 0 && recentCalls[0] < now - 60_000) {
    recentCalls.shift();
  }
  return recentCalls.length >= AI_RATE_PER_MIN;
}

function recordCall(): void {
  recentCalls.push(Date.now());
}

// ============== 每日统计 ==============
interface DailyStats {
  calls: number;
  totalLatency: number;
  failures: number;
}

function statsKey(): string {
  return `ai:stats:${new Date().toISOString().slice(0, 10)}`;
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

async function executeAI<T extends AITask>(
  task: T,
  payload: AITaskPayload[T],
  ck: string,
): Promise<AIResult> {
  try {
    // 限速检查
    if (isRateLimited()) {
      return degradeResult(task, payload, "每分钟限速");
    }

    const settings = loadSettings();
    const apiKey = settings.apiKey;
    if (!apiKey) {
      return degradeResult(task, payload, "未配置API Key");
    }

    const { system, user } = buildPrompt(task, payload);
    const config = TASK_CONFIG[task];
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
      if (thinking) {
        body.chat_template_kwargs = { enable_thinking: true };
      }
      return body;
    };

    const start = Date.now();

    // 构建端点列表：settings.baseUrl 为主；agnes 厂商额外加备用域名
    const endpoints = [settings.baseUrl];
    if (settings.provider === "agnes" && !endpoints.includes(AGNES_ENDPOINTS[1])) {
      endpoints.push(AGNES_ENDPOINTS[1]);
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

    // 所有端点+模式都失败
    recordFailure();
    return degradeResult(task, payload, lastError);
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
    // 思考模式下 agnes 把答案放 reasoning_content，content 为空；需 fallback 读取
    const text = msg.content || msg.reasoning_content || "";
    if (!msg.content) console.warn("[AI] content空 finish_reason=", json.choices?.[0]?.finish_reason, "raw=", json);
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
 */
export function parseAIJSON<T = unknown>(
  raw: string,
  requiredFields?: string[],
): T | null {
  if (!raw) return null;
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

    // c. JSON.parse
    const parsed = JSON.parse(target);

    // d. 数组任务校验字段
    if (Array.isArray(parsed) && requiredFields && requiredFields.length > 0) {
      const valid = parsed.filter((item) => {
        if (!item || typeof item !== "object") return false;
        return requiredFields.every((f) => f in item);
      });
      return valid.length > 0 ? (valid as unknown as T) : null;
    }

    return parsed as T;
  } catch {
    return null;
  }
}
