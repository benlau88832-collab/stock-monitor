// ============================================================
// server/lib/proactiveRules.js —— 主动智能 · 规则谓词（v9.117.0，S3-2）
// 纯函数、0 token、规则先行过滤：先用规则判定"是否值得说"，再决定是否烧 LLM。
// 多数提示纯规则产出（token=0）；仅复盘/剧本/政策简报可选 LLM（受预算约束，见 scheduler）。
// ============================================================

/** 情绪周期翻转（启动→发酵 or 高潮→分歧） */
function ruleSentimentFlip(cog, prevStage) {
  const stage = cog?.sentiment?.value?.stage;
  const fired = !!prevStage && prevStage !== stage;
  return {
    rule: "情绪周期翻转",
    fired,
    severity: stage === "分歧" || stage === "退潮" ? "alert" : "info",
    detail: fired ? `情绪由 ${prevStage} → ${stage}` : `情绪稳定于 ${stage ?? "?"}`,
  };
}

/** 龙头高度突破 / 断板风险 */
function ruleLeaderHealth(cog) {
  const l = cog?.leader?.value ?? {};
  const fired = !l.relayOk || (l.height ?? 0) >= 5;
  return {
    rule: "龙头接力健康度",
    fired,
    severity: !l.relayOk ? "alert" : (l.height ?? 0) >= 5 ? "warn" : "info",
    detail: `${l.name ?? "—"} ${l.height ?? 0}板，接力${l.relayOk ? "健康" : "转弱（警惕断板）"}`,
  };
}

/** 资金面信号（吸筹/出货） */
function ruleCapitalSignal(cog) {
  const c = cog?.capital?.value ?? {};
  const fired = c.signal === "出货" || c.signal === "吸筹";
  return {
    rule: "主力资金信号",
    fired,
    severity: c.signal === "出货" ? "alert" : "info",
    detail: `暗-明 ${(c.darkVsLight ?? 0) > 0 ? "+" : ""}${c.darkVsLight ?? 0}，判定${c.signal ?? "?"}（净额${c.netFlow ?? 0}亿）`,
  };
}

/** 风险闸门 */
function ruleRiskGate(cog) {
  const r = cog?.risk?.value ?? {};
  const fired = !r.gateOpen || r.level === "高" || r.level === "极高";
  return {
    rule: "风险闸门",
    fired,
    severity: !r.gateOpen ? "alert" : r.level === "高" ? "warn" : "info",
    detail: r.gateOpen ? `闸门放开，风险${r.level ?? "?"}` : `闸门关闭(${(r.traps ?? []).join("/") || "无"})`,
  };
}

module.exports = { ruleSentimentFlip, ruleLeaderHealth, ruleCapitalSignal, ruleRiskGate, ALL_RULES: [ruleSentimentFlip, ruleLeaderHealth, ruleCapitalSignal, ruleRiskGate] };
