// ============================================================
// v9.54（V7-15）：A股交易日历 —— 节假日休市判定
// 前端 tradingSession 与 server cron 共用：非交易日停刷/停抓，UI 标"节假日休市"
// 数据：内置 2026 年法定节假日休市区间（含周末调休；补班日 A 股仍开市但本表按"肯定休市"保守处理）
// 注：权威交易日历未来可接东财 push2his qt 字段动态刷新
// ============================================================
import { getBJDate, getBJDateStr } from "./format";

/** 2026 年 A 股休市区间（含区间两端；YY-MM-DD）—— 元旦/春节/清明/劳动/端午/中秋/国庆 */
export const HOLIDAY_RANGES_2026: Array<[string, string]> = [
  ["2026-01-01", "2026-01-02"], // 元旦
  ["2026-02-16", "2026-02-22"], // 春节（除夕 2/16 → 初六 2/22）
  ["2026-04-04", "2026-04-06"], // 清明
  ["2026-05-01", "2026-05-05"], // 劳动节
  ["2026-06-19", "2026-06-21"], // 端午
  ["2026-09-25", "2026-09-27"], // 中秋
  ["2026-10-01", "2026-10-07"], // 国庆
];

/** 全部休市日集合（YYYY-MM-DD） */
const HOLIDAY_SET: Set<string> = new Set();
for (const [a, b] of HOLIDAY_RANGES_2026) {
  const start = new Date(a + "T00:00:00+08:00");
  const end = new Date(b + "T00:00:00+08:00");
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    HOLIDAY_SET.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  }
}

/** 日期 → YYYY-MM-DD（按北京时间） */
export function bjDateStr(d: Date): string {
  // v9.60（V9-D3）：修复原公式 utcMs = d.getTime() + getTimezoneOffset()*60000 在 CST 机器
  // 上等于 d.getTime() - 8h，+8h 后 bjMs == d.getTime()，getUTC* 读到的是 UTC 日期
  // （北京凌晨 0-8 点会取到前一天）—— 统一走 format.getBJDateStr（getTime()+8h 正确基准）。
  return getBJDateStr(d);
}

/** 是否交易日（非周末 + 非节假日） */
export function isTradingDay(d: Date): boolean {
  // v9.60（V9-D3）：周末判定用北京时间（getBJDate），替代本机 getDay() 时区偏移
  const bj = getBJDate(d);
  const dow = bj.getDay();
  if (dow === 0 || dow === 6) return false;
  return !HOLIDAY_SET.has(bjDateStr(d));
}

/** 下一交易日（跳过周末/节假日） */
export function nextTradingDay(d: Date): Date {
  const t = new Date(d);
  t.setDate(t.getDate() + 1);
  while (!isTradingDay(t)) t.setDate(t.getDate() + 1);
  return t;
}

/** 上一交易日 */
export function prevTradingDay(d: Date): Date {
  const t = new Date(d);
  t.setDate(t.getDate() - 1);
  while (!isTradingDay(t)) t.setDate(t.getDate() - 1);
  return t;
}

/** 休市原因（非交易日时给出人类可读说明；交易日返回 null） */
export function marketHolidayLabel(d: Date): string | null {
  // v9.60（V9-D3）：周末判定用北京时间（getBJDate），替代本机 getDay() 时区偏移
  const bj = getBJDate(d);
  if (bj.getDay() === 0 || bj.getDay() === 6) return "周末休市";
  const ds = bjDateStr(d);
  if (!HOLIDAY_SET.has(ds)) return null;
  const names: Array<[string, string, string]> = [
    ["2026-01-01", "2026-01-02", "元旦"],
    ["2026-02-16", "2026-02-22", "春节"],
    ["2026-04-04", "2026-04-06", "清明节"],
    ["2026-05-01", "2026-05-05", "劳动节"],
    ["2026-06-19", "2026-06-21", "端午节"],
    ["2026-09-25", "2026-09-27", "中秋节"],
    ["2026-10-01", "2026-10-07", "国庆节"],
  ];
  for (const [a, b, name] of names) {
    if (ds >= a && ds <= b) return `${name}休市`;
  }
  return "节假日休市";
}
