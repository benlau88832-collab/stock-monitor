// ============================================================
// v9.33（缺口5）：题材生命周期日历
// 数据源：server zt_snapshot 历史快照（/api/db/zt?date=YYYY-MM-DD）
// 输出：每题材首现日 / 连续运行天数 / 历史最高连板 / 阶段判定
// ============================================================
import { isLocalServer } from "./cloudStore";

export interface ThemeLifecycle {
  theme: string;
  firstSeenDate: string;       // YYYY-MM-DD 首现
  daysActive: number;          // 已运行天数（首现日到今天）
  consecutiveZtDays: number;   // 连续涨停天数（最近连续出现）
  maxHeight: number;           // 历史最高连板
  currentStage: string;        // 启动期/发酵期/高潮期/分歧期/退潮期/观察中
  todayCount: number;          // 今日涨停数
}

/** 快照的 pool 字段 → 直接取行业字段（hybk），无需完整跑主线引擎（轻量且稳定） */
interface ZTSnapshotPoolItem { c?: string; n?: string; hybk?: string; lbc?: number; }

function ztUrl(date: string): string | null {
  if (!isLocalServer()) return null;
  return `/api/db/zt?date=${date}`;
}

async function loadDaySnapshot(date: string): Promise<ZTSnapshotPoolItem[]> {
  try {
    const url = ztUrl(date);
    if (!url) return [];
    const r = await fetch(url);
    if (!r.ok) return [];
    const v = await r.json();
    const pool = v?.data?.pool ?? v?.pool;
    return Array.isArray(pool) ? pool : [];
  } catch { return []; }
}

function recentTradeDates(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  while (out.length < n) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      out.push(`${y}-${m}-${dd}`);
    }
    d.setDate(d.getDate() - 1);
  }
  return out.reverse();
}

/** 按题材名聚合一日的涨停池（直接取 hybk 行业字段，无需 LLM/概念归属） */
function groupByTheme(pool: ZTSnapshotPoolItem[]): Map<string, { count: number; maxHeight: number }> {
  const m = new Map<string, { count: number; maxHeight: number }>();
  for (const p of pool) {
    const t = String(p.hybk || "未分类");
    const rec = m.get(t) ?? { count: 0, maxHeight: 0 };
    rec.count++;
    rec.maxHeight = Math.max(rec.maxHeight, Number(p.lbc ?? 1));
    m.set(t, rec);
  }
  return m;
}

/** 阶段判定：第1天→启动；2-3天高度升→发酵；4天+→分歧；5天+→退潮边缘 */
function stageOfLifecycle(l: { daysActive: number; consecutiveZtDays: number; maxHeight: number }): string {
  if (l.daysActive >= 5) return "退潮期";
  if (l.daysActive >= 4) return "分歧期";
  if (l.daysActive >= 2) return "发酵期";
  return "启动期";
}

/**
 * 构建题材生命周期日历（读最近 N 日涨停快照）
 * 返回 null = 非本地部署或数据不足
 */
export async function buildThemeCalendar(days = 7): Promise<ThemeLifecycle[] | null> {
  const dates = recentTradeDates(days);
  const perDay: Map<string, Map<string, { count: number; maxHeight: number }>> = new Map();
  for (const dt of dates) {
    const pool = await loadDaySnapshot(dt);
    if (pool.length === 0) {
      // 最近一日为空视为数据不足；历史某日为空则跳过该日（允许缺日）
      if (dt === dates[dates.length - 1]) return null;
      continue;
    }
    perDay.set(dt, groupByTheme(pool));
  }
  if (perDay.size === 0) return null;

  const today = dates[dates.length - 1];
  const todayGroups = perDay.get(today) ?? new Map();
  const result: ThemeLifecycle[] = [];

  for (const [theme, tg] of todayGroups) {
    // 找首现日：从最早一天往前扫，第一个出现该题材的日期
    let firstSeen = today;
    for (const dt of dates) {
      if (perDay.get(dt)?.has(theme)) { firstSeen = dt; break; }
    }
    // 连续出现天数：从今天往前数连续出现
    let consecutive = 0;
    for (let i = dates.length - 1; i >= 0; i--) {
      if (perDay.get(dates[i])?.has(theme)) consecutive++;
      else break;
    }
    // 历史最高高度
    let maxHeight = tg.maxHeight;
    for (const g of perDay.values()) {
      const rec = g.get(theme);
      if (rec) maxHeight = Math.max(maxHeight, rec.maxHeight);
    }
    const daysActive = Math.max(1, dates.indexOf(firstSeen) >= 0 ? dates.length - dates.indexOf(firstSeen) : 1);
    result.push({
      theme,
      firstSeenDate: firstSeen,
      daysActive,
      consecutiveZtDays: consecutive,
      maxHeight,
      currentStage: stageOfLifecycle({ daysActive, consecutiveZtDays: consecutive, maxHeight }),
      todayCount: tg.count,
    });
  }
  return result.sort((a, b) => b.todayCount - a.todayCount);
}
