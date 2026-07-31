// 情报金字塔长周期记忆库 v2
// 支持分段存储（盘前/早盘/午盘/盘后/终盘）+ 终盘定格
// 保留 30 个交易日，为 AI 长上下文研判提供历史记忆

const MEMO_PREFIX = "news_memo_";
const SEG_PREFIX = "intel_seg_";
const MAX_DAYS = 30;

// ============== slot 枚举（与 NewsPanel 一致） ==============
export type IntelSlot = "pre" | "morning" | "noon" | "afterclose" | "final" | "manual";

// ============== 核心数据结构 v2 ==============
export interface DailyNewsMemo {
  date: string;          // 交易日 YYYYMMDD
  cycleStage: "启动期" | "发酵期" | "高潮期" | "分歧期" | "退潮期";
  focusThemes: string[];
  positiveIndustries: Array<{ name: string; count: number; resonance: boolean; source: string }>;
  negativeIndustries: Array<{ name: string; count: number; source: string }>;
  topEvents: Array<{ title: string; stars: number; impact: string; source: string; sourceUrl?: string }>;
  whatMarketTrades: string;  // v2: 市场在交易什么（带数字）
  trend: string;              // v2: 当前趋势研判
  directionAdvice: string;
  rawSummary: string;
  updatedAt: number;
}

export interface SegmentMemo extends DailyNewsMemo {
  slot: IntelSlot;
  slotTime: string;  // HH:MM
}

// ============== 终盘存储 ==============
export function saveDailyMemo(memo: DailyNewsMemo): void {
  try {
    localStorage.setItem(MEMO_PREFIX + memo.date, JSON.stringify(memo));
    pruneOld();
  } catch { /* 满→静默 */ }
}

export function loadDailyMemo(date: string): DailyNewsMemo | null {
  try {
    const raw = localStorage.getItem(MEMO_PREFIX + date);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function getRecentMemos(days = 7): DailyNewsMemo[] {
  const keys = getAllKeys(MEMO_PREFIX);
  const memos: DailyNewsMemo[] = [];
  for (const key of keys.slice(0, days)) {
    try { const r = localStorage.getItem(key); if (r) memos.push(JSON.parse(r)); } catch {}
  }
  memos.sort((a, b) => a.date.localeCompare(b.date));
  return memos;
}

// ============== 分段存储 ==============
export function saveSegmentMemo(date: string, slot: IntelSlot, memo: DailyNewsMemo): void {
  const now = new Date();
  const bj = new Date(now.getTime() + (now.getTimezoneOffset() + 480) * 60000);
  const slotTime = `${String(bj.getHours()).padStart(2, "0")}:${String(bj.getMinutes()).padStart(2, "0")}`;
  const segMemo: SegmentMemo = { ...memo, slot, slotTime };
  try {
    localStorage.setItem(`${SEG_PREFIX}${date}_${slot}`, JSON.stringify(segMemo));
    pruneOld();
  } catch { /* 满→静默 */ }
}

export function getSegmentMemos(date: string): SegmentMemo[] {
  const result: SegmentMemo[] = [];
  const slotOrder: IntelSlot[] = ["pre", "morning", "noon", "afterclose", "final", "manual"];
  for (const slot of slotOrder) {
    try {
      const raw = localStorage.getItem(`${SEG_PREFIX}${date}_${slot}`);
      if (raw) result.push(JSON.parse(raw));
    } catch {}
  }
  return result;
}

// ============== 清理 ==============
function getAllKeys(prefix: string): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(prefix)) keys.push(k);
  }
  return keys.sort().reverse();
}

function pruneOld(): void {
  try {
    // 终盘 key
    const memoKeys = getAllKeys(MEMO_PREFIX);
    if (memoKeys.length > MAX_DAYS) {
      for (let i = MAX_DAYS; i < memoKeys.length; i++) localStorage.removeItem(memoKeys[i]);
    }
    // 分段 key：提取日期部分，删除超出 MAX_DAYS 的日期的所有分段
    const segKeys = getAllKeys(SEG_PREFIX);
    const segDates = new Set<string>();
    for (const k of segKeys) {
      const m = k.match(/intel_seg_(\d{8})_/);
      if (m) segDates.add(m[1]);
    }
    const sortedDates = [...segDates].sort().reverse();
    const expiredDates = new Set(sortedDates.slice(MAX_DAYS));
    for (const k of segKeys) {
      const m = k.match(/intel_seg_(\d{8})_/);
      if (m && expiredDates.has(m[1])) localStorage.removeItem(k);
    }
  } catch {}
}

// ============== 导出/导入 ==============
export function exportMemoBackup(): void {
  const keys = [...getAllKeys(MEMO_PREFIX), ...getAllKeys(SEG_PREFIX)];
  const data: Record<string, unknown> = {};
  for (const key of keys) {
    try { const r = localStorage.getItem(key); if (r) data[key] = JSON.parse(r); } catch {}
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `stock-monitor-memos-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function importMemoBackup(jsonString: string): boolean {
  try {
    const data = JSON.parse(jsonString);
    if (typeof data !== "object" || data === null) return false;
    let count = 0;
    for (const [key, value] of Object.entries(data)) {
      if ((key.startsWith(MEMO_PREFIX) || key.startsWith(SEG_PREFIX)) && value && typeof value === "object") {
        localStorage.setItem(key, JSON.stringify(value));
        count++;
      }
    }
    return count > 0;
  } catch { return false; }
}
