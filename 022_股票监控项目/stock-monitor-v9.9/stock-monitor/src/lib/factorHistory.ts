// ============================================================
// v9.42：因子健康度数据加载层
// - loadFactorRows:        读最近 N 交易日 kv（sentiment + market_daily）→ 因子日行序列
// - loadFactorIcHistory:   读历史 factor_ic:日期 快照（server cron 15:40 落库）
//                           → 每因子时间序列（"因子失效曲线"主数据源，PG 权威）
// 兼容：Dashboard v9.39 也曾落 {date, items:[{name,ic,samples,decayed}]}，
//       server v9.42 落 {date, window, items:[{id,name,ic,samples,decayed}]}，
//       面板按 name 聚合，两种格式都可读。
// ============================================================
import { kvGet } from "./cloudStore";
import type { FactorDayRow } from "./factorLib";

export interface IcHistoryPoint {
  date: string;
  ic: number;
  samples: number;
  decayed: boolean;
}

export interface FactorIcHistory {
  /** 因子 id → 按日期升序的点序列 */
  byFactor: Record<string, IcHistoryPoint[]>;
  /** 有快照的日期列表（升序） */
  dates: string[];
  /** 最近一天快照汇总 */
  latest: { date: string; decayed: number; total: number } | null;
}

/** 最近 N 个自然日（跳过周六日，保留节假日——无数据自然跳过） */
function recentDateKeys(days: number, offsetDays = 0): string[] {
  const out: string[] = [];
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  for (let i = days - 1; i >= 0; i--) {
    const t = new Date(d);
    t.setDate(t.getDate() - i);
    const dow = t.getDay();
    if (dow === 0 || dow === 6) continue;
    out.push(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`);
  }
  return out;
}

/** 读最近 N 个交易日的因子输入行（sentiment + market_daily，kv 逐日读 PG） */
export async function loadFactorRows(days = 30): Promise<FactorDayRow[]> {
  const out: FactorDayRow[] = [];
  for (const ds of recentDateKeys(days)) {
    const row: FactorDayRow = { date: ds, sentiment: null, blastedRate: null, ztCount: null, maxBoardHeight: null, premiumAvg: null, promotionRate: null, sealDecayCount: null, lhbBoostCount: null, fundInflowStreak: null, nuclearCount: null, nextMainlineWin: null };
    try {
      const sv = await kvGet(`sentiment:${ds}`);
      const num = Number(sv ?? NaN);
      if (Number.isFinite(num)) row.sentiment = num;
    } catch { /* 静默 */ }
    try {
      const md = (await kvGet(`market_daily:${ds}`)) as any;
      if (md) {
        row.ztCount = md.ztCount ?? null;
        row.blastedRate = md.blastedRate ?? null;
        row.maxBoardHeight = md.maxBoardHeight ?? null;
        row.sealDecayCount = md.sealDecayCount ?? null;
        row.lhbBoostCount = md.lhbBoostCount ?? null;
        row.fundInflowStreak = md.fundInflowStreak ?? null;
        row.nuclearCount = md.nuclearCount ?? null;
      }
    } catch { /* 静默 */ }
    out.push(row);
  }
  return out;
}

/** 读历史 factor_ic:日期 快照序列 → 按因子聚合（主数据源：server cron 自动落库） */
export async function loadFactorIcHistory(days = 30): Promise<FactorIcHistory> {
  const byFactor: Record<string, IcHistoryPoint[]> = {};
  const dates: string[] = [];
  let latest: FactorIcHistory["latest"] = null;

  for (const ds of recentDateKeys(days)) {
    let snap: any = null;
    try { snap = await kvGet(`factor_ic:${ds}`); } catch { continue; }
    if (!snap?.items || !Array.isArray(snap.items) || snap.items.length === 0) continue;
    dates.push(ds);
    let decayed = 0;
    for (const it of snap.items) {
      const name = String(it?.name ?? "");
      if (!name) continue;
      const pt: IcHistoryPoint = { date: ds, ic: Number(it?.ic ?? 0), samples: Number(it?.samples ?? 0), decayed: Boolean(it?.decayed) };
      if (it.decayed) decayed++;
      (byFactor[name] ??= []).push(pt);
    }
    latest = { date: ds, decayed, total: snap.items.length };
  }
  return { byFactor, dates, latest };
}
