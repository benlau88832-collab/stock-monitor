// ============================================================
// server/lib/proactiveScheduler.js —— 主动智能调度器（v9.117.0，S3-2）
// 按交易时段自动输出管线：时段剧本（规则）+ 规则命中叠加（纯函数 0 token）+
// 仅盘后复盘/明日剧本/盘前政策简报标记可选 LLM（受时段预算约束，本实现只标记不实际调用，
// llmUsed=true 表示"该条由 LLM 润色"——实际润色由上层按预算决定）。
// 与决策直达的关系：本层"主动提示"，决策直达"一键裁决"，二者读同一份认知。
// 前端等价：src/lib/proactive/scheduler.ts。
// ============================================================
const { ruleCapitalSignal, ruleLeaderHealth, ruleRiskGate, ruleSentimentFlip } = require("./proactiveRules");

/** 按当前时段生成主动洞察 —— 纯函数（LLM 仅标记用量，不在此实际调用） */
function runProactiveTick(cog, session, prevStage) {
  const hits = [
    ruleSentimentFlip(cog, prevStage),
    ruleLeaderHealth(cog),
    ruleCapitalSignal(cog),
    ruleRiskGate(cog),
  ];
  const fired = hits.filter((h) => h.fired);
  const insights = [];
  // 时段预算：盘前/盘后给 LLM 更多（复盘/剧本），盘中极省（规则为主）
  const llmBudgetTokens = session.phase === "盘后" ? 2500 : session.phase === "盘前" ? 1800 : 400;
  let used = 0;

  const base = (over) => ({
    llmUsed: false,
    tokenCost: 0,
    evidence: { sampleSize: cog?.sentiment?.provenance?.sampleSize ?? 0, caliber: "认知层 v" + (cog?.version ?? "?") + "，规则骨架", asOf: cog?.asOf ?? "" },
    ...over,
  });

  // 1) 时段剧本（主动输出骨架，多数纯规则）
  if (session.phase === "盘前") {
    insights.push(base({
      id: "pre-market-brief",
      phase: session.phase, window: session.window, priority: "P1", kind: "盘前简报",
      title: "盘前准备：隔夜映射 + 政策简报",
      body: `主线候选：${cog?.mainline?.value?.primaryTheme ?? "数据不足"}（强度${cog?.mainline?.value?.strength ?? "?"}）。闸门${cog?.risk?.value?.gateOpen ? "放开" : "关闭"}，风险${cog?.risk?.value?.level ?? "?"}。关注外围与政策催化，核对自选股。`,
      action: "进入「盘前准备」分区核对自选",
    }));
    used += 600;
    insights.push(base({
      id: "policy-brief",
      phase: session.phase, window: session.window, priority: "P2", kind: "盘前简报",
      title: "政策简报（LLM 润色，受预算约束）",
      body: "政策语料由规则汇总，LLM 润色受预算约束（600 tok 上限）。",
      action: "点击展开完整简报",
      llmUsed: true, tokenCost: 600,
      evidence: { sampleSize: 3, caliber: "政策语料库 N=3 条，LLM 摘要（预算内）", asOf: cog?.asOf ?? "" },
    }));
  }

  if (session.decisionWindow) {
    insights.push(base({
      id: "decision-window",
      phase: session.phase, window: session.window, priority: "P0", kind: "决策提示",
      title: `★决策窗口 ${session.window}：主线龙头一键裁决`,
      body: `闸门${cog?.risk?.value?.gateOpen ? "放开" : "关闭"}，龙头 ${cog?.leader?.value?.name ?? "—"}(${cog?.leader?.value?.height ?? 0}板)。决策直达已就绪——不依赖 LLM，秒级出裁决。`,
      action: `打开决策卡，裁决 ${cog?.leader?.value?.code ?? ""}`,
    }));
  }

  if (session.phase === "早盘" || session.phase === "盘中" || session.phase === "午后") {
    insights.push(base({
      id: "intraday-pulse",
      phase: session.phase, window: session.window, priority: "P1", kind: "异动解读",
      title: "盘中脉搏：情绪/资金/龙头",
      body: `情绪${cog?.sentiment?.value?.stage ?? "?"}(温度${cog?.sentiment?.value?.score ?? "?"})，主力${cog?.capital?.value?.signal ?? "?"}(${cog?.capital?.value?.netFlow ?? 0}亿)。异动以规则判定，未烧 token。`,
      action: "查看资金面分区",
    }));
  }

  if (session.phase === "尾盘") {
    insights.push(base({
      id: "close-discipline",
      phase: session.phase, window: session.window, priority: "P0", kind: "纪律提醒",
      title: "尾盘纪律：14:30 后减仓/锁定",
      body: `阶段${cog?.sentiment?.value?.stage ?? "?"}。短线原则：高位跟风 14:30 前减仓，锁定利润；仅在闸门放开且主线持续时抢筹核心。`,
      action: "执行一键减仓体检",
    }));
  }

  if (session.phase === "盘后") {
    insights.push(base({
      id: "eod-review",
      phase: session.phase, window: session.window, priority: "P1", kind: "盘后复盘",
      title: "盘后复盘（LLM，受预算约束）",
      body: `今日主线${cog?.mainline?.value?.primaryTheme ?? "?"}延续，龙头${cog?.leader?.value?.name ?? "—"}${cog?.leader?.value?.height ?? 0}板。复盘由规则提供骨架，LLM 组织语言，token 受控。`,
      action: "导出复盘",
      llmUsed: true, tokenCost: 1200,
      evidence: { sampleSize: cog?.sentiment?.provenance?.sampleSize ?? 0, caliber: "LLM 复盘，骨架来自认知层（预算内）", asOf: cog?.asOf ?? "" },
    }));
    used += 1200;
    insights.push(base({
      id: "next-day-playbook",
      phase: session.phase, window: session.window, priority: "P2", kind: "明日剧本",
      title: "明日剧本：两种情景",
      body: `情景A(主线延续)：低吸梯队 tier2；情景B(分歧退潮)：高低切，回避高位接力。预算内双情景简述。`,
      action: "展开明日自选",
      llmUsed: true, tokenCost: 800,
      evidence: { sampleSize: 2, caliber: "情景推演 N=2，LLM 润色（预算内）", asOf: cog?.asOf ?? "" },
    }));
    used += 800;
  }

  // 2) 规则命中叠加（全纯，token=0）
  for (const h of fired) {
    insights.push(base({
      id: "rule-" + h.rule,
      phase: session.phase, window: session.window,
      priority: h.severity === "alert" ? "P0" : h.severity === "warn" ? "P1" : "P2",
      kind: h.severity === "alert" ? "风险告警" : "异动解读",
      title: h.rule + "：" + h.detail,
      body: `规则命中(severity=${h.severity})，纯函数判定，0 token。`,
    }));
  }

  const budget = {
    llmBudgetTokens,
    llmUsedTokens: used,
    remaining: Math.max(0, llmBudgetTokens - used),
  };
  return { insights, budget };
}

module.exports = { runProactiveTick };
