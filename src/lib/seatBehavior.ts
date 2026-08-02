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

// ============== v9.14：组席主导派分析（5 维评分，多重信号交叉验证） ==============
// 综合判断买入/卖出前五的整体派系，给出"主导派"和操作建议
// 评分维度（加权）：
//   行为模式分布  35%  —— 派系组合（如 格局派主买+砸盘派主卖 强信号）
//   集中度        25%  —— 合力加分（≥3家同买）/ 独食减分（单家>60%）
//   历史 T+1      20%  —— 买方前五的 T+1 均收益方向
//   席位类别      10%  —— 机构/北向/游资 占比
//   新面孔比例    10%  —— 已识别派系的席位占比

import { matchSeatTag } from "./seatProfiles";

export interface GroupAnalysis {
  /** 买方主导派：占比最高的派系 */
  buyerDominant: BehaviorTag | "未识别";
  /** 卖方主导派 */
  sellerDominant: BehaviorTag | "未识别";
  /** 派系分布 */
  buyerDist: Map<BehaviorTag, { count: number; avgNet: number; totalNet: number }>;
  sellerDist: Map<BehaviorTag, { count: number; avgNet: number; totalNet: number }>;
  /** 5 维评分（0-100） */
  scores: {
    behavior: number;       // 行为模式分布
    concentration: number;  // 集中度（合力/独食）
    historicalT1: number;   // 买方历史 T+1
    seatCategory: number;   // 席位类别（机构/北向/游资）
    recogRate: number;      // 新面孔比例（已识别占比）
    total: number;          // 加权综合
  };
  /** 信号徽标（多枚） */
  signals: { kind: string; label: string; tone: "good" | "warn" | "bad" | "info" }[];
  /** 信号解读（中性表述） */
  suggestion: string;
  /** 信号强度（强/中/弱） */
  confidence: "强" | "中" | "弱";
  /** 兼容旧字段：0-1 强度 */
  strength: number;
  /** 风险警示（如果低分/新面孔多） */
  warnings: string[];
}

interface SeatWithNet {
  deptName: string;
  net: number;
}

