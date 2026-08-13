// ============================================================
// server/lib/proactiveSession.js —— 交易时段引擎（v9.117.0，S3-1）
// 主动智能的"时钟"：替代各模块散乱 setInterval，统一按时段决定 AI 该做什么。
// 8 阶段 + 2 决策窗口（9:25 集合竞价 / 13:00 午后开盘）—— 决策窗口必推 P0。
// 纯函数：按 (时,分) 解析，便于回测与 vitest。强制东八区解释防时区漂移。
// v9.128.0（一致性审查 P1-9）：原"前端等价 src/lib/proactive/session.ts"指向不存在文件——
//   前端无同构副本（ProactiveFeed 消费服务端 session；刷新频率状态机为 tradingSession.ts，语义不同）。
// ============================================================

/** 按 (时,分) 解析交易时段 —— 纯函数 */
function resolveSession(h, m, isTradingDay = true) {
  const t = h * 60 + m;
  if (!isTradingDay) return { phase: "非交易日", window: "休市", decisionWindow: false, note: "非交易日，仅复盘/剧本" };
  if (t < 9 * 60) return { phase: "盘前", window: "08:30-09:15 盘前准备", decisionWindow: false, note: "隔夜映射+政策简报+自选预热" };
  if (t < 9 * 60 + 15) return { phase: "盘前", window: "09:00-09:15", decisionWindow: false, note: "外围收盘定调" };
  if (t < 9 * 60 + 20) return { phase: "竞价", window: "09:15-09:20 集合竞价", decisionWindow: false, note: "撤单窗口，观察量价" };
  if (t < 9 * 60 + 25) return { phase: "竞价", window: "09:20-09:25 不可撤单", decisionWindow: true, note: "竞价决策窗口：锁定候选" };
  if (t < 9 * 60 + 30) return { phase: "竞价", window: "09:25-09:30 开盘前", decisionWindow: true, note: "★9:25决策窗口：一键裁决入场" };
  if (t < 10 * 60 + 30) return { phase: "早盘", window: "09:30-10:30", decisionWindow: false, note: "情绪定调，追高谨慎" };
  if (t < 11 * 60 + 30) return { phase: "盘中", window: "10:30-11:30", decisionWindow: false, note: "主线确认，异动解读" };
  if (t < 13 * 60) return { phase: "午休", window: "11:30-13:00", decisionWindow: false, note: "午后预案准备" };
  if (t < 13 * 60 + 5) return { phase: "午后", window: "13:00-13:05", decisionWindow: true, note: "★13:00决策窗口：午后加仓/换股" };
  if (t < 14 * 60 + 30) return { phase: "午后", window: "13:05-14:30", decisionWindow: false, note: "趋势延续或回落" };
  if (t < 14 * 60 + 57) return { phase: "尾盘", window: "14:30-14:57", decisionWindow: false, note: "尾盘纪律：减仓/锁定/抢筹" };
  if (t < 15 * 60) return { phase: "尾盘", window: "14:57-15:00 收盘竞价", decisionWindow: false, note: "收盘定价" };
  return { phase: "盘后", window: "15:00+ 盘后", decisionWindow: false, note: "复盘+明日剧本+持仓体检" };
}

/** 当前真实时段（强制东八区解释，避免部署时区漂移） */
function currentSession(date = new Date()) {
  const bj = new Date(date.getTime() + (date.getTimezoneOffset() + 8 * 60) * 60000);
  const dow = bj.getDay();
  const isTradingDay = dow >= 1 && dow <= 5;
  return resolveSession(bj.getHours(), bj.getMinutes(), isTradingDay);
}

/** 阶段名 → 代表性时刻（/api/proactive?phaseName= 用） */
const PHASE_TIME = { 盘前: "08:45", 竞价: "09:25", 早盘: "10:00", 盘中: "10:45", 午休: "12:00", 午后: "13:02", 尾盘: "14:40", 盘后: "15:30", 非交易日: "10:00" };

module.exports = { resolveSession, currentSession, PHASE_TIME };
