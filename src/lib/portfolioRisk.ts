// ============================================================
// v9.36（A1）：组合风险预算 —— 幻方"风险预算层"落地
// 幻方顶层：CVaR 动态分配风险预算 + 单策略连续亏损自动熔断。
// 游资版翻译：总仓位是"预算"不是每笔单独决定：
//   总仓位上限 = 基础预算(70%) × 市场状态系数 × 连亏熔断系数
// 联动：marketStateMachine（S2）状态系数 + discipline 持仓连亏熔断
// ============================================================
import type { MarketState } from "./marketStateMachine";

export interface PortfolioRiskInput {
  marketState: MarketState | null;
  /** 持仓盈亏序列（按记录先后，正=赚负=亏） */
  positionPnlPcts: Array<number | null>;
  totalCapital: number;
  currentPositionValue: number;
  /** 基础总仓位预算（默认 70%） */
  basePct?: number;
}

export interface PortfolioRiskResult {
  basePct: number;          // 基础预算 %
  marketFactor: number;     // 市场状态系数（0.2~1.0）
  lossFactor: number;       // 连亏熔断系数（0.4~1.0）
  maxPositionPct: number;   // 最终总仓位上限 %
  currentPct: number;       // 当前实际仓位 %
  overLimit: boolean;       // 是否超限
  lossStreak: number;       // 当前连亏天数
  advice: string;           // 一句话建议
}

/** 市场状态 → 仓位系数（与 marketStateMachine.positionFactor 对齐） */
export const MARKET_FACTOR: Record<MarketState, number> = {
  亢奋普涨: 1.0,
  局部主线: 0.8,
  分歧震荡: 0.6,
  亏钱效应: 0.4,
  冰点恐慌: 0.2,
};

/** 计算连亏天数（从持仓盈亏序列末尾往前数连续亏损） */
export function lossStreakOf(pnlPcts: Array<number | null>): number {
  let streak = 0;
  for (let i = pnlPcts.length - 1; i >= 0; i--) {
    const p = pnlPcts[i];
    if (p == null) continue;        // 无盈亏记录跳过
    if (p < 0) streak++;
    else break;
  }
  return streak;
}

/** 连亏熔断系数：连亏3天降半仓、2天降25% */
export function lossFactorOf(streak: number): number {
  if (streak >= 3) return 0.4;   // 熔断：强制降半仓以下
  if (streak === 2) return 0.75; // 警戒：降25%
  return 1.0;
}

export function computePortfolioRisk(input: PortfolioRiskInput): PortfolioRiskResult {
  const basePct = input.basePct ?? 70;
  const marketFactor = input.marketState ? MARKET_FACTOR[input.marketState] : 0.8;
  const lossStreak = lossStreakOf(input.positionPnlPcts);
  const lossFactor = lossFactorOf(lossStreak);

  let maxPositionPct = Math.round(basePct * marketFactor * lossFactor);
  // 下限 5%（空仓纪律），上限 85%（永不建议满仓借钱）
  maxPositionPct = Math.max(5, Math.min(85, maxPositionPct));

  const currentPct = input.totalCapital > 0
    ? Math.round(input.currentPositionValue / input.totalCapital * 1000) / 10
    : 0;
  const overLimit = currentPct > maxPositionPct;

  let advice: string;
  if (lossStreak >= 3) {
    advice = `连续亏损${lossStreak}天，已熔断：总仓位压至≤${maxPositionPct}%（先空仓一天冷静）`;
  } else if (overLimit) {
    advice = `当前仓位${currentPct}% 超过预算${maxPositionPct}%（${input.marketState ?? "未知状态"}市），建议减仓${Math.round(currentPct - maxPositionPct)}%`;
  } else if (marketFactor >= 1) {
    advice = `${input.marketState}市：风险预算充足，可保持${maxPositionPct}%以内仓位`;
  } else {
    advice = `${input.marketState ?? "未知"}市（系数${marketFactor}），总仓位预算${maxPositionPct}%，当前${currentPct}%`;
  }

  return {
    basePct, marketFactor, lossFactor, maxPositionPct,
    currentPct, overLimit, lossStreak, advice,
  };
}
