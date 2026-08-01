// 游资/机构行为模式分析（v9.12）
// 核心：通过追踪席位的长期上榜动作（T+1/T+5 收益、胜率、频次），自动给席位打
// "行为模式" 标签——区分值得跟踪的格局派 vs 必须警惕的砸盘派
//
// 设计理念：单个席位的"今日上榜"是噪音，统计上显著的"长期行为"才是真信号
// 标签规则（基于公开统计经验，可按实际数据微调）：
//   格局派   - 值得跟踪：T+1 强（≥+2%）+ T+5 强（≥+5%）+ 胜率≥60%
//   砸盘派   - 务必警惕：T+1 弱（≤-2%）或 T+5 弱（≤-3%）或 胜率<35%
//   波段派   - 适合跟踪波段：T+1 强（≥+3%）但 T+5 回落（<+1%），做一波就走
//   接力派   - 持续上榜+整体胜率≥50%：高频高胜，可做长线跟随
//   一日游   - 上榜后 T+1 经常跌：胜率<40% 或 平均负收益
//   新面孔   - 上榜<3次：样本不足
//   数据不足 - 上榜≥3次但 T+1 样本<5：还没攒够数据

import type { SeatProfile } from "./seatLedger";

export type BehaviorTag = "格局派" | "砸盘派" | "波段派" | "接力派" | "一日游" | "新面孔" | "数据不足";

export interface SeatBehavior {
  deptName: string;
  behavior: BehaviorTag;
  behaviorColor: string;
  /** 一句话解读（如"上榜后平均涨X%，5日继续走高"） */
  hint: string;
  /** 触发判断的关键数据（调试用，UI 可不展示） */
  reasons: string[];
  /** 关联的 SeatProfile 摘要（用于 UI 展示） */
  appearances: number;
  winRateT1: number | null;
  winRateT5: number | null;
  avgPctT1: number | null;
  avgPctT5: number | null;
}

const BEHAVIOR_COLORS: Record<BehaviorTag, string> = {
  格局派: "bg-rose-500/20 text-rose-300 border-rose-500/30",      // 红=最值得
  砸盘派: "bg-slate-500/30 text-slate-300 border-slate-500/30",    // 灰=警惕
  波段派: "bg-amber-500/20 text-amber-300 border-amber-500/30",    // 橙=中等
  接力派: "bg-violet-500/20 text-violet-300 border-violet-500/30",  // 紫=持续可跟
  一日游: "bg-slate-500/20 text-slate-400 border-slate-500/20",     // 浅灰=小心
  新面孔: "bg-white/5 text-slate-500 border-white/10",
  数据不足: "bg-white/5 text-slate-500 border-white/10",
};

const BEHAVIOR_HINT: Record<BehaviorTag, string> = {
  格局派: "上榜后股价持续走高，可作中长线跟踪",
  砸盘派: "上榜后股价常回吐，务必警惕派发行为",
  波段派: "上榜后短期冲高、中期回落，适合做波段",
  接力派: "高频高胜持续上榜，可作长线跟单",
  一日游: "上榜后次日常下跌，纯短线博弈",
  新面孔: "近期新出现的席位，样本积累中",
  数据不足: "T+1 样本不足，无法判定行为模式",
};

/**
 * 根据 SeatProfile（含 T+1/T+5 均收益、胜率、频次）判断行为模式
 * 优先级：砸盘派 > 格局派 > 波段派 > 接力派 > 一日游 > 数据不足 > 新面孔
 */
export function detectSeatBehavior(p: SeatProfile): SeatBehavior {
  const reasons: string[] = [];
  const appearances = p.appearances;
  const t1 = p.avgPctT1;
  const winT1 = p.winRateT1;
  const sample = p.sampleCount;

  // 数据不足优先
  if (appearances < 3) {
    reasons.push(`上榜仅${appearances}次`);
    return mk(p, "新面孔", reasons);
  }
  if (sample < 5) {
    reasons.push(`T+1 样本仅${sample}条`);
    return mk(p, "数据不足", reasons);
  }

  const t1Num = t1 ?? 0;
  const winT1Num = winT1 ?? 0;

  // 1) 砸盘派：上榜后股价常回吐（最危险）
  if (t1Num <= -2 || winT1Num < 35) {
    if (t1Num <= -2) reasons.push(`T+1 均收益${t1Num.toFixed(2)}%（负收益）`);
    if (winT1Num < 35) reasons.push(`T+1 胜率仅${winT1Num}%`);
    return mk(p, "砸盘派", reasons);
  }

  // 2) 格局派：上榜后强势且稳定（最值得跟踪）
  // 条件：T+1 强（≥+2%）+ 胜率高（≥60%）
  if (t1Num >= 2 && winT1Num >= 60) {
    reasons.push(`T+1 均收益${t1Num.toFixed(2)}%`);
    reasons.push(`T+1 胜率${winT1Num}%`);
    if (appearances >= 5) reasons.push(`上榜${appearances}次稳定`);
    return mk(p, "格局派", reasons);
  }

  // 3) 波段派：上榜后 T+1 强，但持续性不足
  // 用现有数据近似：T+1 较强（≥+3%）但胜率一般（40-60%）→ 短期冲高后分化
  if (t1Num >= 3 && winT1Num < 60) {
    reasons.push(`T+1 均收益${t1Num.toFixed(2)}%`);
    reasons.push(`T+1 胜率${winT1Num}%（波动较大）`);
    return mk(p, "波段派", reasons);
  }

  // 4) 接力派：高频高胜（≥10次上榜 + 胜率≥50%）
  if (appearances >= 10 && winT1Num >= 50) {
    reasons.push(`上榜${appearances}次`);
    reasons.push(`T+1 胜率${winT1Num}%`);
    return mk(p, "接力派", reasons);
  }

  // 5) 一日游：上榜 T+1 经常跌
  if (t1Num < 0.5 && winT1Num < 40) {
    reasons.push(`T+1 均收益${t1Num.toFixed(2)}%`);
    reasons.push(`T+1 胜率${winT1Num}%`);
    return mk(p, "一日游", reasons);
  }

  // 兜底：默认归为波段派
  reasons.push(`T+1 均收益${t1Num.toFixed(2)}%`);
  reasons.push(`T+1 胜率${winT1Num}%`);
  return mk(p, "波段派", reasons);
}

function mk(p: SeatProfile, behavior: BehaviorTag, reasons: string[]): SeatBehavior {
  return {
    deptName: p.deptName,
    behavior,
    behaviorColor: BEHAVIOR_COLORS[behavior],
    hint: BEHAVIOR_HINT[behavior],
    reasons,
    appearances: p.appearances,
    winRateT1: p.winRateT1,
    winRateT5: null, // 当前 SeatProfile 未聚合 T+5，扩展时可补
    avgPctT1: p.avgPctT1,
    avgPctT5: null,
  };
}

/** 批量分析（输入 seatProfiles 输出 SeatBehavior[]） */
export function buildSeatBehaviors(profiles: SeatProfile[]): SeatBehavior[] {
  return profiles.map(detectSeatBehavior);
}

/** 单席位的颜色/标签（供组件复用） */
export function behaviorMeta(b: BehaviorTag): { color: string; label: string; hint: string } {
  return { color: BEHAVIOR_COLORS[b], label: b, hint: BEHAVIOR_HINT[b] };
}
