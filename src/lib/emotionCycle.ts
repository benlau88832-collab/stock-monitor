// 情绪周期雷达（v9.18-F4 → v9.129.0 一致性收敛重构）
// v9.129.0：阶段判定单一化——唯一判定 = emotionStage.deriveStage（与认知层同构同词表），
//   涨停数/高度/环比/晋级率只作"证据展示"，不再参与阶段判定（此前与认知层两套阈值同屏互斥）。
// 纯函数，不碰 DOM/localStorage/网络。

import { deriveStage, type EmotionStage } from "./emotionStage";

export type { EmotionStage };

export interface EmotionCycleInput {
  sentiment: number | null;       // 情绪分 0-100（PG sentiment_snapshot 单一来源）
  ztCount: number;                // 今日涨停家数（仅证据展示）
  ztCountYesterday: number | null; // 昨日涨停家数（仅证据展示）
  maxBoardHeight: number | null;  // 今日最高连板（仅证据展示）
  maxBoardYesterday: number | null; // 昨日最高连板（仅证据展示）
  blastedRate: number | null;     // 今日炸板率 %（判定入参）
  blastedRatePrev: number | null; // 昨日炸板率 %（仅证据展示）
  premiumAvg: number | null;      // 昨日涨停股今日平均溢价 %（判定入参）
  promotionRate: number | null;   // 2板→3板晋级率 0~1（仅证据展示）
  blastedCount: number | null;    // 今日炸板数（封板率证据）
  redRate: number | null;         // 昨日涨停今日红盘占比（0~1，赚钱效应证据）
}

export interface EmotionCycleResult {
  phase: EmotionStage;
  /** 配套操作基调（中性表述，弱化指令） */
  base: string;
  /** 支撑判断的证据链（3-5 项具体数据） */
  evidence: string[];
  /** 周期置信度 0-100 */
  confidence: number;
  /** 是否处于"退潮预警"（游资最看重：什么时候该跑） */
  ebbAlert: boolean;
  ebbAlertText: string;
}

const BASE_TEXT: Record<EmotionStage, string> = {
  冰点: "历史统计中该阶段为左侧观察期，情绪修复需等待新题材点火。",
  退潮: "历史统计中该阶段次日回撤概率较高，建议收缩关注范围、降低操作频率。",
  启动: "历史统计中该阶段主线开始发酵，可关注新题材龙头发酵强度。",
  发酵: "历史统计中该阶段主线最活跃，但需注意高位分歧随时出现。",
  高潮: "历史统计中该阶段情绪极致一致，次日首分歧概率大，只持不开。",
  分歧: "历史统计中该阶段多空换手加剧，次日方向选择概率大，建议降低仓位敞口观察。",
};

// ============== 判断逻辑（v9.129.0：判定单源化） ==============
export function computeEmotionCycle(input: EmotionCycleInput): EmotionCycleResult {
  const s = input.sentiment ?? 50;
  const zt = input.ztCount ?? 0;
  const ztYoY = input.ztCountYesterday != null && input.ztCountYesterday > 0
    ? (zt - input.ztCountYesterday) / input.ztCountYesterday : null;
  const height = input.maxBoardHeight ?? 0;
  const blasted = input.blastedRate ?? 0;
  const premium = input.premiumAvg ?? 0;
  const promo = input.promotionRate ?? null;
  // v9.96.0（VibeAlpha 对照）：封板率 = 涨停/(涨停+炸板)；红盘率 = 昨日涨停今日红盘占比
  const sealRate = input.blastedCount != null && zt + input.blastedCount > 0
    ? zt / (zt + input.blastedCount) * 100 : null;
  const redRate = input.redRate ?? null;

  // v9.129.0（一致性收敛）：唯一阶段判定 = deriveStage（认知层同构同词表）——
  //   证据链只展示数据，不参与判定（消除与认知横幅的阈值漂移）
  const phase: EmotionStage = deriveStage(s, input.premiumAvg, blasted);

  const evidence: string[] = [];
  evidence.push(`情绪分${s}`);
  evidence.push(`涨停${zt}只${ztYoY != null ? `（环比${ztYoY >= 0 ? "+" : ""}${(ztYoY * 100).toFixed(0)}%）` : ""}`);
  evidence.push(`炸板率${blasted.toFixed(0)}%${input.blastedRatePrev != null ? `（昨${input.blastedRatePrev.toFixed(0)}%）` : ""}`);
  evidence.push(`最高${height}板`);
  if (premium !== 0) evidence.push(`昨日涨停溢价${premium >= 0 ? "+" : ""}${premium.toFixed(1)}%`);
  if (promo != null) evidence.push(`晋级率${(promo * 100).toFixed(0)}%`);
  if (sealRate != null) evidence.push(`封板率${sealRate.toFixed(0)}%`);
  if (redRate != null) evidence.push(`昨日涨停红盘率${(redRate * 100).toFixed(0)}%`);

  const ebbAlert = phase === "退潮" || phase === "冰点" || phase === "高潮";
  const ebbAlertText = phase === "退潮"
    ? "⚠ 退潮预警：情绪周期进入退潮，历史统计中此阶段打板亏损概率高"
    : phase === "冰点"
      ? "⚠ 冰点期：涨停极少+高度压缩，历史统计中此阶段追涨失败率高"
      : phase === "高潮"
        ? "⚠ 高潮预警：情绪极致一致，警惕首分歧，只持不开"
        : "";

  // 置信度：证据数越多越可信
  const confidence = Math.min(95, 55 + evidence.length * 5);

  return { phase, base: BASE_TEXT[phase], evidence: evidence.slice(0, 6), confidence, ebbAlert, ebbAlertText };
}

// ============== 周期配色（供组件复用；六词唯一词表） ==============
export const PHASE_META: Record<EmotionStage, { color: string; icon: string }> = {
  冰点: { color: "bg-sky-900/30 text-sky-500 border-sky-800/40", icon: "🧊" },
  退潮: { color: "bg-slate-500/25 text-slate-300 border-slate-500/40", icon: "📉" },
  启动: { color: "bg-sky-500/20 text-sky-300 border-sky-500/30", icon: "🌱" },
  发酵: { color: "bg-amber-500/20 text-amber-300 border-amber-500/30", icon: "🔥" },
  高潮: { color: "bg-rose-500/20 text-rose-300 border-rose-500/30", icon: "🚀" },
  分歧: { color: "bg-violet-500/20 text-violet-300 border-violet-500/30", icon: "⚡" },
};
