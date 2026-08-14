// ============================================================
// src/lib/scenarios/sentimentCycle.ts —— 情绪周期买卖点（v9.118.0，S4-1）
// 阶段 → 买卖点固化映射（游资短线核心坐标系）：
//   冰点→底部观察；退潮→回避新仓；启动→低吸/突破试仓；
//   发酵→主线确认回踩加仓；高潮→持有分批止盈；分歧→减仓观察。
// 纯函数，0 token；服务端等价：server/lib/scenarios.js（双端同构）。
// ============================================================

export type SentimentStage = "冰点" | "退潮" | "启动" | "发酵" | "高潮" | "分歧" | string;

export interface StageAction {
  stage: SentimentStage;
  action: "低吸" | "接力" | "回避" | "只持" | "减仓";
  positionPct: number; // 建议仓位上限 %
  note: string;
}

const STAGE_MAP: Record<string, StageAction> = {
  冰点: { stage: "冰点", action: "低吸", positionPct: 15, note: "底部观察，等待放量企稳" },
  退潮: { stage: "退潮", action: "回避", positionPct: 5, note: "回避接力，管住手，等亏钱效应收敛" },
  启动: { stage: "启动", action: "低吸", positionPct: 25, note: "趋势启动确认，低吸/突破试仓" },
  发酵: { stage: "发酵", action: "接力", positionPct: 35, note: "主线确认，回踩分批加仓" },
  高潮: { stage: "高潮", action: "只持", positionPct: 20, note: "持有不追高，分批止盈" },
  分歧: { stage: "分歧", action: "减仓", positionPct: 15, note: "减仓观察，等分歧转一致" },
};

/** 阶段 → 买卖点（未知阶段 → 观望中性） */
export function stageToAction(stage: SentimentStage): StageAction {
  return STAGE_MAP[stage] ?? { stage, action: "回避", positionPct: 10, note: "阶段未知，观望为主" };
}

/** 认知层情绪阶段 → 买卖点（直接消费 MarketCognition） */
export function sentimentCycleAdvice(cog: { sentiment?: { value?: { stage?: string } } }): StageAction {
  return stageToAction(cog?.sentiment?.value?.stage ?? "");
}
