// 主线强度分（v9.23-1，PRD 6.1）
// 游资判断主线强弱的核心：涨停家数占比 25% + 连板高度 20% + 晋级率 15%
//   + 资金连续性 20% + 换手/量能 10% + 催化剂强度 10% = 100
// 设计：从"资金流入金额大"转向"综合强度"——金额大不等于主线强
// 纯函数，不碰 DOM/localStorage/网络

export interface MainlineStrengthInput {
  /** 今日涨停家数 */
  ztCount: number;
  /** 全市场涨停家数（用于占比） */
  totalZtCount: number;
  /** 最高连板 */
  height: number;
  /** 全市场最高连板 */
  totalMaxHeight: number;
  /** 晋级率 0~1（2板→3板） */
  promotionRate: number | null;
  /** 5日主力净流入（元） */
  mainNet5d: number;
  /** 10日主力净流入（元） */
  mainNet10d: number | null;
  /** 今日板块涨幅 % */
  boardPct: number;
  /** 换手率 %（板块均值） */
  turnoverRate: number | null;
  /** 催化剂强度 0~100（AI 或消息面联动打分，无数据给 50） */
  catalystStrength: number | null;
}

export interface MainlineStrengthResult {
  /** 主线强度分 0-100 */
  score: number;
  /** 各子项得分（0-100，便于 UI 展示证据链） */
  factors: {
    ztRatio: number;   // 涨停家数占比
    height: number;    // 连板高度
    promotion: number; // 晋级率
    fund: number;      // 资金连续性
    turnover: number;  // 换手/量能
    catalyst: number;  // 催化剂
  };
  /** 强度评级：gold(≥80 最强主线)/silver(60-79)/bronze(<60) */
  tier: "gold" | "silver" | "bronze";
}

function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v));
}

export function calcMainlineStrength(input: MainlineStrengthInput): MainlineStrengthResult {
  // 1. 涨停家数占比 25%：占全市场涨停比例越高越强
  //    阈值：占比 ≥20% = 100 分，≤2% = 0 分（线性）
  const ratio = input.totalZtCount > 0 ? input.ztCount / input.totalZtCount : 0;
  const ztRatio = clamp(ratio / 0.2 * 100);

  // 2. 连板高度 20%：全市场最高板 = 100 分，1 板 = 0 分
  //    最高板高度占比
  const height = input.totalMaxHeight > 0
    ? clamp(input.height / input.totalMaxHeight * 100)
    : clamp(input.height * 25); // 无全市场数据时：1板=25, 2板=50, 3板=75, 4板=100

  // 3. 晋级率 15%：50% 晋级率 = 100 分，0% = 0 分
  const promotion = input.promotionRate != null
    ? clamp(input.promotionRate / 0.5 * 100)
    : 50; // 无数据中性

  // 4. 资金连续性 20%：5日净流入正向、10日也正向 = 高分
  //    简化：基于 mainNet5d（亿），+5亿 = 100 分，-5亿 = 0 分
  const fund5 = clamp(50 + input.mainNet5d / 1e8 * 10);
  const fund10 = input.mainNet10d != null ? clamp(50 + input.mainNet10d / 1e8 * 5) : 50;
  const fund = (fund5 * 0.6 + fund10 * 0.4); // 5日权重高于10日

  // 5. 换手/量能活跃度 10%：3-8% 换手 = 活跃高分
  let turnover = 50;
  if (input.turnoverRate != null) {
    if (input.turnoverRate >= 3 && input.turnoverRate <= 8) turnover = 85;
    else if (input.turnoverRate > 8) turnover = 60; // 过高换手 → 分歧
    else if (input.turnoverRate >= 1) turnover = 40;
    else turnover = 25;
  }

  // 6. 催化剂强度 10%：AI/消息面打分，无数据中性 50
  const catalyst = input.catalystStrength != null ? clamp(input.catalystStrength) : 50;

  // 加权求和
  const score = Math.round(
    ztRatio * 0.25 +
    height * 0.20 +
    promotion * 0.15 +
    fund * 0.20 +
    turnover * 0.10 +
    catalyst * 0.10,
  );

  return {
    score: clamp(score),
    factors: {
      ztRatio: Math.round(ztRatio),
      height: Math.round(height),
      promotion: Math.round(promotion),
      fund: Math.round(fund),
      turnover: Math.round(turnover),
      catalyst: Math.round(catalyst),
    },
    tier: score >= 80 ? "gold" : score >= 60 ? "silver" : "bronze",
  };
}

/** 强度评级配色（供组件复用） */
export const STRENGTH_META: Record<"gold" | "silver" | "bronze", { label: string; color: string }> = {
  gold: { label: "最强主线", color: "bg-rose-500/25 text-rose-300 border-rose-500/40" },
  silver: { label: "较强", color: "bg-amber-500/20 text-amber-300 border-amber-500/30" },
  bronze: { label: "偏弱", color: "bg-slate-500/20 text-slate-400 border-slate-500/30" },
};
