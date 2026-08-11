// ============================================================
// v9.101.1（产品级升级第一批 T-D3）：事件研究纯函数（相似历史回测）
// 事件库 = {政策发布/外围异动/公告/制裁}，按"事件类型+方向"标签归档；
// 对每类事件算次日/3 日相关板块平均涨跌幅、胜率、样本数 →
// 输出"N 次同类事件后板块次日平均 X%（胜率 Y%）"（事件窗口简化版：
// 先做次日/3 日，不做完整 AR/CAR——升级报告明确）。
// 数据源对接：zt_snapshot(7日)/market_daily(已补跑)/PG 事件表（后续批次接入），
// 本文件为纯统计函数，事件/板块日数据由调用方提供。
// ============================================================

export interface EventRecord {
  /** 事件类型（政策/外围/公告/制裁…） */
  type: string;
  /** 方向：利好/利空 */
  direction: "利好" | "利空";
  /** 事件日期 YYYY-MM-DD */
  date: string;
}

export interface BoardDaily {
  /** 板块名 */
  board: string;
  /** 交易日 YYYY-MM-DD */
  date: string;
  /** 当日涨跌幅 % */
  pct: number;
}

export interface EventStudyResult {
  /** 聚合键 "type|direction" */
  key: string;
  type: string;
  direction: string;
  /** 样本数（事件数） */
  samples: number;
  /** 次日平均涨跌幅 % */
  nextDayAvg: number | null;
  /** 次日胜率 %（板块次日上涨比例） */
  nextDayWinRate: number | null;
  /** 3 日累计平均涨跌幅 % */
  day3Avg: number | null;
  /** 3 日胜率 %（3 日累计上涨比例） */
  day3WinRate: number | null;
  /** 人类可读："N 次同类事件后板块次日平均 X%（胜率 Y%）" */
  summary: string;
}

const fmt1 = (v: number | null) => (v == null ? "—" : v.toFixed(1) + "%");
const fmt0 = (v: number | null) => (v == null ? "—" : Math.round(v) + "%");

/**
 * 事件研究统计（纯函数）
 * @param events     事件记录（含类型/方向/日期）
 * @param boardDailies 目标板块日线（含涨跌幅，日期对齐事件次日/3 日）
 * @param targetBoard 目标板块名（boardDailies 中匹配）
 * @returns 按 (类型,方向) 聚合的统计结果
 */
export function runEventStudy(events: EventRecord[], boardDailies: BoardDaily[], targetBoard: string): EventStudyResult[] {
  // 板块日线索引：date → pct
  const byDate = new Map<string, number>();
  for (const d of boardDailies) {
    if (d.board !== targetBoard) continue;
    byDate.set(d.date, d.pct);
  }
  // 事件聚合：key = type|direction → 次日/3日收益样本
  const groups = new Map<string, { type: string; direction: string; next: number[]; day3: number[] }>();
  for (const ev of events) {
    const key = `${ev.type}|${ev.direction}`;
    let g = groups.get(key);
    if (!g) { g = { type: ev.type, direction: ev.direction, next: [], day3: [] }; groups.set(key, g); }
    const nextDate = shiftDate(ev.date, 1);
    const day3Date = shiftDate(ev.date, 3);
    const nextPct = byDate.get(nextDate);
    if (nextPct != null) g.next.push(nextPct);
    const day3Pct = byDate.get(day3Date);
    if (day3Pct != null) g.day3.push(day3Pct);
  }
  const out: EventStudyResult[] = [];
  for (const [key, g] of groups) {
    const avg = (arr: number[]) => (arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : null);
    const win = (arr: number[]) => (arr.length > 0 ? Math.round(arr.filter(v => v > 0).length / arr.length * 1000) / 10 : null);
    const nextDayAvg = avg(g.next);
    const nextDayWinRate = win(g.next);
    const day3Avg = avg(g.day3);
    const day3WinRate = win(g.day3);
    // v9.101.1：samples=0 的组过滤（无板块数据支撑的统计无意义，测试与设计对齐）
    if (g.next.length === 0) continue;
    const summary = `${g.next.length} 次同类事件后板块次日平均 ${fmt1(nextDayAvg)}（胜率 ${fmt0(nextDayWinRate)}）· 3日平均 ${fmt1(day3Avg)}`;
    out.push({ key, type: g.type, direction: g.direction, samples: g.next.length, nextDayAvg, nextDayWinRate, day3Avg, day3WinRate, summary });
  }
  return out.sort((a, b) => b.samples - a.samples);
}

/** 日期 +N 天（YYYY-MM-DD，简单日历日；交易日历由调用方保证数据对齐） */
function shiftDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}
