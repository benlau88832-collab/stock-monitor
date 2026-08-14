// ============================================================
// v9.143.0 feedback penalty: user inaccurate feedback -> hard score deduction
// Used by /api/decisions and /api/decisions/swing.
// ============================================================
async function loadFeedbackPenalty(pool, code) {
  try {
    const r = await pool.query(
      `SELECT attribution, count(*)::int AS cnt FROM decision_feedback
       WHERE code=$1 AND feedback='inaccurate' GROUP BY attribution`,
      [String(code)],
    );
    const total = r.rows.reduce((s, x) => s + x.cnt, 0);
    const byAttribution = Object.fromEntries(r.rows.map((x) => [x.attribution ?? "unknown", x.cnt]));
    return { total, byAttribution };
  } catch {
    return { total: 0, byAttribution: {} };
  }
}

function applyDecisionPenalty(decision, penalty) {
  if (!decision || penalty.total <= 0) return { decision, penalty: { total: 0, byAttribution: {} } };
  const deduction = Math.min(15, penalty.total * 3);
  const scaled = Math.max(0, 1 - Math.min(0.3, penalty.total * 0.1));
  const next = { ...decision };
  if (typeof next.score === "number") next.score = Math.max(0, Math.round(next.score - deduction));
  if (typeof next.suggestedPositionPct === "number") next.suggestedPositionPct = Math.max(0, Math.round(next.suggestedPositionPct * scaled));
  if (Array.isArray(next.positionRange)) {
    next.positionRange = [Math.round((next.positionRange[0] ?? 0) * scaled), Math.round((next.positionRange[1] ?? 0) * scaled)];
  }
  next.reasons = [...(next.reasons ?? []), `用户曾指出同类判断不准确（${penalty.total} 次），最终分/仓位已硬扣`];
  next.blocks = [...(next.blocks ?? []), `反馈惩罚 -${deduction} 分`];
  return { decision: next, penalty: { total: penalty.total, byAttribution: penalty.byAttribution } };
}

module.exports = { loadFeedbackPenalty, applyDecisionPenalty };
