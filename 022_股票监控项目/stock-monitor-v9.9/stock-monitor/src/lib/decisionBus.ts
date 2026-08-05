// ============================================================
// v9.37（V3-4/5）：统一决策总线 —— 多源交叉验证共识层
// 幻方"集成投票 + 因子门控"落地：
//   ① 硬否决：任一源 red（系统性风险/诱多/退潮）→ 直接"禁止"
//   ② 回测门控：信号历史胜率 <45% 或样本不足 → 不计票/降权 0.3
//   ③ 加权投票：各源按权重（历史胜率）投票，加权置信度定结论
//   ④ 分歧告警：各源打架时标"多源分歧，人工复核"
// 输出单一裁决：{ action, confidence, votes, dissent, evidence }
// ============================================================

export type Verdict = "可上车" | "观望" | "禁止";

export interface EvidenceSource {
  name: string;             // 来源名（如 "准入闸" / "诱多引擎"）
  verdict: Verdict;
  confidence: number;       // 0-100
  weight: number;           // 权重（可由历史胜率动态计算）
  reason: string;           // 一句话理由
}

export interface DecisionVerdict {
  action: Verdict;
  confidence: number;       // 0-100
  votes: Array<{ name: string; verdict: Verdict; weight: number }>;
  dissent: string[];        // 反对意见
  evidence: string[];       // 全部证据
  gatedSignals: string[];   // 被回测门控挡掉的信号
  logs?: Array<Record<string, unknown>>; // V3-P2 决策日志
}

/** 回测门控：信号历史胜率 → 权重（样本<6 或胜率<45% 降权 0.3；胜率≥60% 权重 1） */
export function gateWeight(winRate: number | null, samples: number | null): number {
  if (samples == null || samples < 6) return 0.3;   // 样本不足 → 降权
  if (winRate == null) return 0.3;
  if (winRate >= 60) return 1.0;
  if (winRate >= 45) return 0.7;
  return 0.3;                                        // 历史不灵 → 几乎不计票
}

/** 硬否决名单：这些源出 "禁止" 时直接一票否决 */
const VETO_SOURCES = new Set(["系统性风险", "诱多引擎", "组合风险"]);

/** 多源共识裁决（纯函数，可单测） */
export function runConsensus(
  sources: EvidenceSource[],
  opts?: {
    vetoSources?: Set<string>;
    signalGates?: Array<{ name: string; winRate: number | null; samples: number | null }>;
    /** v9.39（改造2）：因子健康度（factorLib 滚动 IC 评估结果）—— 失效因子占比高 → 全局降置信 */
    factorStats?: { decayed: number; total: number };
  },
): DecisionVerdict {
  const vetoSet = opts?.vetoSources ?? VETO_SOURCES;
  const dissent: string[] = [];
  const evidence: string[] = [];

  // ---- ① 硬否决层 ----
  for (const s of sources) {
    if (s.verdict === "禁止" && vetoSet.has(s.name)) {
      return {
        action: "禁止",
        confidence: Math.max(s.confidence, 85),
        votes: sources.map(v => ({ name: v.name, verdict: v.verdict, weight: v.weight })),
        dissent,
        evidence: [...evidence, `❌ ${s.name}一票否决：${s.reason}`],
        gatedSignals: [],
      };
    }
    evidence.push(`${s.name}：${s.verdict}（置信${s.confidence}%）${s.reason}`);
  }

  // ---- ② 回测门控（factor gating）----
  const gatedSignals: string[] = [];
  const gated = new Set<string>();
  if (opts?.signalGates) {
    for (const g of opts.signalGates) {
      const w = gateWeight(g.winRate, g.samples);
      if (w <= 0.3) {
        gated.add(g.name);
        gatedSignals.push(`${g.name}（胜率${g.winRate != null ? g.winRate + "%" : "样本不足"}，已降权）`);
      }
    }
  }
  // 门控后的源（被门控的信号源降权）
  const adjusted = sources.map(s => {
    if (gated.has(s.name)) return { ...s, weight: s.weight * 0.3 };
    return s;
  });

  // ---- ②b 因子健康度（幻方"因子会过期"在线监测接入）----
  // factorLib 滚动 IC 评估出"疑似失效因子"占比高 → 全局下调置信（对"用历史无效信号投票"的惩罚）
  let factorHealthPenalty = 0;
  if (opts?.factorStats && opts.factorStats.total >= 3) {
    const ratio = opts.factorStats.decayed / opts.factorStats.total;
    if (ratio >= 0.5) factorHealthPenalty = 15;
    else if (ratio >= 0.3) factorHealthPenalty = 8;
    if (factorHealthPenalty > 0) {
      evidence.push(`🧪 因子健康度：${opts.factorStats.decayed}/${opts.factorStats.total} 因子疑似失效（|IC|<0.05），置信下调${factorHealthPenalty}%`);
    }
  }

  // ---- ③ 加权投票 ----
  const score = { "可上车": 0, "观望": 0, "禁止": 0 };
  let totalW = 0;
  for (const s of adjusted) {
    score[s.verdict] += s.confidence * s.weight;
    totalW += s.confidence * s.weight;
  }
  const winner = (Object.entries(score) as Array<[Verdict, number]>).sort((a, b) => b[1] - a[1])[0][0];
  const winScore = score[winner];
  const totalScore = score["可上车"] + score["观望"] + score["禁止"];
  let confidence = totalScore > 0 ? Math.round(winScore / totalScore * 100) : 50;
  confidence = Math.max(10, Math.min(95, confidence - factorHealthPenalty));

  // ---- ④ 分歧告警 ----
  const verdicts = new Set(adjusted.map(s => s.verdict));
  if (verdicts.size > 1) {
    const losers = adjusted.filter(s => s.verdict !== winner);
    for (const l of losers) dissent.push(`${l.name}持${l.verdict}：${l.reason}`);
    // 各源严重分裂（胜者置信不足 60%）→ 标分歧
    if (confidence < 60) {
      return {
        action: "观望",
        confidence,
        votes: adjusted.map(v => ({ name: v.name, verdict: v.verdict, weight: v.weight })),
        dissent,
        evidence,
        gatedSignals,
      };
    }
  }

  return {
    action: winner,
    confidence,
    votes: adjusted.map(v => ({ name: v.name, verdict: v.verdict, weight: v.weight })),
    dissent,
    evidence,
    gatedSignals,
  };
}
