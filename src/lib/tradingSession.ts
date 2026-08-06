// 交易时段状态机
// 根据北京时间判断当前处于哪个时段，控制刷新频率和数据拉取策略
//
// 时段表（北京时间）：
// ┌───────────────┬──────────────────────────────────────┐
// │ 时段名称       │ 时间范围                              │
// ├───────────────┼──────────────────────────────────────┤
// │ 盘前静默       │ 00:00 - 09:14                        │
// │ 集合竞价       │ 09:15 - 09:29（拉一次快照）            │
// │ 盘中-上午      │ 09:30 - 11:30（实时类60s刷新）         │
// │ 午间休市       │ 11:31 - 12:59（停刷，展示上午最后数据）  │
// │ 盘中-下午      │ 13:00 - 15:00（实时类60s刷新）         │
// │ 盘后          │ 15:01 - 23:59（历史类拉一次，实时停刷）   │
// └───────────────┴──────────────────────────────────────┘
// 周末（周六日）：全天等同盘后，仅展示缓存+标注日期
// v9.54（V7-15）：法定节假日 → 全天等同"休市"（停刷 + UI 标"节假日休市"）
import { marketHolidayLabel } from "./tradeCalendar";
import { getBJDate } from "./format";

export type SessionPhase =
  | "pre"       // 盘前静默
  | "auction"   // 集合竞价
  | "trading"   // 盘中（上午+下午）
  | "lunch"     // 午间休市
  | "post";     // 盘后

export interface SessionInfo {
  phase: SessionPhase;
  label: string;
  shouldRefreshRealtime: boolean;  // 是否刷新实时类数据（概览/资金/明暗盘）
  refreshIntervalMs: number;       // 刷新间隔（0=不自动刷新）
  isWeekend: boolean;
}

function getBJTime(): { hour: number; minute: number; day: number } {
  // v9.60（V9-D3）：修复 v9.55 引入的时区 bug —— 原公式
  //   utcMs = now.getTime() + now.getTimezoneOffset() * 60000 在 CST 机器上
  //   （offset=-480）等于 now.getTime() - 8h，+8h 后 bjMs == now.getTime()，
  //   再读 getUTCHours() 得到的是 UTC 小时（如北京 22 点读到 14），时段判断全错。
  // 正确做法：getTime() 返回的本来就是 UTC epoch（与时区无关），北京 epoch = getTime() + 8h。
  // 复用 format.getBJDate()（构造出 getHours/getDay 即北京时间字段的 Date），保证全站一致。
  const bj = getBJDate();
  return { hour: bj.getHours(), minute: bj.getMinutes(), day: bj.getDay() };
}

export function getCurrentSession(): SessionInfo {
  const { hour, minute, day } = getBJTime();
  const isWeekend = day === 0 || day === 6;
  const hhmm = hour * 100 + minute; // 0930 = 9:30

  // v9.54（V7-15）：法定节假日 → 休市态（停刷，UI 标节假日名）
  const holidayLabel = marketHolidayLabel(new Date());
  if (holidayLabel) {
    return { phase: "post", label: holidayLabel, shouldRefreshRealtime: false, refreshIntervalMs: 0, isWeekend: false };
  }

  if (isWeekend) {
    return { phase: "post", label: "周末休市", shouldRefreshRealtime: false, refreshIntervalMs: 0, isWeekend: true };
  }

  if (hhmm < 915) {
    return { phase: "pre", label: "盘前静默", shouldRefreshRealtime: false, refreshIntervalMs: 0, isWeekend: false };
  }
  if (hhmm < 930) {
    return { phase: "auction", label: "集合竞价", shouldRefreshRealtime: true, refreshIntervalMs: 30000, isWeekend: false };
  }
  if (hhmm <= 1130) {
    return { phase: "trading", label: "盘中", shouldRefreshRealtime: true, refreshIntervalMs: 60000, isWeekend: false };
  }
  if (hhmm < 1300) {
    return { phase: "lunch", label: "午间休市", shouldRefreshRealtime: false, refreshIntervalMs: 0, isWeekend: false };
  }
  if (hhmm <= 1500) {
    return { phase: "trading", label: "盘中", shouldRefreshRealtime: true, refreshIntervalMs: 60000, isWeekend: false };
  }
  return { phase: "post", label: "盘后", shouldRefreshRealtime: false, refreshIntervalMs: 300000, isWeekend: false };
}
