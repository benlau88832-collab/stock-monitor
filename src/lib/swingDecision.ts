// ============================================================
// v9.138.0（波段重构·阶段一）：波段决策核 —— 波段五支柱（趋势位置/买点/止损/止盈/逻辑）
// 定位：替代"超短五支柱"的波段口径决策。波段客（3天-1个月）问的不是"今天能不能打板"，
//   而是"这波趋势现在处于哪个位置、该不该上车、拿多久、破位线在哪"。
// 纯函数：无 I/O，可单测；输入 = 波段位置模型结果 + 资金/催化数据 + 用户偏好
// ============================================================
import type { SwingStageResult } from "./swingStage";
import type { SwingBoardScore } from "./swingMainline";

export type SwingVerdict = "波段买入" | "持有" | "减仓" | "观望" | "回避";

export interface SwingDecisionInput {
  /** 个股波段位置（swingStage.analyzeSwing 输出） */
  stage: SwingStageResult;
  /** 所属板块波段评分（swingMainline.scoreBoard 输出；无则 null） */
  board?: SwingBoardScore | null;
  /** 持仓状态（未持仓则不适用"持有/减仓"） */
  holding?: boolean;
  /** 持仓成本（有则算盈亏/破位距离） */
  cost?: number | null;
  /** 买入逻辑是否已证伪（logicLedger 输入） */
  thesisFalsified?: boolean;
  /** 催化是否临近兑现 */
  catalystDue?: boolean;
}

export interface SwingDecisionResult {
  verdict: SwingVerdict;
  score: number;            // 0-100
  /** 波段买点类型（买入时） */
  buyPoint: string | null;
  /** 止损参考（买入时：破位线下方 3-5%） */
  stopLossPct: number;
  /** 止盈参考（波段目标：+15% 或 +25% 视阶段） */
  targetPct: number;
  /** 建议仓位区间 [min%, max%] */
  positionRange: [number, number];
  /** 理由清单 */
  reasons: string[];
  blocks: string[];
  /** 综合信号（UI 一行展示） */
  signal: string;
}

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

/**
 * 波段决策核心（纯函数）
 * 规则：
 *  - 回避：板块退潮 或 个股退潮 或 逻辑证伪
 *  - 波段买入：启动阶段（平台突破/放量首板/首板低吸买点）+ 板块趋势健康 + 未证伪
 *  - 持有：主升阶段 + 持仓中 + 未破位
 *  - 减仓：加速阶段（赶顶风险）或 板块转弱
 *  - 观望：底部整理（等启动）或 主升但未持仓（等回踩）
 */
export function swingDecision(input: SwingDecisionInput): SwingDecisionResult {
  const { stage, board, holding = false, cost = null, thesisFalsified = false, catalystDue = false } = input;
  const reasons: string[] = [];
  const blocks: string[] = [];
  const phase = stage.phase;

  // ---- 硬否决 ----
  if (thesisFalsified) {
    return {
      verdict: "回避", score: 10, buyPoint: null, stopLossPct: 5, targetPct: 10,
      positionRange: [0, 0], reasons: [], blocks: ["买入逻辑已证伪——按纪律离场"], signal: "🚫 逻辑证伪，回避",
    };
  }
  if (phase === "退潮") {
    return {
      verdict: "回避", score: 15, buyPoint: null, stopLossPct: 5, targetPct: 10,
      positionRange: [0, 0], reasons: [], blocks: ["个股处于退潮（跌破 MA20 且 MA5<MA20）"], signal: "🚫 退潮，回避",
    };
  }
  if (board && board.phase === "退潮") {
    return {
      verdict: "回避", score: 20, buyPoint: null, stopLossPct: 5, targetPct: 10,
      positionRange: [0, 0], reasons: [], blocks: [`所属板块「${board.name}」退潮`], signal: "🚫 板块退潮，回避",
    };
  }

  // ---- 评分 ----
  let score = 50;
  const stopLossPct = phase === "加速" ? 5 : phase === "主升" ? 6 : 7;
  const targetPct = phase === "主升" ? 25 : 15;

  // 阶段分
  const phaseScore: Record<string, number> = { 启动: 85, 主升: 75, 加速: 50, 底部整理: 45, 退潮: 15, 数据不足: 30 };
  score += (phaseScore[phase] ?? 30) - 50;

  // 买点分（启动阶段有明确买点类型 → 加分）
  let buyPoint = stage.buyPoint;
  if (phase === "启动" && buyPoint) {
    score += 10;
    reasons.push(`波段买点：${buyPoint}`);
  } else if (phase === "主升" && buyPoint) {
    reasons.push(`主升回踩买点：${buyPoint}`);
  }

  // 板块健康分
  if (board) {
    if (board.total >= 70) { score += 8; reasons.push(`板块「${board.name}」波段评分 ${board.total}（趋势+资金+催化）`); }
    else if (board.total >= 55) { score += 3; reasons.push(`板块「${board.name}」评分 ${board.total}`); }
    else { score -= 8; blocks.push(`板块「${board.name}」评分偏低（${board.total}）`); }
  }

  // 持仓视角
  if (holding && cost != null && cost > 0 && stage.ma10 != null) {
    const pnl = stage.ma10 != null && cost > 0 ? (stage.ma10 / cost - 1) * 100 : null;
    if (phase === "主升") { score += 5; reasons.push("主升趋势中，持有"); }
    if (phase === "加速") {
      score -= 10;
      reasons.push("加速赶顶（偏离 MA20 过大）——考虑分批止盈");
      buyPoint = null;
    }
    if (pnl != null && pnl < -5) { score -= 10; blocks.push(`持仓浮亏 ${pnl.toFixed(1)}%（跌破成本 5%）`); }
  }

  // 催化临近 → 持有加分（等验证）
  if (catalystDue && holding) { score += 3; reasons.push("催化验证临近——持有等兑现"); }

  score = clamp(score);

  // ---- 裁决 ----
  let verdict: SwingVerdict;
  if (holding) {
    if (phase === "加速") verdict = "减仓";
    else if (phase === "主升" || phase === "启动") verdict = "持有";
    else if (phase === "底部整理") verdict = "持有"; // 未破位继续持有
    else verdict = "观望";
  } else {
    if (phase === "启动" && buyPoint && score >= 60) verdict = "波段买入";
    else if (phase === "主升" && buyPoint) verdict = "波段买入";
    else if (phase === "底部整理") verdict = "观望";
    else if (phase === "主升") verdict = "观望";
    else verdict = "回避";
  }

  const positionRange: [number, number] = verdict === "波段买入"
    ? (board && board.total >= 70 ? [20, 30] : [10, 20])
    : verdict === "持有" ? [0, 0]
    : [0, 0];

  if (verdict === "波段买入") {
    reasons.push(`止损参考 ${stopLossPct}% · 止盈参考 +${targetPct}%`);
  }
  if (verdict === "观望" && phase === "底部整理") reasons.push("底部整理——等平台突破/放量首板信号");
  if (verdict === "观望" && phase === "主升") reasons.push("主升中未持仓——等回踩 MA10 再介入");

  const signalMap: Record<SwingVerdict, string> = {
    "波段买入": "🟢 波段买入", "持有": "🟡 持有", "减仓": "🟠 减仓", "观望": "⚪ 观望", "回避": "🔴 回避",
  };
  return {
    verdict, score, buyPoint, stopLossPct, targetPct, positionRange, reasons, blocks,
    signal: `${signalMap[verdict]}（${score} 分）`,
  };
}
