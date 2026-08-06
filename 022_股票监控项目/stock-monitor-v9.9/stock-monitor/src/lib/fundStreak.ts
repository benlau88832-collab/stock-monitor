// ============================================================
// v9.33（缺口6）：资金连续性 + 切换信号引擎
// 数据源：server cron 每日落库 kv_store:fund_streak:YYYY-MM-DD（行业全量双请求）
// 输出：每行业连续流入/流出天数、今日主力净额、昨日流入今日流出切换标记
// ============================================================
import { isLocalServer } from "./cloudStore";
import { getBJDate } from "./format";

export interface FundStreak {
  board: string;              // 行业名
  code: string;               // BK code
  consecutiveInflowDays: number; // 正=连续流入天数，负=连续流出天数
  todayMainNet: number;       // 今日主力净额（元）
  switchedFromHere: boolean;  // 昨日流入 → 今日流出（切换信号）
  switchedToHere: boolean;    // 昨日流出 → 今日流入（资金进场信号）
  last5d: number[];           // 近5日主力净额序列（元）
}

const DAY_KEYS = 7;

/** 本地/线上判断：kv 接口仅本地服务端有 */
function kvUrl(key: string): string | null {
  if (!isLocalServer()) return null;
  return `/api/db/kv?key=${encodeURIComponent(key)}`;
}

/** 读取指定日期的 fund_streak 快照（本地服务端） */
async function loadDayFund(dateStr: string): Promise<Array<{ code: string; name: string; mainNet: number }> | null> {
  try {
    const url = kvUrl(`fund_streak:${dateStr}`);
    if (!url) return null;
    const r = await fetch(url);
    if (!r.ok) return null;
    const v = await r.json();
    const items = v?.value?.items;
    if (!Array.isArray(items)) return null;
    return items;
  } catch { return null; }
}

/** 最近 N 个交易日字符串（跳过周末；缺数据日自动容忍） */
function recentTradeDates(n: number): string[] {
  const out: string[] = [];
  // v9.60（V9-D3）：基于北京时间（getBJDate），替代本机 new Date() 时区偏移
  const d = getBJDate();
  d.setDate(d.getDate() - 1); // 从昨日开始（当日数据可能未落库）
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

/**
 * 聚合资金连续性：逐行业统计连续流入/流出天数 + 切换信号
 * 返回 null = 数据不足（非本地部署 或 快照缺失）
 */
export async function buildFundStreaks(): Promise<FundStreak[] | null> {
  const dates = recentTradeDates(DAY_KEYS);
  const days: Array<Array<{ code: string; name: string; mainNet: number }>> = [];
  for (const dt of dates) {
    const items = await loadDayFund(dt);
    if (!items) return null; // 任一关键日缺失 → 数据链不完整，宁可不出结果
    days.push(items);
  }
  // 以最近一日为基准，取出现在榜单中的行业
  const latest = days[days.length - 1];
  const byCode = new Map<string, { name: string; seq: number[] }>();
  for (const it of latest) {
    if (it.code && it.code.startsWith("BK")) byCode.set(it.code, { name: it.name, seq: [] });
  }
  for (const day of days) {
    const m = new Map(day.map(i => [i.code, i.mainNet]));
    for (const [code, rec] of byCode) {
      rec.seq.push(m.get(code) ?? 0);
    }
  }
  const result: FundStreak[] = [];
  for (const [code, rec] of byCode) {
    const seq = rec.seq;
    const today = seq[seq.length - 1];
    // 连续天数：从末端往回数同号
    let streak = 0;
    for (let i = seq.length - 1; i >= 0; i--) {
      if (seq[i] > 0 && today > 0) streak++;
      else if (seq[i] < 0 && today < 0) streak--;
      else if (seq[i] === 0 && today === 0) streak = streak; // 0 不打断（容忍停牌/无数据）
      else break;
    }
    const prev = seq[seq.length - 2];
    result.push({
      board: rec.name,
      code,
      consecutiveInflowDays: streak,
      todayMainNet: today,
      switchedFromHere: prev != null && prev > 0 && today < 0,
      switchedToHere: prev != null && prev < 0 && today > 0,
      last5d: seq.slice(-5),
    });
  }
  return result.sort((a, b) => b.todayMainNet - a.todayMainNet);
}
