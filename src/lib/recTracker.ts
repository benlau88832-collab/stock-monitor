// 推荐归因闭环：落盘 → T+1/T+3 回填 → 命中率统计
// 每日首次推荐落盘，盘后幂等回填，滚动胜率注入复盘

import { fetchStockDailyCloses } from "./api";

const REC_KEY = "rec_tracker";
const ATTR_KEY_PREFIX = "rec_attr:"; // rec_attr:YYYY-MM-DD = 当日已归因标记
const MAX_RECORDS = 200;

// ============== 数据结构 ==============
export interface RecRecord {
  date: string;         // 推荐日期 YYYY-MM-DD
  type: "theme" | "stock" | "etf";
  code: string;         // 个股代码 / ETF代码 / 板块名
  board: string;        // 关联板块
  priceAtRec: number;   // 推荐时价格
  totalScore: number;   // 综合分
  gateFactor: number;   // 闸门系数
  // T+1/T+3 回填
  pctT1: number | null;       // 个股 T+1 涨跌幅
  pctT3: number | null;       // 个股 T+3 涨跌幅
  boardPctT1: number | null;  // 板块 T+1 涨跌幅(用于超额计算)
  boardPctT3: number | null;
  backfilled: boolean;
}

// ============== 读写 ==============
function loadRecords(): RecRecord[] {
  try { return JSON.parse(localStorage.getItem(REC_KEY) || "[]"); }
  catch { return []; }
}

function saveRecords(recs: RecRecord[]): void {
  recs.sort((a, b) => b.date.localeCompare(a.date));
  if (recs.length > MAX_RECORDS) recs.length = MAX_RECORDS;
  try { localStorage.setItem(REC_KEY, JSON.stringify(recs)); } catch {}
}

// ============== 落盘（每日首次） ==============
/** 记录推荐（同日同code不重复） */
export function recordRecommendation(rec: Omit<RecRecord, "pctT1" | "pctT3" | "boardPctT1" | "boardPctT3" | "backfilled">): void {
  const all = loadRecords();
  const id = `${rec.date}:${rec.type}:${rec.code}`;
  if (all.some(r => `${r.date}:${r.type}:${r.code}` === id)) return;
  all.push({
    ...rec,
    pctT1: null, pctT3: null, boardPctT1: null, boardPctT3: null,
    backfilled: false,
  });
  saveRecords(all);
}

// ============== 盘后归因回填（幂等） ==============
/** 当日是否已归因 */
function isAttributedToday(today: string): boolean {
  try { return localStorage.getItem(ATTR_KEY_PREFIX + today) === "1"; }
  catch { return false; }
}

function markAttributedToday(today: string): void {
  try {
    localStorage.setItem(ATTR_KEY_PREFIX + today, "1");
    // 清理30天前的标记
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(ATTR_KEY_PREFIX) && k < ATTR_KEY_PREFIX + today.slice(0, 8)) {
        localStorage.removeItem(k);
      }
    }
  } catch {}
}

/** 盘后归因：对到期的 T+1/T+3 历史推荐批量取现价 */
export async function runAttribution(today: string): Promise<void> {
  if (isAttributedToday(today)) return; // 幂等

  const all = loadRecords();
  const pending = all.filter(r => !r.backfilled);
  if (pending.length === 0) { markAttributedToday(today); return; }

  // 用真实日K收盘价回填 T+1/T+3（替代旧的"当前价近似"）
  const now = Date.now();
  const codesToFetch = new Set<string>();
  for (const r of pending) {
    if (r.type !== "stock") continue;
    const daysSince = Math.floor((now - new Date(r.date + "T00:00:00+08:00").getTime()) / 86400000);
    if (daysSince >= 2 && (!r.backfilled || r.pctT3 == null)) codesToFetch.add(r.code);
  }
  for (const code of [...codesToFetch].slice(0, 50)) {
    const closes = await fetchStockDailyCloses(code, 40);
    const dates = [...closes.keys()].sort();
    for (const r of pending) {
      if (r.code !== code || r.type !== "stock") continue;
      const idx = dates.indexOf(r.date);
      if (idx < 0) continue;
      const base = closes.get(dates[idx]);
      if (base && base > 0) {
        if (r.pctT1 == null && dates[idx + 1]) r.pctT1 = Math.round((closes.get(dates[idx + 1])! / base - 1) * 10000) / 100;
        if (r.pctT3 == null && dates[idx + 3]) r.pctT3 = Math.round((closes.get(dates[idx + 3])! / base - 1) * 10000) / 100;
      }
      if (r.pctT1 != null && r.pctT3 != null) r.backfilled = true;
    }
  }

  // 板块类推荐标记为已回填（无法精确回填板块涨幅）
  for (const r of pending) {
    if (r.type === "theme") {
      const daysSince = Math.floor((now - new Date(r.date + "T00:00:00+08:00").getTime()) / 86400000);
      if (daysSince >= 4) r.backfilled = true;
    }
  }

  saveRecords(all);
  markAttributedToday(today);
}

