// ============================================================
// v9.58（V8-9）：全局 AI 结论联动 store —— 一处结论处处可见
// decideForStock 完成 → setStockAI；个股雷达/消息面等组件读 → 旁标 AI 结论，
// 避免"A 页 AI 说可买、到 B 页又看不到"
// v9.92.0（AI 贯穿全局）：通用化 —— 任意模块 AI 结果（主题催化/个股消息分/因子归因/
//   事件深挖）登记后全站可见；模块内 AI（AskAI/就地显示）写入，其他模块读取旁标
// ============================================================

export interface StockAIConclusion {
  code: string;
  verdict: "可买" | "谨慎" | "回避";
  reason: string;
  ts: number;
  /** v9.97.0（批次 2，tinavi basePrice 对照）：结论生成时的基准价（防过期结论误用——如裁决"可买"但股价已涨 20%） */
  basePrice?: number;
}

const stockMap = new Map<string, StockAIConclusion>();

// ============== v9.95.1（第五段 P2）：localStorage 持久化 —— 刷新不丢 ==============
// 背景：验收发现纯内存 Map，刷新即丢；结论跨会话应保留（同一交易日复用，防重复烧 LLM）
// 存储键：ai_stock_conclusions（个股裁决）/ ai_module_results（模块 AI 结果）
// 限量：个股 ≤100、模块 ≤200（防 localStorage 5MB 溢出）；set/prune 后同步落盘
const LS_STOCK_KEY = "ai_stock_conclusions";
const LS_RESULT_KEY = "ai_module_results";
const STOCK_MAX = 100;
const RESULT_MAX = 200;

function persistStockAI(): void {
  try { localStorage.setItem(LS_STOCK_KEY, JSON.stringify([...stockMap.values()].slice(-STOCK_MAX))); } catch { /* 配额满/隐私模式静默 */ }
}

function persistAIResults(): void {
  try { localStorage.setItem(LS_RESULT_KEY, JSON.stringify([...resultMap.values()].slice(-RESULT_MAX))); } catch { /* 静默 */ }
}

function restoreFromStorage(): void {
  try {
    const s = localStorage.getItem(LS_STOCK_KEY);
    if (s) {
      const arr = JSON.parse(s) as StockAIConclusion[];
      for (const c of arr) if (c?.code && c?.verdict && typeof c.ts === "number") stockMap.set(c.code, c);
    }
    const r = localStorage.getItem(LS_RESULT_KEY);
    if (r) {
      const arr = JSON.parse(r) as AIResultEntry[];
      for (const e of arr) if (e?.type && e?.key && typeof e.ts === "number") resultMap.set(`${e.type}:${e.key}`, e);
    }
  } catch { /* 损坏数据忽略 */ }
}
// 注：restoreFromStorage 在文件末尾调用（resultMap 定义于文件后部，TDZ 约束）

export function setStockAI(c: StockAIConclusion): void {
  stockMap.set(c.code, c);
  persistStockAI();
}

export function getStockAI(code: string): StockAIConclusion | undefined {
  return stockMap.get(code);
}

export function getAllStockAI(): StockAIConclusion[] {
  return [...stockMap.values()];
}

/** 清掉超过 24h 的结论（防过期） */
export function pruneStockAI(maxAgeMs = 24 * 3600 * 1000): void {
  const now = Date.now();
  for (const [code, v] of stockMap) {
    if (now - v.ts > maxAgeMs) stockMap.delete(code);
  }
  persistStockAI();
}

// ============== v9.92.0：通用 AI 结果登记（模块结论全站可见） ==============

/** 可登记的模块 AI 结果类型（llmSignals / agentTools / AskAI 产出） */
export type AIResultType =
  | "themeNewsScore"   // 主题催化评分（EventClassifyPanel 主题行）
  | "stockNewsScore"   // 个股消息评分（StockWatchlist 消息区）
  | "factorAttribution"// 因子失效归因（FactorHealthPanel）
  | "eventDeepDive"    // 事件深挖（主题行"问AI"）
  | "themeDiagnosis"   // 主线诊断（MainlineDiagnosisCard）
  | "marginSentiment"  // v9.95.2：两融情绪研判（MarginPanel）
  | "stockAggregate";  // v9.97.0：个股全景聚合研判（StockWatchlist 聚合卡）

export interface AIResultEntry<T = unknown> {
  type: AIResultType;
  /** 业务键（板块名/股票代码等） */
  key: string;
  value: T;
  ts: number;
  /** v9.92.0：来源（"catalyst" 就地计算 / "askai" 手动询问 / "react" 对话内） */
  from?: string;
  /** v9.97.0：结论生成时基准价（防过期误用） */
  basePrice?: number;
}

const resultMap = new Map<string, AIResultEntry>();

/** 登记模块 AI 结果（同 type+key 覆盖；v9.97.0 支持 basePrice 基准价） */
export function setAIResult<T>(type: AIResultType, key: string, value: T, from?: string, basePrice?: number): void {
  resultMap.set(`${type}:${key}`, { type, key, value, ts: Date.now(), from, basePrice });
  persistAIResults();
}

/** 读取模块 AI 结果（无则 undefined） */
export function getAIResult<T = unknown>(type: AIResultType, key: string): AIResultEntry<T> | undefined {
  return resultMap.get(`${type}:${key}`) as AIResultEntry<T> | undefined;
}

/** 按类型读全部（如遍历所有主题催化分） */
export function getAllAIResults(type?: AIResultType): AIResultEntry[] {
  const all = [...resultMap.values()];
  return type ? all.filter(r => r.type === type) : all;
}

/** 清掉超过 N 小时的登记结果（防过期误导） */
export function pruneAIResults(maxAgeMs = 24 * 3600 * 1000): void {
  const now = Date.now();
  for (const [k, v] of resultMap) {
    if (now - v.ts > maxAgeMs) resultMap.delete(k);
  }
  persistAIResults();
}

// 模块加载时恢复持久化结论（两个 Map 均已初始化后执行）
restoreFromStorage();
