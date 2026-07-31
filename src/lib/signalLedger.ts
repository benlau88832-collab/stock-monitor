// 信号账本：记录系统触发的交易信号，并在之后回填 T+1/T+5 收益率
// 用于"信号→验证→复盘"闭环

const LEDGER_KEY = "signal_ledger";
const MAX_ENTRIES = 500;

export interface SignalEntry {
  id: string;           // 唯一ID（日期+类型+代码）
  date: string;         // 触发日期 YYYY-MM-DD
  type: "veto" | "quadrant" | "cycle" | "sentiment_cross";
  typeLabel: string;    // 显示名称
  code: string;         // 标的代码（市场级信号用 "MARKET"）
  name: string;         // 标的名称
  priceAtSignal: number;// 信号触发时价格
  description: string;  // 信号描述
  // 回填字段（补过一次后不再更新）
  priceT1: number | null;   // T+1 收盘价
  priceT5: number | null;   // T+5 收盘价
  returnT1: number | null;  // T+1 收益率%
  returnT5: number | null;  // T+5 收益率%
  backfilled: boolean;       // 是否已回填
}

function loadLedger(): SignalEntry[] {
  try { return JSON.parse(localStorage.getItem(LEDGER_KEY) || "[]"); }
  catch { return []; }
}

function saveLedger(entries: SignalEntry[]) {
  // 按日期倒序，保留最新500条
  entries.sort((a, b) => b.date.localeCompare(a.date));
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
  localStorage.setItem(LEDGER_KEY, JSON.stringify(entries));
}

/** 追加信号记录（同 id 不重复追加） */
export function appendSignal(entry: Omit<SignalEntry, "id" | "priceT1" | "priceT5" | "returnT1" | "returnT5" | "backfilled">) {
  const entries = loadLedger();
  const id = `${entry.date}_${entry.type}_${entry.code}`;
  if (entries.some(e => e.id === id)) return; // 已存在
  entries.push({
    ...entry, id,
    priceT1: null, priceT5: null, returnT1: null, returnT5: null, backfilled: false,
  });
  saveLedger(entries);
}

/** 获取待回填的记录（距今 >=1 且 <=10 个自然日，未回填的） */
export function getPendingBackfill(): SignalEntry[] {
  const entries = loadLedger();
  const now = Date.now();
  return entries.filter(e => {
    if (e.backfilled) return false;
    const daysSince = Math.floor((now - new Date(e.date).getTime()) / 86400000);
    return daysSince >= 1 && daysSince <= 10;
  });
}

/** 回填 T+1/T+5 价格和收益率 */
export function backfillEntry(id: string, priceT1: number | null, priceT5: number | null) {
  const entries = loadLedger();
  const entry = entries.find(e => e.id === id);
  if (!entry || entry.backfilled) return;
  entry.priceT1 = priceT1;
  entry.priceT5 = priceT5;
  if (priceT1 != null && entry.priceAtSignal > 0) {
    entry.returnT1 = Math.round((priceT1 / entry.priceAtSignal - 1) * 10000) / 100;
  }
  if (priceT5 != null && entry.priceAtSignal > 0) {
    entry.returnT5 = Math.round((priceT5 / entry.priceAtSignal - 1) * 10000) / 100;
  }
  entry.backfilled = true;
  saveLedger(entries);
}

/** 获取完整账本 */
export function getLedger(): SignalEntry[] { return loadLedger(); }

/** 按类型统计信号命中率 */
export interface SignalStats {
  typeLabel: string;
  count: number;
  avgReturnT5: number | null;
  winRateT5: number | null; // 胜率（T+5收益>0的比例）
}

export function getSignalStats(): SignalStats[] {
  const entries = loadLedger().filter(e => e.backfilled && e.returnT5 != null);
  const groups = new Map<string, SignalEntry[]>();
  for (const e of entries) {
    const arr = groups.get(e.typeLabel) ?? [];
    arr.push(e);
    groups.set(e.typeLabel, arr);
  }
  const stats: SignalStats[] = [];
  for (const [typeLabel, items] of groups) {
    const returns = items.map(e => e.returnT5!);
    const avg = returns.reduce((s, r) => s + r, 0) / returns.length;
    const wins = returns.filter(r => r > 0).length;
    stats.push({
      typeLabel,
      count: items.length,
      avgReturnT5: Math.round(avg * 100) / 100,
      winRateT5: Math.round(wins / items.length * 100),
    });
  }
  return stats;
}

// ============== 复盘日记 ==============
const DIARY_KEY = "review_diary";

export interface DiaryEntry {
  date: string;
  actions: string;        // 今日操作
  followedSignal: string; // 是否执行信号
  selfScore: number;      // 自评1-5分
}

export function saveDiary(entry: DiaryEntry) {
  const all = loadDiaries();
  const idx = all.findIndex(d => d.date === entry.date);
  if (idx >= 0) all[idx] = entry; else all.push(entry);
  all.sort((a, b) => b.date.localeCompare(a.date));
  if (all.length > 60) all.length = 60; // 保留约3个月
  localStorage.setItem(DIARY_KEY, JSON.stringify(all));
}

export function loadDiaries(): DiaryEntry[] {
  try { return JSON.parse(localStorage.getItem(DIARY_KEY) || "[]"); }
  catch { return []; }
}

// ============== 数据导出/导入 ==============
export function exportAllData(): string {
  const data: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key) data[key] = localStorage.getItem(key) || "";
  }
  return JSON.stringify(data, null, 2);
}

export function importAllData(json: string): boolean {
  try {
    const data = JSON.parse(json);
    if (typeof data !== "object") return false;
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === "string") localStorage.setItem(key, value);
    }
    return true;
  } catch { return false; }
}