// ============== 命中率统计 ==============
export interface HitRateStats {
  total: number;
  directionHitRate: number | null; // T+1收盘上涨的占比
  avgT1: number | null;            // 平均T+1收益%
  sampleSufficient: boolean;
}

export function computeHitRates(maxSamples = 20): HitRateStats {
  const all = loadRecords();
  const backfilled = all.filter(r => r.backfilled && r.type === "stock" && r.pctT1 != null);
  const total = backfilled.length;
  if (total === 0) return { total: 0, directionHitRate: null, avgT1: null, sampleSufficient: false };
  const recent = backfilled.slice(0, maxSamples);
  const n = recent.length;
  const dirHits = recent.filter(r => (r.pctT1 ?? 0) > 0).length;
  const directionHitRate = Math.round(dirHits / n * 100);
  const avgT1 = Math.round(recent.reduce((s, r) => s + (r.pctT1 ?? 0), 0) / n * 100) / 100;
  return { total, directionHitRate, avgT1, sampleSufficient: total >= maxSamples };
}

/** 获取命中率文案（供作战卡底部显示） */
export function getHitRateText(): string {
  const stats = computeHitRates(20);
  if (stats.total === 0) return "样本积累中 0/20";
  if (!stats.sampleSufficient) return `样本积累中 ${stats.total}/20`;
  const avg = stats.avgT1 ?? 0;
  return `近20次推荐 · T+1上涨率${stats.directionHitRate}% · 平均T+1${avg >= 0 ? "+" : ""}${avg}%`;
}

/** 获取命中率数据（供 WeeklyCoach prompt 注入） */
export function getHitRateForPrompt(): string {
  const stats = computeHitRates(20);
  if (stats.total < 5) return "推荐样本不足，暂无统计";
  const avg = stats.avgT1 ?? 0;
  return `近${Math.min(stats.total, 20)}次推荐统计：T+1上涨率${stats.directionHitRate}%，平均T+1收益${avg}%（样本${stats.total}条）`;
}

// ============== P1：推荐卡命中率徽标（按板块/个股维度） ==============
// 给"今日推荐"标注该标的的历史表现——让用户知道这个信号以前准不准。
// 维度说明：theme 用板块名匹配（板块推荐历史上被推过的命中率），
//           stock 用个股代码匹配。样本<3 视为无历史（不显示徽标）。

export interface RecHitBadge {
  label: string;
  hitRate: number | null; // null = 样本不足
  color: "good" | "mid" | "bad" | "none";
}

/** 查询某板块历史推荐命中率（近30天，最多取20条样本） */
export function getBoardHitBadge(board: string): RecHitBadge {
  const all = loadRecords();
  const rows = all
    .filter(r => r.type === "theme" && r.board === board && r.pctT1 != null)
    .slice(0, 20);
  if (rows.length < 3) return { label: `${board}`, hitRate: null, color: "none" };
  const hits = rows.filter(r => (r.pctT1 ?? 0) > 0).length;
  const rate = Math.round(hits / rows.length * 100);
  return {
    label: `历史${rows.length}推${hits}中`,
    hitRate: rate,
    color: rate >= 60 ? "good" : rate >= 40 ? "mid" : "bad",
  };
}

/** 查询某个股历史推荐命中率（近30天） */
export function getStockHitBadge(code: string): RecHitBadge {
  const all = loadRecords();
  const rows = all
    .filter(r => r.type === "stock" && r.code === code && r.pctT1 != null)
    .slice(0, 20);
  if (rows.length < 3) return { label: code, hitRate: null, color: "none" };
  const hits = rows.filter(r => (r.pctT1 ?? 0) > 0).length;
  const rate = Math.round(hits / rows.length * 100);
  return {
    label: `历史${rows.length}推${hits}中`,
    hitRate: rate,
    color: rate >= 60 ? "good" : rate >= 40 ? "mid" : "bad",
  };
}
