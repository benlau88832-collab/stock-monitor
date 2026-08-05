// ============================================================
// 最终准入闸（v9.28 · P1-5）
// 背景：此前"可上车"仅看强度分≥阈值，未联动阶段/闸门/诱多/梯队断档。
// 本模块：五重准入（强度 + 阶段 + 闸门 + 诱多 + 梯队），输出"可上车/观望/禁止" + 置信度。
// 与 positionSizing 的分工：准入闸回答"能不能上车"（三态），仓位引擎回答"上多少"（百分比）。
// 纯函数，不碰 DOM/localStorage/网络
// ============================================================

import type { GateMode } from "./regimeGate";
import type { MainlineStage } from "./stageModel";

export interface AdmissionInput {
  /** 主线强度分 0-100（null=数据不足） */
  strengthScore: number | null;
  /** 阶段（stageModel 权威词表） */
  stage: MainlineStage;
  /** 闸门模式 */
  gateMode: GateMode;
  /** 主线整体诱多（trapDetector.detectMainlineTrap.flagged） */
  mainlineTrap?: boolean;
  /** 梯队致命断档（首板→二板断层） */
  ladderBroken?: boolean;
  /** 涨停家数 */
  ztCount: number;
  /** 最高连板 */
  height: number;
}

export interface AdmissionResult {
  /** 是否放行上车 */
  pass: boolean;
  action: "可上车" | "观望" | "禁止";
  /** 0-100 */
  confidence: number;
  /** 放行依据（证据链） */
  reasons: string[];
  /** 阻止原因（未放行时展示） */
  blockers: string[];
}

// ============================================================
// 五重准入（从硬到软）
// ============================================================
export function evaluateAdmission(input: AdmissionInput): AdmissionResult {
  const { strengthScore, stage, gateMode, mainlineTrap = false, ladderBroken = false, ztCount, height } = input;
  const blockers: string[] = [];
  const reasons: string[] = [];

  // ① 诱多一票否决
  if (mainlineTrap) {
    blockers.push("主线整体诱多（出货预警）");
    return { pass: false, action: "禁止", confidence: 0, reasons: [], blockers };
  }

  // ② 退潮期一票否决
  if (stage === "退潮期") {
    blockers.push("主线处于退潮期，资金持续撤出");
    return { pass: false, action: "禁止", confidence: 0, reasons: [], blockers };
  }

  // ③ 闸门数据不足
  if (gateMode === "empty") {
    blockers.push("闸门数据不足（情绪分缺失）");
    return { pass: false, action: "禁止", confidence: 0, reasons: [], blockers };
  }

  // ④ 强度门槛
  const score = strengthScore ?? 0;
  if (score < 60) {
    blockers.push(`强度分 ${score} < 60（数据不足按 0 计）`);
  } else {
    reasons.push(`强度分 ${score}（≥60）`);
  }

  // ⑤ 阶段窗口：仅启动期/发酵期可上车，其余观望
  if (stage === "分歧期") blockers.push("主线处于分歧期，多空换手加剧，等待方向选择");
  else if (stage === "高潮期") blockers.push("主线处于高潮期，追高风险大");
  else if (stage === "观察中") blockers.push("主线阶段不明确（观察中）");
  else reasons.push(`阶段 ${stage}（介入窗口）`);

  // ⑥ 梯队断档
  if (ladderBroken) blockers.push("梯队存在致命断档（首板→二板断层），持续性存疑");
  else reasons.push(`梯队健康（涨停${ztCount}只·${height}板）`);

  // 闸门低档（low/cautious 且熔断）→ 降级观望
  if (gateMode === "low") {
    blockers.push("闸门处于低档（极端情绪），建议观望");
  }

  const pass = blockers.length === 0;
  // 置信度：强度分 × 0.7 + 涨停/高度加成，上限 95
  const confidence = Math.min(95, Math.round(score * 0.7 + Math.min(20, ztCount * 2) + Math.min(15, height * 3)));

  return {
    pass,
    action: pass ? "可上车" : blockers.some(b => b.includes("禁止") || b.includes("退潮") || b.includes("诱多")) ? "禁止" : "观望",
    confidence,
    reasons,
    blockers,
  };
}
