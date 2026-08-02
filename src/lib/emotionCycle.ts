// 情绪周期雷达（v9.18-F4）
// 温度计 2.0：把分散的情绪数据组装成"五档周期判断"（启动/主升/分歧/退潮/冰点）
// 核心：游资交易本质是赌"情绪周期的位置"——判断错周期，其他分析都无意义
// 纯函数，不碰 DOM/localStorage/网络

export type EmotionPhase = "启动" | "主升" | "分歧" | "退潮" | "冰点";

export interface EmotionCycleInput {
  sentiment: number | null;       // 今日温度计 0-100
  ztCount: number;                // 今日涨停家数
  ztCountYesterday: number | null; // 昨日涨停家数（环比）
  maxBoardHeight: number | null;  // 今日最高连板
  maxBoardYesterday: number | null; // 昨日最高连板
  blastedRate: number | null;     // 今日炸板率 %
  blastedRatePrev: number | null; // 昨日炸板率 %
  premiumAvg: number | null;      // 昨日涨停股今日平均溢价 %
  promotionRate: number | null;   // 2板→3板晋级率 0~1
}

export interface EmotionCycleResult {
  phase: EmotionPhase;
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

// ============== 判断逻辑 ==============
// 五档判定优先级：冰点 → 退潮 → 启动 → 主升 → 分歧
// 综合信号（游资实战口径）：
//   - 退潮：炸板率攀升 + 涨停数萎缩 + 溢价转负 + 晋级率低
//   - 冰点：涨停数极低(<15) + 最高板≤2 + 情绪分<30
//   - 启动：涨停数环比大增 + 高度抬升 + 情绪回升
//   - 主升：涨停数高位 + 高度新高 + 溢价为正 + 炸板率低
//   - 分歧：涨停数高位但炸板率攀升 + 溢价走弱 + 晋级率下降

export function computeEmotionCycle(input: EmotionCycleInput): EmotionCycleResult {
  const s = input.sentiment ?? 50;
  const zt = input.ztCount ?? 0;
  const ztYoY = input.ztCountYesterday != null && input.ztCountYesterday > 0
    ? (zt - input.ztCountYesterday) / input.ztCountYesterday : null;
  const height = input.maxBoardHeight ?? 0;
  const heightUp = input.maxBoardYesterday != null && height > input.maxBoardYesterday;
  const blasted = input.blastedRate ?? 50;
  const blastedUp = input.blastedRatePrev != null && blasted > input.blastedRatePrev;
  const premium = input.premiumAvg ?? 0;
  const promo = input.promotionRate ?? 0.3;

  const evidence: string[] = [];
  let phase: EmotionPhase;
  let base: string;

  // ---- 冰点：涨停极少 + 高度压到2板以下 + 情绪低迷 ----
  if (zt < 15 && height <= 2 && s < 30) {
    phase = "冰点";
    base = "历史统计中该阶段为左侧观察期，情绪修复需等待新题材点火。";
    evidence.push(`涨停仅${zt}只`);
    evidence.push(`最高仅${height}板`);
    evidence.push(`情绪分${s}（低迷）`);
    evidence.push(blasted > 40 ? `炸板率${blasted.toFixed(0)}%偏高` : `炸板率${blasted.toFixed(0)}%`);
  }
  // ---- 退潮：炸板率攀升 + 涨停萎缩 + 溢价转负（核心预警） ----
  else if (
    (blasted > 35 && blastedUp) ||
    (premium < 0) ||
    (ztYoY != null && ztYoY < -0.3 && blasted > 30) ||
    (promo < 0.1 && zt > 20)
  ) {
    phase = "退潮";
    base = "历史统计中该阶段次日回撤概率较高，建议收缩关注范围、降低操作频率。";
    if (blasted > 35 && blastedUp) evidence.push(`炸板率${blasted.toFixed(0)}%较昨日攀升`);
    if (premium < 0) evidence.push(`昨日涨停今日溢价${premium.toFixed(1)}%（转负）`);
    if (ztYoY != null && ztYoY < -0.3) evidence.push(`涨停数环比${(ztYoY * 100).toFixed(0)}%萎缩`);
    if (promo < 0.1 && zt > 20) evidence.push(`晋级率${(promo * 100).toFixed(0)}%偏低`);
    if (evidence.length < 3) evidence.push(`今日涨停${zt}只`);
  }
  // ---- 启动：涨停环比大增 + 高度抬升 + 情绪回升 ----
  else if (
    (ztYoY != null && ztYoY > 0.3) ||
    (heightUp && zt >= 20)
  ) {
    phase = "启动";
    base = "历史统计中该阶段主线开始发酵，可关注新题材龙头发酵强度。";
    if (ztYoY != null) evidence.push(`涨停数环比${(ztYoY * 100).toFixed(0)}%增加`);
    if (heightUp) evidence.push(`最高板升至${height}板`);
    evidence.push(`情绪分${s}`);
    evidence.push(`炸板率${blasted.toFixed(0)}%`);
  }
  // ---- 主升：涨停高位 + 溢价为正 + 炸板率低 + 晋级率正常 ----
  else if (
    zt >= 30 && premium >= 0 && blasted <= 30 && promo >= 0.1
  ) {
    phase = "主升";
    base = "历史统计中该阶段主线最活跃，但需注意高位分歧随时出现。";
    evidence.push(`涨停${zt}只（高位）`);
    evidence.push(`昨日涨停溢价${premium.toFixed(1)}%（为正）`);
    evidence.push(`炸板率${blasted.toFixed(0)}%（偏低）`);
    evidence.push(`最高${height}板`);
  }
  // ---- 分歧：涨停高位但炸板攀升 / 溢价走弱 / 晋级率下滑 ----
  else if (
    (zt >= 20 && blasted > 30) ||
    (premium < 2 && zt >= 25) ||
    (promo < 0.15 && promo > 0.05)
  ) {
    phase = "分歧";
    base = "历史统计中该阶段多空换手加剧，次日方向选择概率大，建议降低仓位敞口观察。";
    if (zt >= 20 && blasted > 30) evidence.push(`涨停${zt}只但炸板率${blasted.toFixed(0)}%`);
    if (premium < 2) evidence.push(`昨日涨停溢价${premium.toFixed(1)}%（走弱）`);
    if (promo < 0.15 && promo > 0.05) evidence.push(`晋级率${(promo * 100).toFixed(0)}%（下滑）`);
    if (evidence.length < 2) evidence.push(`最高${height}板`);
  }
  // ---- 兜底：中性震荡 ----
  else {
    phase = "分歧";
    base = "当前信号无明显单边特征，属于结构性震荡期。";
    evidence.push(`涨停${zt}只`);
    evidence.push(`情绪分${s}`);
    evidence.push(`炸板率${blasted.toFixed(0)}%`);
  }

  // 退潮预警（游资最看重）
  const ebbAlert = phase === "退潮" || phase === "冰点";
  const ebbAlertText = phase === "退潮"
    ? "⚠ 退潮预警：炸板率/溢价/晋级率多项转弱，历史统计中此阶段打板亏损概率高"
    : phase === "冰点"
    ? "⚠ 冰点期：涨停极少+高度压缩，历史统计中此阶段追涨失败率高"
    : "";

  // 置信度：证据数越多越可信
  const confidence = Math.min(95, 55 + evidence.length * 8);

  return { phase, base, evidence, confidence, ebbAlert, ebbAlertText };
}

// ============== 周期配色（供组件复用） ==============
export const PHASE_META: Record<EmotionPhase, { color: string; icon: string }> = {
  启动: { color: "bg-sky-500/20 text-sky-300 border-sky-500/30", icon: "🌱" },
  主升: { color: "bg-rose-500/20 text-rose-300 border-rose-500/30", icon: "🔥" },
  分歧: { color: "bg-amber-500/20 text-amber-300 border-amber-500/30", icon: "⚡" },
  退潮: { color: "bg-slate-500/25 text-slate-300 border-slate-500/40", icon: "📉" },
  冰点: { color: "bg-sky-900/30 text-sky-500 border-sky-800/40", icon: "🧊" },
};
