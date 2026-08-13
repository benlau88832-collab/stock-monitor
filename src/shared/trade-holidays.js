// ============================================================
// A股法定节假日休市区间 —— 全栈单一数据源（v9.137.0 审查 P3-07 修复）
// 前端 src/lib/tradeCalendar.ts 与 服务端 server/cron.js（isTradingDayCN）共用此表，
// 消灭双源漂移（原前端 tradeCalendar.ts 与 cron.js 各维护一份 2026 硬编码表）。
// 改休市安排只改这里；前端 import、服务端 require（ESM 互操作，同 concept-groups.js）。
// 维护说明：每年国务院办公厅发布次年放假安排后追加一个年份区间表；
//   未发布的未来年份不在表内 → 按"工作日即交易日"处理（保守不误杀）。
// ============================================================
export const TRADE_HOLIDAY_RANGES = {
  "2026": [
    ["2026-01-01", "2026-01-02"], // 元旦
    ["2026-02-16", "2026-02-22"], // 春节（除夕 2/16 → 初六 2/22）
    ["2026-04-04", "2026-04-06"], // 清明
    ["2026-05-01", "2026-05-05"], // 劳动节
    ["2026-06-19", "2026-06-21"], // 端午
    ["2026-09-25", "2026-09-27"], // 中秋
    ["2026-10-01", "2026-10-07"], // 国庆
  ],
  // 2027 年放假安排以国务院办公厅发布为准（发布后在此追加）
};

/** 全部休市日集合（YYYY-MM-DD，按年展开） */
export function buildHolidaySet(ranges = TRADE_HOLIDAY_RANGES) {
  const set = new Set();
  for (const yearRanges of Object.values(ranges)) {
    for (const [a, b] of yearRanges) {
      const start = new Date(a + "T00:00:00+08:00");
      const end = new Date(b + "T00:00:00+08:00");
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        set.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
      }
    }
  }
  return set;
}

/** 休市区间 → 节日名映射（marketHolidayLabel 用） */
export const HOLIDAY_NAMES = [
  { start: "2026-01-01", end: "2026-01-02", name: "元旦" },
  { start: "2026-02-16", end: "2026-02-22", name: "春节" },
  { start: "2026-04-04", end: "2026-04-06", name: "清明节" },
  { start: "2026-05-01", end: "2026-05-05", name: "劳动节" },
  { start: "2026-06-19", end: "2026-06-21", name: "端午节" },
  { start: "2026-09-25", end: "2026-09-27", name: "中秋节" },
  { start: "2026-10-01", end: "2026-10-07", name: "国庆节" },
];
