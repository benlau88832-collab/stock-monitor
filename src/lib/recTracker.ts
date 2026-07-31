// 推荐归因闭环：落盘 → T+1/T+3 回填 → 命中率统计
// 每日首次推荐落盘，盘后幂等回填，滚动胜率注入复盘

import { fetchStockBriefBatch } from "./api";

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

  // 找需要回填的代码（距推荐日≥2天的）
  const now = Date.now();
  const codesToFetch = new Set<string>();
  for (const r of pending) {
    const daysSince = Math.floor((now - new Date(r.date + "T00:00:00+08:00").getTime()) / 86400000);
    if (daysSince >= 2 && r.type === "stock") {
      codesToFetch.add(r.code);
    }
  }

  if (codesToFetch.size > 0) {
    try {
      const briefs = await fetchStockBriefBatch([...codesToFetch].slice(0, 100));
      for (const r of pending) {
        if (r.type !== "stock") continue;
        const daysSince = Math.floor((now - new Date(r.date + "T00:00:00+08:00").getTime()) / 86400000);
        const brief = briefs.get(r.code);
        if (!brief) continue;

        // 简化：用当前价 vs 推荐价计算涨跌幅作为近似回填
        // 真实场景应按日期取历史收盘价，这里用当前价作近似值
        if (r.priceAtRec > 0) {
          const currentPct = Math.round((brief.price / r.priceAtRec - 1) * 10000) / 100;
          if (daysSince >= 2 && r.pctT1 == null) r.pctT1 = currentPct;
          if (daysSince >= 4 && r.pctT3 == null) r.pctT3 = currentPct;
          if (daysSince >= 4) r.backfilled = true;
          else if (daysSince >= 2) r.backfilled = false; // 只填了T+1还没T+3
        }
      }
    } catch { /* 回填失败不阻塞 */ }
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
  total: number;          // 总推荐数
  directionHitRate: number | null;  // 方向命中率(板块涨>0占比)
  alphaWinRate: number | null;      // 个股超额胜率(个股涨幅-板块涨幅>0占比)
  sampleSufficient: boolean;        // 样本≥20
}

/** 计算近N次推荐的命中率 */
export function computeHitRates(maxSamples = 20): HitRateStats {
  const all = loadRecords();
  // 只统计有回填数据的个股推荐
  const backfilled = all.filter(r => r.backfilled && r.type === "stock" && r.pctT1 != null);

  const total = backfilled.length;
  if (total === 0) {
    return { total: 0, directionHitRate: null, alphaWinRate: null, sampleSufficient: false };
  }

  const recent = backfilled.slice(0, maxSamples);
  const n = recent.length;

  // 方向命中率：推荐个股涨幅>0 的占比（简化：用个股自身方向代替板块方向）
  const dirHits = recent.filter(r => (r.pctT1 ?? 0) > 0).length;
  const directionHitRate = Math.round(dirHits / n * 100);

  // 个股超额胜率：个股涨幅 > 0 的占比（简化口径，后续接入板块涨幅后可做差值）
  // 由于板块 T+1 涨幅暂无精确回填，这里用"个股涨幅 > 平均涨幅"作近似超额
  const avgPct = recent.reduce((s, r) => s + (r.pctT1 ?? 0), 0) / n;
  const alphaHits = recent.filter(r => (r.pctT1 ?? 0) > avgPct).length;
  const alphaWinRate = Math.round(alphaHits / n * 100);

  return {
    total,
    directionHitRate,
    alphaWinRate,
    sampleSufficient: total >= maxSamples,
  };
}

/** 获取命中率文案（供作战卡底部显示） */
export function getHitRateText(): string {
  const stats = computeHitRates(20);
  if (stats.total === 0) return "样本积累中 0/20";
  if (!stats.sampleSufficient) return `样本积累中 ${stats.total}/20`;
  return `近20次推荐 · 方向命中 ${stats.directionHitRate}% · 个股超额 ${stats.alphaWinRate}%`;
}

/** 获取命中率数据（供 WeeklyCoach prompt 注入） */
export function getHitRateForPrompt(): string {
  const stats = computeHitRates(20);
  if (stats.total < 5) return "推荐样本不足，暂无统计";
  return `近${Math.min(stats.total, 20)}次推荐统计：方向命中率${stats.directionHitRate}%，个股超额胜率${stats.alphaWinRate}%（样本${stats.total}条）`;
}
