// ============================================================
// 仓位定量化引擎（v9.27 · P1-6）
// 背景：此前"重仓/轻仓参与"只是定性文案，不与闸门/强度/纪律联动。
// 本模块：把 闸门×强度×单票上限 折算成"具体建议仓位 % + 分批 + 止损 %"，
//   并与 discipline（总仓位上限/今日开仓上限）联动截断。
// 纯函数，不碰 DOM/localStorage/网络
// ============================================================

import type { GateResult } from "./regimeGate";
import type { DisciplineSettings } from "./discipline";
import type { MainlineStage } from "./stageModel";

export interface PositionSizingInput {
  mainline: string;
  /** 主线强度分（0-100，null=数据不足） */
  strengthScore: number | null;
  /** 阶段（stageModel 权威词表） */
  stage: MainlineStage;
  /** 闸门结果 */
  gate: GateResult;
  /** 纪律设置（单票上限/总仓位上限） */
  discipline: DisciplineSettings;
  /** 当前总持仓占总资金 %（用于剩余容量截断） */
  currentTotalPct: number;
  /** 今日已开仓次数 */
  todayNewPositions: number;
  /** 主线梯队是否有致命断档（首板→二板断层） */
  ladderBroken?: boolean;
  /** 主线是否整体诱多（trapDetector.detectMainlineTrap.flagged） */
  mainlineTrap?: boolean;
}

export interface PositionTranche {
  trigger: string;
  pct: number;
}

export interface PositionAdvice {
  mainline: string;
  action: "可上车" | "观望" | "禁止";
  /** 建议仓位占总资金 %（已折算闸门×强度×单票上限，并截断） */
  suggestedPct: number;
  /** 分批方案：首仓/加仓/减仓 */
  tranches: PositionTranche[];
  /** 止损 %（基于阶段档位） */
  stopLoss: number | null;
  /** 一句话依据 */
  rationale: string;
}

// ============================================================
// 主入口
// ============================================================
export function computePositionAdvice(input: PositionSizingInput): PositionAdvice {
  const { mainline, strengthScore, stage, gate, discipline, currentTotalPct, todayNewPositions, ladderBroken, mainlineTrap } = input;

  // ---- 硬禁止条件（一票否决，优先） ----
  if (mainlineTrap) {
    return { mainline, action: "禁止", suggestedPct: 0, tranches: [], stopLoss: null, rationale: "主线整体诱多（出货预警），禁止追高参与" };
  }
  if (stage === "退潮期") {
    return { mainline, action: "禁止", suggestedPct: 0, tranches: [], stopLoss: null, rationale: "主线处于退潮期，资金持续撤出，禁止新开仓" };
  }
  if (gate.mode === "empty" || gate.factor == null) {
    return { mainline, action: "禁止", suggestedPct: 0, tranches: [], stopLoss: null, rationale: "闸门数据不足（情绪分缺失），无法给出仓位建议" };
  }
  if (todayNewPositions >= discipline.maxNewPositionsPerDay) {
    return { mainline, action: "禁止", suggestedPct: 0, tranches: [], stopLoss: null, rationale: `今日已开仓${todayNewPositions}次，达到上限${discipline.maxNewPositionsPerDay}次，禁止新开仓` };
  }
  if (discipline.totalCapital <= 0) {
    return { mainline, action: "观望", suggestedPct: 0, tranches: [], stopLoss: null, rationale: "未配置总资金，无法定量建议" };
  }

  // ---- 阶段 → 观望 / 可上车 ----
  // 可上车：启动期/发酵期；分歧期/高潮期/观察中 → 观望
  const tradable = stage === "启动期" || stage === "发酵期";
  if (!tradable) {
    return {
      mainline, action: "观望",
      suggestedPct: 0,
      tranches: [],
      stopLoss: stageStopLoss(stage),
      rationale: `主线处于${stage}，非最佳介入窗口，建议观望等待分歧转一致或回踩确认`,
    };
  }

  // ---- 基础仓位折算：base × gateFactor × strengthDiscount ----
  const base = discipline.maxSinglePct;
  const gateFactor = gate.factor;
  const strengthDiscount = strengthScore == null ? 0.3 : strengthScore >= 80 ? 1 : strengthScore >= 60 ? 0.6 : 0.3;
  let pct = base * gateFactor * strengthDiscount;

  // 梯队断档降档（首→二断档最致命，-40%）
  if (ladderBroken) pct *= 0.6;

  // 与闸门 positionLimit 截断
  pct = Math.min(pct, gate.positionLimit || base);
  // 与纪律单票上限截断
  pct = Math.min(pct, discipline.maxSinglePct);
  // 与剩余总仓位容量截断（总上限 - 当前持仓）
  const remaining = Math.max(0, discipline.maxTotalPct - currentTotalPct);
  pct = Math.min(pct, remaining);
  // 最低参与门槛：<5% 无意义 → 归零观望
  if (pct < 5) {
    return { mainline, action: "观望", suggestedPct: 0, tranches: [], stopLoss: stageStopLoss(stage), rationale: `折算后仓位仅${pct.toFixed(0)}%，低于 5% 参与门槛，建议观望` };
  }

  const pctRounded = Math.round(pct);

  // ---- 分批方案（首仓50% → 确认加仓 → 冲高减仓） ----
  const tranches: PositionTranche[] = [
    { trigger: "首仓建仓（分批进入）", pct: Math.round(pctRounded * 0.5) },
  ];
  if (strengthScore != null && strengthScore >= 80) {
    tranches.push({ trigger: "强度≥80 且晋级确认后加仓", pct: Math.round(pctRounded * 0.3) });
  } else {
    tranches.push({ trigger: "龙头晋级/板块共振确认后加仓", pct: Math.round(pctRounded * 0.3) });
  }
  tranches.push({ trigger: "冲高滞涨/炸板回落时减仓", pct: -Math.round(pctRounded * 0.2) });

  // ---- 止损档位（阶段相关） ----
  const stopLoss = stageStopLoss(stage);

  const rationale = `强度${strengthScore ?? "—"}×闸门${gateFactor.toFixed(1)}×单票上限${base}% = ${pctRounded}%（${stage}）`;

  return { mainline, action: "可上车", suggestedPct: pctRounded, tranches, stopLoss, rationale };
}

// ============================================================
// 阶段 → 止损档位（v9.64 V1-S4：高潮期收紧防高位站岗，启动期放宽给波动空间；原 高潮8>启动5 反向）
// ============================================================
function stageStopLoss(stage: MainlineStage): number | null {
  switch (stage) {
    case "启动期": return 7;   // 刚点火：放宽防被正常洗盘扫损
    case "发酵期": return 6;
    case "高潮期": return 5;   // 高位：收紧止损保护浮盈（跌 5% 即走，利润回吐 8% 太疼）
    case "分歧期": return 5;   // 分歧期收紧
    case "退潮期": return 4;
    default: return 5;
  }
}

// ============================================================
// 便捷封装：一行摘要（供列表徽章用）
// ============================================================
export function positionAdviceSummary(a: PositionAdvice): string {
  if (a.action === "禁止") return `禁止：${a.rationale}`;
  if (a.action === "观望") return `观望：${a.rationale}`;
  return `建议仓位 ${a.suggestedPct}% · 首仓 ${a.tranches[0]?.pct ?? 0}% · 止损 ${a.stopLoss}%`;
}
