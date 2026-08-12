// ============================================================
// src/lib/scenarios/sentimentCycle.ts —— 情绪周期买卖点（v9.118.0，S4-1）
// 阶段 → 买卖点固化映射（游资短线核心坐标系）：
//   冰点→低吸首板试错(轻仓)；退潮→回避接力管住手；启动→打首板/低吸梯队；
//   发酵→接力核心龙头；高潮→只持不开防爆头；分歧→高低切换减高位。
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
  冰点: { stage: "冰点", action: "低吸", positionPct: 15, note: "低吸首板试错（轻仓），情绪孕育反抽" },
  退潮: { stage: "退潮", action: "回避", positionPct: 5, note: "回避接力，管住手，等亏钱效应收敛" },
  启动: { stage: "启动", action: "低吸", positionPct: 25, note: "打首板 / 低吸梯队，溢价回升初期" },
  发酵: { stage: "发酵", action: "接力", positionPct: 35, note: "接力核心龙头，连板梯队成型" },
  高潮: { stage: "高潮", action: "只持", positionPct: 20, note: "只持仓不新开，防爆头，高位兑现" },
  分歧: { stage: "分歧", action: "减仓", positionPct: 15, note: "高低切，减仓高位，警惕退潮" },
};

/** 阶段 → 买卖点（未知阶段 → 观望中性） */
export function stageToAction(stage: SentimentStage): StageAction {
  return STAGE_MAP[stage] ?? { stage, action: "回避", positionPct: 10, note: "阶段未知，观望为主" };
}

/** 认知层情绪阶段 → 买卖点（直接消费 MarketCognition） */
export function sentimentCycleAdvice(cog: { sentiment?: { value?: { stage?: string } } }): StageAction {
  return stageToAction(cog?.sentiment?.value?.stage ?? "");
}
