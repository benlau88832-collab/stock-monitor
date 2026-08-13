// ============================================================
// v9.54（V7-15）：A股交易日历 —— 节假日休市判定
// 前端 tradingSession 与 server cron 共用：非交易日停刷/停抓，UI 标"节假日休市"
// v9.137.0（审查 P3-07）：休市区间单源化 —— 数据移到 src/shared/trade-holidays.js
//   （与 server cron.js isTradingDayCN 共用，消灭双源 2026 硬编码漂移；2027+ 只改 shared 一处）
// 注：权威交易日历未来可接东财 push2his qt 字段动态刷新
// ============================================================
import { getBJDate, getBJDateStr, getBJWeekday } from "./format";
import { buildHolidaySet, HOLIDAY_NAMES } from "../shared/trade-holidays";

/** 全部休市日集合（YYYY-MM-DD）—— 由 shared 表构建 */
const HOLIDAY_SET: Set<string> = buildHolidaySet();

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
  // v9.63-fix（补丁）：显式 getBJWeekday
  const bj = getBJDate(d);
  const dow = getBJWeekday(bj);
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
  // v9.63-fix（补丁）：显式 getBJWeekday
  const bj = getBJDate(d);
  if (getBJWeekday(bj) === 0 || getBJWeekday(bj) === 6) return "周末休市";
  const ds = bjDateStr(d);
  if (!HOLIDAY_SET.has(ds)) return null;
  for (const { start, end, name } of HOLIDAY_NAMES) {
    if (ds >= start && ds <= end) return `${name}休市`;
  }
  return "节假日休市";
}
