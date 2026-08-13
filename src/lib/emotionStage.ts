// ============================================================
// 情绪周期唯一判定（v9.129.0 一致性收敛——用户授权重构合并）
// 背景：市场情绪周期此前 3 套判定并存（认知层 deriveSentimentStage / emotionCycle 五档 /
//   emotionAnalysis 组合词 / 状态机分档），同屏"冰点/退潮期/亢奋普涨"互斥。
// 本模块 = 前端唯一判定，与 server/lib/cognition.js deriveSentimentStage 同规则双端同构
//   （emotionStageGolden.test.ts 全输入空间锁定，单侧改动必红）。
// 词表：六词 {冰点,退潮,启动,发酵,高潮,分歧} —— 全站情绪周期唯一词表。
// 输入：情绪分 0-100（全站单一来源 = PG sentiment_snapshot，App.tsx 已收敛）+
//       昨日涨停今日溢价 %（null 按 0）+ 炸板率 %（0-100，null 按 0）。
// 纯函数，不碰 DOM/localStorage/网络。
// ============================================================

export type EmotionStage = "冰点" | "退潮" | "启动" | "发酵" | "高潮" | "分歧";

export const EMOTION_STAGES: EmotionStage[] = ["冰点", "退潮", "启动", "发酵", "高潮", "分歧"];

/**
 * 情绪周期判定（与 server/lib/cognition.js deriveSentimentStage 逐字同构，口径注释以服务端为准）。
 * 关键语义：premium<0（昨日涨停今日负溢价=接力亏钱）强制压制阶段到 退潮/分歧，
 *   高温度分不得掩盖亏钱效应（审查官验收口径）。
 */
export function deriveStage(score: number, premium: number | null, brokenRatePct: number | null): EmotionStage {
  const s = typeof score === "number" && Number.isFinite(score) ? score : 0;
  const p = typeof premium === "number" && Number.isFinite(premium) ? premium : 0;
  const b = typeof brokenRatePct === "number" && Number.isFinite(brokenRatePct) ? brokenRatePct : 0;
  if (s < 30) return "冰点";
  if (s < 45) return "退潮";
  if (p < 0) return b > 15 ? "分歧" : "退潮";
  if (s > 82 && p > 3) return b > 15 ? "分歧" : "高潮";
  if (s > 65) return "发酵";
  return "启动";
}

/** 阶段 → 买卖点（与 decisionCore.stageActionOf 同词表；决策层为准，此处供展示复用） */
export function stageActionOf(stage: EmotionStage): string {
  const map: Record<EmotionStage, string> = {
    冰点: "低吸首板试错(轻仓)", 退潮: "回避接力，管住手", 启动: "打首板/低吸梯队",
    发酵: "接力核心龙头", 高潮: "只持不开，防爆头", 分歧: "高低切，减高位",
  };
  return map[stage] ?? "观望为主";
}
