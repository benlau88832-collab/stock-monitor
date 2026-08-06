// ============================================================
// v9.58（V8-9）：全局 AI 结论联动 store —— 一处结论处处可见
// decideForStock 完成 → setStockAI；个股雷达/消息面等组件读 → 旁标 AI 结论，
// 避免"A 页 AI 说可买、到 B 页又看不到"
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
