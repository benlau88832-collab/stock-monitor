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
  // v9.123.0（卓越审查 P1-4）：数据缺失（溢价未就绪/涨停池空）不判定——
  //   此前 relayOk=false 被当作"接力转弱"误报 P0 告警（盘前 premium=null 必触发）
  const missing = l.relayData === "missing" || ((l.height ?? 0) === 0 && (l.name === "—" || !l.name));
  const fired = !missing && (!l.relayOk || (l.height ?? 0) >= 5);
  return {
    rule: "龙头接力健康度",
    fired,
    severity: missing ? "info" : !l.relayOk ? "alert" : (l.height ?? 0) >= 5 ? "warn" : "info",
    detail: missing ? "龙头数据缺失（涨停池/昨日溢价未就绪），不判定"
      : `${l.name ?? "—"} ${l.height ?? 0}板，接力${l.relayOk ? "健康" : "转弱（警惕断板）"}`,
  };
}

/** 资金面信号（吸筹/出货） */
function ruleCapitalSignal(cog) {
  const c = cog?.capital?.value ?? {};
  // v9.123.0（卓越审查 P0-3）：信号词表扩展——明暗盘数据缺失时 buildCapital 诚实输出"流入/流出"
  //   （此前适配层 darkLightGap 恒 0 → signal 恒"中性" → 本规则永久哑火）
  const fired = ["出货", "吸筹", "流出"].includes(c.signal);
  return {
    rule: "主力资金信号",
    fired,
    severity: c.signal === "出货" || c.signal === "流出" ? "alert" : "info",
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
