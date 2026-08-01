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
// 节假日：暂不处理（注释注明局限），视为普通工作日

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
  const now = new Date();
  // 北京时间 = UTC+8
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const bjMs = utcMs + 8 * 3600000;
  const bj = new Date(bjMs);
  return { hour: bj.getHours(), minute: bj.getMinutes(), day: bj.getDay() };
}

export function getCurrentSession(): SessionInfo {
  const { hour, minute, day } = getBJTime();
  const isWeekend = day === 0 || day === 6;
  const hhmm = hour * 100 + minute; // 0930 = 9:30

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
