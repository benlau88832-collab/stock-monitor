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
}

const stockMap = new Map<string, StockAIConclusion>();

export function setStockAI(c: StockAIConclusion): void {
  stockMap.set(c.code, c);
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
}

// ============== v9.92.0：通用 AI 结果登记（模块结论全站可见） ==============

/** 可登记的模块 AI 结果类型（llmSignals / agentTools / AskAI 产出） */
export type AIResultType =
  | "themeNewsScore"   // 主题催化评分（EventClassifyPanel 主题行）
  | "stockNewsScore"   // 个股消息评分（StockWatchlist 消息区）
  | "factorAttribution"// 因子失效归因（FactorHealthPanel）
  | "eventDeepDive";   // 事件深挖（主题行"问AI"）

export interface AIResultEntry<T = unknown> {
  type: AIResultType;
  /** 业务键（板块名/股票代码等） */
  key: string;
  value: T;
  ts: number;
  /** v9.92.0：来源（"catalyst" 就地计算 / "askai" 手动询问 / "react" 对话内） */
  from?: string;
}

const resultMap = new Map<string, AIResultEntry>();

/** 登记模块 AI 结果（同 type+key 覆盖） */
export function setAIResult<T>(type: AIResultType, key: string, value: T, from?: string): void {
  resultMap.set(`${type}:${key}`, { type, key, value, ts: Date.now(), from });
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
}
