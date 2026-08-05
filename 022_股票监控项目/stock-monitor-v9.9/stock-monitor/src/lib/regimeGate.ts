// 市场闸门：根据情绪分+熔断条件输出仓位系数 + 推荐模式
// 纯函数，不碰 DOM/localStorage/网络
// v9.15：3 模式（full/cautious/low/empty）—— 机构纪律+游资选股 融合

import type { OverviewData } from "../App";

// ============== 基础映射阈值（可调） ==============
/** 情绪分→基础系数映射（v9.26.13：重新设计极端情绪档——不再一律"禁新开仓/空仓"） */
const BASE_MAP: Array<{ max: number; factor: number; label: string }> = [
  // 极度恐慌：原 0.2 偏保守，机构视恐慌为机会（巴菲特"别人恐惧我贪婪"）
  // 改为 0.5 配合"超跌试探"提示 —— 既不空仓也不重仓
  { max: 25,  factor: 0.5, label: "极度恐慌·超跌机会" },
  { max: 45,  factor: 0.6, label: "恐慌·半仓试探" },
  { max: 65,  factor: 1.0, label: "中性·全额作战" },
  { max: 80,  factor: 0.7, label: "贪婪·去弱留强" },
  // 极度贪婪：原 0.3"禁新开仓"过严 —— 改为 0.5"控仓兑现"
  // 控仓 = 不空仓，但不再追高加仓，把已有仓位向确定性最高龙头集中
  { max: 101, factor: 0.5, label: "极度贪婪·控仓兑现" },
];

/** 硬熔断乘数（可调） */
const FUSE_MULTIPLIER = 0.5;
/** 熔断后系数下限（可调） */
const FUSE_FLOOR = 0.2;
/** 炸板率熔断阈值（可调） */
const FUSE_BLASTED_RATE = 40;
/** 晋级率熔断阈值（可调）：昨日首板今日继续封板比例 < 10% 时触发熔断 */
const FUSE_PROMOTION_RATE = 0.10;

// ============== 推荐模式（v9.15 新增） ==============
// 4 种状态：
//   full    - 正常模式：闸门≥0.7，显示所有 A/B 档推荐
//   cautious - 谨慎模式：0.3≤闸门<0.7 或熔断，显示 A 档 + 精选 B 档 + 风险警示
//   low     - 低闸门模式：闸门<0.3，显示最强主线 1-2 个 + 仓位角标 + 风险警示
//   empty   - 数据缺失：闸门=null 或无推荐
export type GateMode = "full" | "cautious" | "low" | "empty";

export interface GateResult {
  factor: number | null;   // null = 数据不足，不给出系数
  label: string;
  reason: string[];  // 熔断原因列表
  /** v9.15：推荐模式 */
  mode: GateMode;
  /** v9.15：建议仓位上限 %（基于 mode + factor） */
  positionLimit: number;
  /** v9.15：风险提示级别（"low" | "mid" | "high" | "none"） */
  riskLevel: "low" | "mid" | "high" | "none";
}

export function computeGate(overview: OverviewData): GateResult {
  const s = overview.sentiment;
  // 数据缺失护栏：sentiment 无效(0/null/NaN)时，绝不下"极度恐慌"结论
  if (s == null || !Number.isFinite(s) || s <= 0) {
    return { factor: null, label: "数据不足·暂不给出系数", reason: [], mode: "empty", positionLimit: 0, riskLevel: "none" };
  }

  // 基础映射（v9.26.10：边界修正 —— 原 s < tier.max 使 s=25 误落"极度恐慌"一档；
  //  现按区间 [prevMax, tier.max) 归属，与 MarketOverview 阈值一致：<25 极度恐慌、25-44 恐慌）
  let baseFactor = 1.0;
  let label = "中性·全额作战";
  let prevMax = 0;
  for (const tier of BASE_MAP) {
    if (s >= prevMax && s < tier.max) {
      baseFactor = tier.factor;
      label = tier.label;
      break;
    }
    prevMax = tier.max;
  }
  // v9.26.10：s ≥ 101（越界）兜底到"极度贪婪"档（原逻辑 baseFactor 恒 1.0）
  if (s >= BASE_MAP[BASE_MAP.length - 1].max) {
    const last = BASE_MAP[BASE_MAP.length - 1];
    baseFactor = last.factor;
    label = last.label;
  }

  // 硬熔断
  const reason: string[] = [];
  const pool = overview.limitPool;

  if (pool && pool.blastedRate > FUSE_BLASTED_RATE) {
    reason.push(`炸板率${pool.blastedRate.toFixed(1)}%>${FUSE_BLASTED_RATE}%`);
  }
  if (overview.premiumAvg != null && overview.premiumAvg < 0) {
    reason.push(`昨日涨停溢价${overview.premiumAvg.toFixed(2)}%为负`);
  }
  if (overview.promotionRate != null && overview.promotionRate < FUSE_PROMOTION_RATE) {
    reason.push(`晋级率${(overview.promotionRate * 100).toFixed(1)}%<${FUSE_PROMOTION_RATE * 100}%`);
  }

  let factor = baseFactor;
  if (reason.length > 0) {
    factor = Math.max(FUSE_FLOOR, factor * FUSE_MULTIPLIER);
  }

  // v9.15：计算推荐模式 + 仓位上限 + 风险等级
  const { mode, positionLimit, riskLevel } = deriveGateMode(factor, reason.length > 0);
  return { factor, label, reason, mode, positionLimit, riskLevel };
}

/** 闸门 → 推荐模式（纯函数，方便单测） */
function deriveGateMode(
  factor: number,
  hasFuse: boolean,
): { mode: GateMode; positionLimit: number; riskLevel: "low" | "mid" | "high" | "none" } {
  if (factor == null) return { mode: "empty", positionLimit: 0, riskLevel: "none" };

  // 闸门分层（修复 v9.15 边界 bug：0.3 应该是 low 模式而非 cautious）
  if (factor <= 0.3) {
    // 极度贪婪（情绪≥80）或 极度恐慌（情绪<25） 或 熔断后衰减到 ≤0.3
    return {
      mode: "low",
      positionLimit: 30,  // 上限 30% 仓
      riskLevel: "high",  // 极端情绪都是高风险
    };
  }
  if (factor < 0.7 || hasFuse) {
    // 半仓区 或 熔断
    return {
      mode: "cautious",
      positionLimit: 50,  // 上限 50% 仓
      riskLevel: "mid",
    };
  }
  // factor > 0.7
  return {
    mode: "full",
    positionLimit: Math.round(factor * 100),  // 100% × 闸门（如 0.8 → 80%）
    riskLevel: "low",
  };
}
