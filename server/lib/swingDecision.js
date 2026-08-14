// ============================================================
// v9.144.0 swing decision kernel (server CJS port of src/lib/swingDecision.ts)
// Used by POST /api/decisions/swing when LLM is unavailable.
// ============================================================
const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

function swingDecision(input) {
  const { stage, board = null, holding = false, cost = null, thesisFalsified = false, catalystDue = false } = input;
  const reasons = [];
  const blocks = [];
  const phase = stage.phase;

  if (thesisFalsified) {
    return { verdict: "回避", score: 10, buyPoint: null, stopLossPct: 5, targetPct: 10, positionRange: [0, 0], reasons, blocks: ["买入逻辑已证伪——按纪律离场"], signal: "逻辑证伪，回避" };
  }
  if (phase === "退潮") {
    return { verdict: "回避", score: 15, buyPoint: null, stopLossPct: 5, targetPct: 10, positionRange: [0, 0], reasons, blocks: ["个股处于退潮（跌破 MA20 且 MA5<MA20）"], signal: "退潮，回避" };
  }
  if (board && board.phase === "退潮") {
    return { verdict: "回避", score: 20, buyPoint: null, stopLossPct: 5, targetPct: 10, positionRange: [0, 0], reasons, blocks: [`所属板块「${board.name}」退潮`], signal: "板块退潮，回避" };
  }

  let score = 50;
  const stopLossPct = phase === "加速" ? 5 : phase === "主升" ? 6 : 7;
  const targetPct = phase === "主升" ? 25 : 15;
  const phaseScore = { 启动: 85, 主升: 75, 加速: 50, 底部整理: 45, 退潮: 15, 数据不足: 30 };
  score += (phaseScore[phase] ?? 30) - 50;

  let buyPoint = stage.buyPoint;
  if (phase === "启动" && buyPoint) {
    score += 10;
    reasons.push(`波段买点：${buyPoint}`);
  } else if (phase === "主升" && buyPoint) {
    reasons.push(`主升回踩买点：${buyPoint}`);
  }

  if (board) {
    if (board.total >= 70) { score += 8; reasons.push(`板块「${board.name}」波段评分 ${board.total}（趋势+资金+催化）`); }
    else if (board.total >= 55) { score += 3; reasons.push(`板块「${board.name}」评分 ${board.total}`); }
    else { score -= 8; blocks.push(`板块「${board.name}」评分偏低（${board.total}）`); }
  }

  if (holding && cost != null && cost > 0 && stage.ma10 != null) {
    const pnl = (stage.ma10 / cost - 1) * 100;
    if (phase === "主升") { score += 5; reasons.push("主升趋势中，持有"); }
    if (phase === "加速") {
      score -= 10;
      reasons.push("加速赶顶（偏离 MA20 过大）——考虑分批止盈");
      buyPoint = null;
    }
    if (pnl < -5) { score -= 10; blocks.push(`持仓浮亏 ${pnl.toFixed(1)}%（跌破成本 5%）`); }
  }

  if (catalystDue && holding) { score += 3; reasons.push("催化验证临近——持有等兑现"); }
  score = clamp(score);

  let verdict;
  if (holding) {
    if (phase === "加速") verdict = "减仓";
    else if (phase === "主升" || phase === "启动") verdict = "持有";
    else if (phase === "底部整理") verdict = "持有";
    else verdict = "观望";
  } else {
    if (phase === "启动" && buyPoint && score >= 60) verdict = "波段买入";
    else if (phase === "主升" && buyPoint) verdict = "波段买入";
    else if (phase === "底部整理") verdict = "观望";
    else if (phase === "主升") verdict = "观望";
    else verdict = "回避";
  }

  const positionRange = verdict === "波段买入"
    ? (board && board.total >= 70 ? [20, 30] : [10, 20])
    : [0, 0];

  if (verdict === "波段买入") reasons.push(`止损参考 ${stopLossPct}% · 止盈参考 +${targetPct}%`);
  if (verdict === "观望" && phase === "底部整理") reasons.push("底部整理——等平台突破/放量首板信号");
  if (verdict === "观望" && phase === "主升") reasons.push("主升中未持仓——等回踩 MA10 再介入");

  const signalMap = { 波段买入: "波段买入", 持有: "持有", 减仓: "减仓", 观望: "观望", 回避: "回避" };
  return { verdict, score, buyPoint, stopLossPct, targetPct, positionRange, reasons, blocks, signal: `${signalMap[verdict]}（${score} 分）` };
}

module.exports = { swingDecision };
