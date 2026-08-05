// ============================================================
// v9.37（V3-4）：证据汇聚器 —— 各引擎输出 → 统一 EvidenceSource
// 供 DecisionVerdictCard 消费；五层独立证据源：
//   规则引擎(准入闸) / 量化因子(强度+回测) / 资金真金(龙虎榜+连续性)
//   风控否决(sysRisk+portfolioRisk) / 诱多(seal+trap)
// ============================================================
import type { EvidenceSource } from "./decisionBus";

export interface DecisionCollectInput {
  mainline: string;
  /** 准入闸结果：action 三态 */
  admissionAction: "可上车" | "观望" | "禁止";
  admissionConfidence: number;
  admissionReason: string;
  /** 市场状态（marketStateMachine） */
  marketState: string;
  /** 市场状态仓位系数 0.2~1.0 */
  marketFactor: number;
  /** 组合风险预算是否超限/熔断 */
  riskOverLimit: boolean;
  riskLossStreak: number;
  riskMaxPct: number;
  /** 诱多信号（主线级） */
  trapFlagged: boolean;
  trapRate: number;
  /** 封单衰减：黄色/红色 */
  sealRedCount: number;
  sealYellowCount: number;
  /** 系统性风险 level: red/yellow/none */
  sysRiskLevel: "red" | "yellow" | "none";
  /** 龙虎榜交叉是否加持（有涨停股上榜） */
  lhbBoost: boolean;
  /** 资金连续性：是否有切换/连续流入 */
  fundStreakInflow: boolean;
  /** 信号回测门控（V3-5） */
  signalGates?: Array<{ name: string; winRate: number | null; samples: number | null }>;
}

export function collectEvidence(input: DecisionCollectInput): EvidenceSource[] {
  const sources: EvidenceSource[] = [];

  // 视角1：规则引擎（准入闸）
  sources.push({
    name: "准入闸",
    verdict: input.admissionAction,
    confidence: input.admissionConfidence,
    weight: 1.0,
    reason: input.admissionReason || `准入${input.admissionAction}`,
  });

  // 视角5a：系统性风险（一票否决）
  if (input.sysRiskLevel === "red") {
    sources.push({ name: "系统性风险", verdict: "禁止", confidence: 90, weight: 1.0, reason: "系统性风险 red（大盘/跌停/炸板/情绪触发）" });
  } else if (input.sysRiskLevel === "yellow") {
    sources.push({ name: "系统性风险", verdict: "观望", confidence: 65, weight: 0.8, reason: "系统性风险黄色预警" });
  } else {
    sources.push({ name: "系统性风险", verdict: "观望", confidence: 50, weight: 0.5, reason: "无系统性风险信号" });
  }

  // 视角5b：组合风险（一票否决）
  if (input.riskOverLimit || input.riskLossStreak >= 3) {
    sources.push({ name: "组合风险", verdict: "禁止", confidence: 85, weight: 1.0, reason: `组合超限/连亏${input.riskLossStreak}天熔断，上限${input.riskMaxPct}%` });
  } else {
    sources.push({ name: "组合风险", verdict: input.marketFactor >= 0.8 ? "可上车" : "观望", confidence: Math.round(50 + input.marketFactor * 40), weight: 0.8, reason: `${input.marketState}市（系数${input.marketFactor}）` });
  }

  // 视角2：量化因子（市场状态 + 主线强度）
  sources.push({
    name: "市场状态",
    verdict: input.marketFactor >= 0.8 ? "可上车" : input.marketFactor >= 0.5 ? "观望" : "禁止",
    confidence: Math.round(40 + input.marketFactor * 50),
    weight: gateWeightByFactor(input.marketFactor),
    reason: `${input.marketState}（仓位系数${input.marketFactor}）`,
  });

  // 视角：诱多（一票否决）
  if (input.trapFlagged) {
    sources.push({ name: "诱多引擎", verdict: "禁止", confidence: 88, weight: 1.0, reason: `主线内诱多占比${Math.round(input.trapRate * 100)}%` });
  } else {
    sources.push({ name: "诱多引擎", verdict: "观望", confidence: 55, weight: 0.6, reason: "未检测到主线诱多" });
  }

  // 视角：封单（盘中信号）
  if (input.sealRedCount > 0) {
    sources.push({ name: "封单监控", verdict: "禁止", confidence: 85, weight: 0.9, reason: `${input.sealRedCount}只封单崩落` });
  } else if (input.sealYellowCount > 0) {
    sources.push({ name: "封单监控", verdict: "观望", confidence: 60, weight: 0.6, reason: `${input.sealYellowCount}只封单衰减` });
  }

  // 视角3：资金真金（龙虎榜 + 连续性）
  if (input.lhbBoost) {
    sources.push({ name: "龙虎榜交叉", verdict: "可上车", confidence: 75, weight: 0.9, reason: "今日涨停股有龙虎榜席位加持" });
  } else {
    sources.push({ name: "龙虎榜交叉", verdict: "观望", confidence: 50, weight: 0.5, reason: "无席位加持样本" });
  }
  if (input.fundStreakInflow) {
    sources.push({ name: "资金连续性", verdict: "可上车", confidence: 70, weight: 0.7, reason: "主线行业资金连续流入" });
  }

  return sources;
}

function gateWeightByFactor(f: number): number {
  if (f >= 0.8) return 1.0;
  if (f >= 0.5) return 0.7;
  return 0.5;
}