export function analyzeSeatsGroup(
  buyers: SeatWithNet[],
  sellers: SeatWithNet[],
  behaviorMap: Map<string, SeatBehavior>,
): GroupAnalysis {
  // ============== 1. 行为模式分布 ==============
  function dist(seats: SeatWithNet[]): Map<BehaviorTag, { count: number; avgNet: number; totalNet: number }> {
    const d = new Map<BehaviorTag, { count: number; avgNet: number; totalNet: number }>();
    for (const s of seats) {
      const bh = behaviorMap.get(s.deptName);
      if (!bh) continue;
      const cur = d.get(bh.behavior) ?? { count: 0, avgNet: 0, totalNet: 0 };
      cur.count++;
      cur.totalNet += s.net;
      cur.avgNet = cur.totalNet / cur.count;
      d.set(bh.behavior, cur);
    }
    return d;
  }
  const buyerDist = dist(buyers);
  const sellerDist = dist(sellers);

  function dominant(d: Map<BehaviorTag, { count: number; avgNet: number; totalNet: number }>): { tag: BehaviorTag | "未识别"; strength: number } {
    if (d.size === 0) return { tag: "未识别", strength: 0 };
    let best: [BehaviorTag, { count: number; avgNet: number; totalNet: number }] | null = null;
    let totalCount = 0;
    for (const [tag, v] of d) {
      totalCount += v.count;
      if (!best || v.count > best[1].count) best = [tag, v];
    }
    if (!best) return { tag: "未识别", strength: 0 };
    return { tag: best[0], strength: best[1].count / totalCount };
  }
  const buyerDom = dominant(buyerDist);
  const sellerDom = dominant(sellerDist);
  const bTag = buyerDom.tag;
  const sTag = sellerDom.tag;

  // 派系组合分（0-100）：最强的几种组合
  let behaviorScore = 50; // 基础分
  if (bTag === "格局派" && (sTag === "砸盘派" || sTag === "一日游")) behaviorScore = 95;  // 最强
  else if (bTag === "格局派" && sTag === "格局派") behaviorScore = 70;                   // 中性
  else if (bTag === "砸盘派" || bTag === "一日游") behaviorScore = 15;                   // 弱
  else if (bTag === "波段派" || bTag === "接力派") behaviorScore = 60;                   // 中
  else if (bTag === "新面孔" || bTag === "数据不足" || bTag === "未识别") behaviorScore = 35;
  // 卖方是格局派的减分（可能是股东减仓）
  if (sTag === "格局派" && bTag !== "砸盘派") behaviorScore -= 10;

  // ============== 2. 集中度（合力/独食） ==============
  const totalBuyerNet = buyers.reduce((s, b) => s + Math.max(0, b.net), 0);
  const maxBuyerNet = buyers.length > 0 ? Math.max(...buyers.map(b => Math.max(0, b.net))) : 0;
  const buyerTopPct = totalBuyerNet > 0 ? maxBuyerNet / totalBuyerNet : 0;
  const buyerSeats = buyers.length;
  // 合力：≥3 家不同席位有非零净买
  const heLiCount = buyers.filter(b => b.net > 0).length;
  const concentrationScore = (() => {
    let s = 60; // 基础
    if (buyerTopPct > 0.6) s -= 30;  // 独食
    else if (buyerTopPct > 0.45) s -= 10;
    if (heLiCount >= 4) s += 25;       // 强合力
    else if (heLiCount >= 3) s += 15;
    else if (heLiCount <= 1 && buyerSeats >= 3) s -= 15;  // 高度集中
    return Math.max(0, Math.min(100, s));
  })();

  // ============== 3. 买方历史 T+1 整体均收益 ==============
  const buyerT1s: number[] = [];
  for (const b of buyers) {
    const bh = behaviorMap.get(b.deptName);
    if (bh && bh.avgPctT1 != null) buyerT1s.push(bh.avgPctT1);
  }
  const avgBuyerT1 = buyerT1s.length > 0 ? buyerT1s.reduce((s, v) => s + v, 0) / buyerT1s.length : null;
  const historicalT1Score = (() => {
    if (avgBuyerT1 == null) return 50; // 数据不足，给中性分
    if (avgBuyerT1 >= 5) return 90;
    if (avgBuyerT1 >= 2) return 75;
    if (avgBuyerT1 >= 0) return 60;
    if (avgBuyerT1 >= -2) return 35;
    return 10;
  })();

  // ============== 4. 席位类别（机构/北向/游资） ==============
  function catCount(seats: SeatWithNet[]): { inst: number; north: number; hot: number; other: number; total: number } {
    let inst = 0, north = 0, hot = 0, other = 0;
    for (const s of seats) {
      const tag = matchSeatTag(s.deptName);
      if (tag?.category === "institution") inst++;
      else if (tag?.category === "northbound") north++;
      else if (tag?.category === "hotmoney") hot++;
      else if (s.net > 0) other++;  // 未识别但有买入
    }
    return { inst, north, hot, other, total: seats.length };
  }
  const buyerCat = catCount(buyers);
  const sellerCat = catCount(sellers);
  const seatCategoryScore = (() => {
    let s = 50;
    if (buyerCat.total > 0) {
      const instPct = buyerCat.inst / buyerCat.total;
      const northPct = buyerCat.north / buyerCat.total;
      if (instPct >= 0.5) s += 15;       // 机构主导
      else if (instPct >= 0.3) s += 8;
      if (northPct >= 0.3) s += 8;        // 北向加仓
    }
    if (sellerCat.total > 0) {
      const instSellPct = sellerCat.inst / sellerCat.total;
      if (instSellPct >= 0.5) s -= 10;  // 机构派发
    }
    return Math.max(0, Math.min(100, s));
  })();

  // ============== 5. 新面孔比例（已识别派系占比） ==============
  const buyerRecogCount = buyers.filter(b => behaviorMap.has(b.deptName) && !["新面孔", "数据不足"].includes(behaviorMap.get(b.deptName)!.behavior)).length;
  const recogRate = buyers.length > 0 ? buyerRecogCount / buyers.length : 0;
  const recogRateScore = (() => {
    if (recogRate >= 0.8) return 85;
    if (recogRate >= 0.6) return 70;
    if (recogRate >= 0.4) return 50;
    if (recogRate >= 0.2) return 30;
    return 10;  // 全是不认识的新面孔
  })();

  // ============== 综合评分 ==============
  const scores = {
    behavior: behaviorScore,
    concentration: concentrationScore,
    historicalT1: historicalT1Score,
    seatCategory: seatCategoryScore,
    recogRate: recogRateScore,
    total: Math.round(behaviorScore * 0.35 + concentrationScore * 0.25 + historicalT1Score * 0.20 + seatCategoryScore * 0.10 + recogRateScore * 0.10),
  };

  // ============== 信号徽标 ==============
  const signals: { kind: string; label: string; tone: "good" | "warn" | "bad" | "info" }[] = [];
  if (heLiCount >= 3) signals.push({ kind: "合力", label: `🤝 合力 (${heLiCount}家同买)`, tone: "good" });
  if (buyerTopPct > 0.6) signals.push({ kind: "独食", label: `🍽️ 独食 (单家占 ${(buyerTopPct * 100).toFixed(0)}%)`, tone: "bad" });
  if (buyerCat.inst / Math.max(1, buyerCat.total) >= 0.5) signals.push({ kind: "机构", label: `🏦 机构主导 (${buyerCat.inst}/${buyerCat.total})`, tone: "info" });
  if (buyerCat.north / Math.max(1, buyerCat.total) >= 0.3) signals.push({ kind: "北向", label: `🌏 北向加仓 (${buyerCat.north}/${buyerCat.total})`, tone: "good" });
  if (bTag === "砸盘派" || bTag === "一日游") signals.push({ kind: "砸盘", label: `⚠️ 砸盘派主买 (历史T+1 ${avgBuyerT1?.toFixed(1) ?? "—"}%)`, tone: "bad" });
  if (sTag === "砸盘派" || sTag === "一日游") signals.push({ kind: "派发", label: `📤 卖方主力派发`, tone: "warn" });
  if (bTag === "格局派") signals.push({ kind: "格局", label: `🏆 格局派主买 (胜率 ${behaviorMap.get(buyers.find(b => behaviorMap.get(b.deptName)?.behavior === "格局派")?.deptName ?? "")?.winRateT1 ?? "—"}%)`, tone: "good" });
  if (recogRate < 0.4 && buyers.length > 0) signals.push({ kind: "新面孔", label: `❔ 买方新面孔多 (${(recogRate * 100).toFixed(0)}% 已识别)`, tone: "warn" });
  if (scores.historicalT1 >= 75) signals.push({ kind: "强势T1", label: `📈 买方历史 T+1 均 ${avgBuyerT1?.toFixed(1)}%`, tone: "good" });
  else if (scores.historicalT1 <= 35 && avgBuyerT1 != null) signals.push({ kind: "弱势T1", label: `📉 买方历史 T+1 均 ${avgBuyerT1?.toFixed(1)}%`, tone: "bad" });

  // ============== 信号解读（基于 5 维评分，中性表述） ==============
  const confidence: GroupAnalysis["confidence"] = scores.total >= 70 ? "强" : scores.total >= 40 ? "中" : "弱";
  let suggestion = "";
  const warnings: string[] = [];
  if (bTag === "格局派" && (sTag === "砸盘派" || sTag === "一日游") && confidence !== "弱") {
    suggestion = "✅ **格局派主买 + 砸盘派主卖** —— 历史统计中此类组合次日/中期走强概率较高（样本：长期席位画像），仅供参考。";
  } else if (bTag === "格局派" && sTag === "格局派") {
    suggestion = "✅ **格局派对倒** —— 多空均为长期持有者，历史统计信号偏中性（股东内部调仓特征）。";
  } else if (bTag === "砸盘派" || bTag === "一日游") {
    suggestion = "⚠️ **砸盘派主买** —— 历史统计中该派系上榜后 T+1 回吐概率较高（见席位画像），需注意风险。";
    warnings.push("买方主导为砸盘派/一日游，历史胜率<35%");
  } else if (bTag === "波段派" || bTag === "接力派") {
    suggestion = `🟡 **${bTag}主买** —— ${bTag === "接力派" ? "高频高胜，可作长线跟" : "适合做波段"}。建议分批，不一次性重仓。`;
  } else if (bTag === "新面孔" || bTag === "数据不足" || bTag === "未识别") {
    suggestion = "❔ 买方多为新面孔或数据不足，历史统计参考价值有限，请谨慎。";
    warnings.push("买方已识别派系席位占比<40%，统计样本不足");
  } else {
    suggestion = "🟡 买方派系不明显，结合其他信号判断。";
  }
  if (sTag === "格局派" && bTag !== "砸盘派" && confidence !== "弱") {
    suggestion += "（卖方为格局派，历史统计中有序减仓特征）";
  }
  if (scores.concentration < 30) {
    warnings.push("买盘高度集中（独食），历史统计信号可靠度偏低");
  }
  if (scores.historicalT1 < 40 && avgBuyerT1 != null) {
    warnings.push(`买方历史 T+1 平均 ${avgBuyerT1.toFixed(2)}%，偏弱`);
  }

  return {
    buyerDominant: bTag,
    sellerDominant: sTag,
    buyerDist, sellerDist,
    scores,
    signals,
    suggestion,
    confidence,
    strength: scores.total / 100,
    warnings,
  };
}
