// 市场闸门：根据情绪分+熔断条件输出仓位系数
// 纯函数，不碰 DOM/localStorage/网络

import type { OverviewData } from "../App";

// ============== 基础映射阈值（可调） ==============
/** 情绪分→基础系数映射 */
const BASE_MAP: Array<{ max: number; factor: number; label: string }> = [
  { max: 25,  factor: 0.2, label: "极度恐慌·仅ETF" },
  { max: 45,  factor: 0.5, label: "恐慌·半仓试探" },
  { max: 65,  factor: 1.0, label: "中性·全额作战" },
  { max: 80,  factor: 0.8, label: "贪婪·去弱留强" },
  { max: 101, factor: 0.3, label: "极度贪婪·禁新开仓" },
];

/** 硬熔断乘数（可调） */
const FUSE_MULTIPLIER = 0.5;
/** 熔断后系数下限（可调） */
const FUSE_FLOOR = 0.2;
/** 炸板率熔断阈值（可调） */
const FUSE_BLASTED_RATE = 40;
/** 晋级率熔断阈值（可调） */
const FUSE_PROMOTION_RATE = 0.10;

export interface GateResult {
  factor: number;    // 0.2~1.0
  label: string;
  reason: string[];  // 熔断原因列表
}

export function computeGate(overview: OverviewData): GateResult {
  const s = overview.sentiment;

  // 基础映射
  let baseFactor = 1.0;
  let label = "中性·全额作战";
  for (const tier of BASE_MAP) {
    if (s < tier.max) {
      baseFactor = tier.factor;
      label = tier.label;
      break;
    }
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

  return { factor, label, reason };
}
