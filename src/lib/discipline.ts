// 仓位与交易纪律（v9.19-F6）
// 数据层：用户手动录入 总资金/持仓/单票上限/止损偏好
// 纯函数计算纪律指标（单票超限/总仓位超限/连续亏损冷静期）
// 存储：localStorage（v9.20 云端持久化时迁移）

import { localDateStr } from "./format";

// ============== 数据结构 ==============
export interface PositionRecord {
  code: string;
  name: string;
  /** 持仓成本（用于止损参考） */
  cost: number;
  /** 当前价（自动更新或手动） */
  price: number;
  /** 市值（当前价 × 股数） */
  value: number;
  /** 盈亏 %（相对成本） */
  pnlPct: number | null;
}

export interface DisciplineSettings {
  /** 总资金（元） */
  totalCapital: number;
  /** 单票仓位上限（百分比 0-100，默认 30） */
  maxSinglePct: number;
  /** 总仓位上限（百分比 0-100，默认 80） */
  maxTotalPct: number;
  /** 当日新开仓上限（默认 3） */
  maxNewPositionsPerDay: number;
  /** 连续亏损冷静期阈值（默认 3 次） */
  cooldownLossStreak: number;
}

export interface DisciplineState {
  positions: PositionRecord[];
  settings: DisciplineSettings;
  /** 今日已开仓次数 */
  todayNewPositions: number;
  /** 连续亏损次数（来自复盘日志，若接入） */
  lossStreak: number;
  /** 最近交易记录（日期 → 盈亏%） */
  recentPnl: Array<{ date: string; pnlPct: number; code: string }>;
}

// ============== localStorage 读写 ==============
const DISC_KEY = "discipline_state_v1";

const DEFAULT_SETTINGS: DisciplineSettings = {
  totalCapital: 100000,
  maxSinglePct: 30,
  maxTotalPct: 80,
  maxNewPositionsPerDay: 3,
  cooldownLossStreak: 3,
};

export function loadDisciplineState(): DisciplineState {
  try {
    const raw = localStorage.getItem(DISC_KEY);
    if (!raw) return { positions: [], settings: DEFAULT_SETTINGS, todayNewPositions: 0, lossStreak: 0, recentPnl: [] };
    const parsed = JSON.parse(raw);
    return {
      positions: parsed.positions ?? [],
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
      todayNewPositions: parsed.todayNewPositions ?? 0,
      lossStreak: parsed.lossStreak ?? 0,
      recentPnl: parsed.recentPnl ?? [],
    };
  } catch {
    return { positions: [], settings: DEFAULT_SETTINGS, todayNewPositions: 0, lossStreak: 0, recentPnl: [] };
  }
}

export function saveDisciplineState(state: DisciplineState): void {
  try { localStorage.setItem(DISC_KEY, JSON.stringify(state)); } catch { /* 满 → 静默 */ }
}

// ============== 纪律计算（纯函数） ==============

export interface DisciplineViolation {
  level: "warn" | "critical";
  text: string;
}

/** 计算全部纪律违规项 */
export function computeDisciplineViolations(state: DisciplineState): DisciplineViolation[] {
  const violations: DisciplineViolation[] = [];
  const { settings } = state;
  if (settings.totalCapital <= 0) return violations;

  // 单票超限
  for (const p of state.positions) {
    const pct = p.value / settings.totalCapital * 100;
    if (pct > settings.maxSinglePct) {
      violations.push({ level: "critical", text: `${p.name} 仓位 ${pct.toFixed(1)}% 超过单票上限 ${settings.maxSinglePct}%` });
    }
  }

  // 总仓位超限
  const totalValue = state.positions.reduce((s, p) => s + p.value, 0);
  const totalPct = totalValue / settings.totalCapital * 100;
  if (totalPct > settings.maxTotalPct) {
    violations.push({ level: "critical", text: `总仓位 ${totalPct.toFixed(1)}% 超过上限 ${settings.maxTotalPct}%` });
  }

  // 今日新开仓次数
  if (state.todayNewPositions > settings.maxNewPositionsPerDay) {
    violations.push({ level: "warn", text: `今日已开仓 ${state.todayNewPositions} 次，超过上限 ${settings.maxNewPositionsPerDay} 次` });
  }

  // 连续亏损冷静期
  if (state.lossStreak >= settings.cooldownLossStreak) {
    violations.push({ level: "critical", text: `连续亏损 ${state.lossStreak} 次，触发冷静期：建议降低操作频率或暂停` });
  }

  return violations;
}

// ============== 止损参考计算器 ==============
// 基于 ATR 简化版：近期波动越大 → 止损越宽；固定百分比兜底
// 无 ATR 数据时用 4% 保守止损

export interface StopLossResult {
  stopPrice: number | null;
  stopPct: number;
  note: string;
}

export function computeStopLoss(
  cost: number,
  atrPct: number | null,   // 日波动%（如 3.5 = 3.5%）
): StopLossResult {
  if (cost <= 0) return { stopPrice: null, stopPct: 0, note: "成本无效" };
  // 止损幅度 = max(2.5%, ATR × 1.2)，上限 10%
  let stopPct = 4;
  let note = "默认 4% 止损（无波动数据）";
  if (atrPct != null && atrPct > 0) {
    stopPct = Math.max(2.5, Math.min(10, atrPct * 1.2));
    note = `基于波动率 ${atrPct.toFixed(1)}% × 1.2 = ${stopPct.toFixed(1)}% 止损`;
  }
  return { stopPrice: Math.round((cost * (1 - stopPct / 100)) * 100) / 100, stopPct, note };
}

// ============== 冷静期记录 ==============
/** 记录一次交易结果（收盘后复盘调用），更新连续亏损计数 */
export function recordTradeResult(
  state: DisciplineState,
  code: string,
  pnlPct: number,
): DisciplineState {
  const today = localDateStr();
  const recent = [{ date: today, pnlPct, code }, ...state.recentPnl].slice(0, 20);
  // 连续亏损计数：只看最近 N 天，若最新一笔是盈利则清零
  const lossStreak = pnlPct < 0 ? state.lossStreak + 1 : 0;
  return { ...state, recentPnl: recent, lossStreak };
}
