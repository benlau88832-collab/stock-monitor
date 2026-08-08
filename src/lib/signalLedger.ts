// 信号账本：记录系统触发的交易信号，并在之后回填 T+1/T+5 收益率
// 用于"信号→验证→复盘"闭环

import { fetchStockDailyCloses } from "./api";
import { localDateStrOffset } from "./format";

const LEDGER_KEY = "signal_ledger";
const MAX_ENTRIES = 500;

export interface SignalEntry {
  id: string;           // 唯一ID（日期+类型+代码）
  date: string;         // 触发日期 YYYY-MM-DD
  // P1-7：新增 ai_decision —— AI 决策拍板进入信号账本，纳入净值曲线统一核算
  type: "veto" | "quadrant" | "cycle" | "sentiment_cross" | "ai_decision";
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
    const daysSince = Math.floor((now - new Date(e.date + "T00:00:00+08:00").getTime()) / 86400000);
    return daysSince >= 1 && daysSince <= 10;
  });
}

// ============== 自动回填（T+1/T+5 真实日K收盘价） ==============
// P1 信号验证闭环核心：
// 旧版只有 backfillEntry(id, ...) 手动回填，且 App 只在 post phase 触发一次。
// 现在提供 runSignalBackfill() 批量自动回填，配合"首载+定时+手动按钮"三保险，
// 确保不开页面也不丢 T+1/T+5 数据。
const BACKFILL_DAY_KEY = "signal_backfill_day"; // 记录最近一次回填日期（防重复跑）

/** 批量回填所有到期信号的 T+1/T+5 收益率（幂等，返回回填条数） */
export async function runSignalBackfill(): Promise<number> {
  const pending = getPendingBackfill();
  const stockEntries = pending.filter(e => e.code !== "MARKET" && /^\d{6}$/.test(e.code));
  if (stockEntries.length === 0) return 0;

  // 按代码分组，一次日K覆盖多天信号
  const codes = [...new Set(stockEntries.map(e => e.code))].slice(0, 50);
  const closesByCode = new Map<string, Map<string, number>>();
  for (const code of codes) {
    try {
      const closes = await fetchStockDailyCloses(code, 40);
      if (closes.size > 0) closesByCode.set(code, closes);
    } catch { /* 单只失败跳过 */ }
  }

  const entries = loadLedger();
  let filled = 0;
  for (const e of entries) {
    if (e.backfilled || e.code === "MARKET") continue;
    const closes = closesByCode.get(e.code);
    if (!closes || closes.size === 0) continue;
    const dates = [...closes.keys()].sort();
    const idx = dates.indexOf(e.date);
    if (idx < 0) continue; // 非交易日或未收录
    const base = closes.get(dates[idx]);
    if (!base || base <= 0) continue;

    const priceT1 = idx + 1 < dates.length ? closes.get(dates[idx + 1]) : null;
    const priceT5 = idx + 5 < dates.length ? closes.get(dates[idx + 5]) : null;
    if (priceT1 != null) {
      e.priceT1 = priceT1;
      e.returnT1 = Math.round((priceT1 / base - 1) * 10000) / 100;
    }
    if (priceT5 != null) {
      e.priceT5 = priceT5;
      e.returnT5 = Math.round((priceT5 / base - 1) * 10000) / 100;
    }
    if (e.priceT1 != null && e.priceT5 != null) e.backfilled = true;
    filled++;
  }
  if (filled > 0) saveLedger(entries);
  return filled;
}

/** 是否今天已跑过自动回填（避免每次刷新都拉日K） */
export function isBackfilledToday(): boolean {
  try { return localStorage.getItem(BACKFILL_DAY_KEY) === localDateStrOffset(0); }
  catch { return false; }
}
export function markBackfilledToday(): void {
  try { localStorage.setItem(BACKFILL_DAY_KEY, localDateStrOffset(0)); } catch (e) { console.warn("[signalLedger] op failed", e); }
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

// ============== v9.44（④）：信号净值曲线 ==============
// 幻方"信号验证"的收益视图：把已回填的信号按 T+N 收益率做等权复利净值。
export interface EquityPoint {
  date: string;
  equity: number;  // 净值（从 100 起）
  ret: number;     // 该笔收益 %
  win: boolean;    // 收益 > 0
}

export interface EquityStats {
  count: number;          // 已回填信号数
  winRate: number;        // T+N 胜率 %
  totalReturn: number;    // 累计收益 %（净值-100）
  avgReturn: number;      // 平均单笔收益 %
  maxDrawdown: number;    // 最大回撤 %（正数）
}

/** 构建等权复利净值序列（按日期升序；默认 T1 收益，可选 T5） */
export function buildEquitySeries(entries: SignalEntry[], horizon: 1 | 5 = 1): EquityPoint[] {
  const filled = entries
    .filter(e => (horizon === 1 ? e.returnT1 != null : e.returnT5 != null))
    .map(e => ({ date: e.date, ret: horizon === 1 ? e.returnT1! : e.returnT5! }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const pts: EquityPoint[] = [];
  let eq = 100;
  for (const { date, ret } of filled) {
    eq = eq * (1 + ret / 100);
    pts.push({ date, equity: Math.round(eq * 100) / 100, ret, win: ret > 0 });
  }
  return pts;
}

/** 净值统计：胜率 / 累计收益 / 平均单笔 / 最大回撤 */
export function computeEquityStats(pts: EquityPoint[]): EquityStats {
  if (pts.length === 0) return { count: 0, winRate: 0, totalReturn: 0, avgReturn: 0, maxDrawdown: 0 };
  const wins = pts.filter(p => p.win).length;
  const totalReturn = pts[pts.length - 1].equity - 100;
  const avgReturn = pts.reduce((s, p) => s + p.ret, 0) / pts.length;
  // 最大回撤：遍历中 equity 峰值到当前点的最大跌幅
  let peak = pts[0].equity;
  let maxDD = 0;
  for (const p of pts) {
    if (p.equity > peak) peak = p.equity;
    const dd = (peak - p.equity) / peak * 100;
    if (dd > maxDD) maxDD = dd;
  }
  return {
    count: pts.length,
    winRate: Math.round(wins / pts.length * 100),
    totalReturn: Math.round(totalReturn * 100) / 100,
    avgReturn: Math.round(avgReturn * 100) / 100,
    maxDrawdown: Math.round(maxDD * 100) / 100,
  };
}

/** 按类型统计信号命中率 */
export interface SignalStats {
  typeLabel: string;
  count: number;
  avgReturnT5: number | null;
  winRateT5: number | null; // 胜率（T+5收益>0的比例）
  /** P1 新增：信号源健康度。胜率<45% 标记为 "存疑"，用于 UI 打角标 + 推荐降权 */
  health: "healthy" | "warning" | "suspect" | "insufficient";
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
    const winRate = Math.round(wins / items.length * 100);
    const health: SignalStats["health"] = items.length < 10
      ? "insufficient"
      : winRate >= 55 ? "healthy"
      : winRate >= 45 ? "warning"
      : "suspect";
    stats.push({
      typeLabel,
      count: items.length,
      avgReturnT5: Math.round(avg * 100) / 100,
      winRateT5: winRate,
      health,
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
