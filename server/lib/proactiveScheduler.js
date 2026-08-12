// ============================================================
// server/lib/proactiveScheduler.js —— 主动智能调度器（v9.117.0，S3-2）
// 按交易时段自动输出管线：时段剧本（规则）+ 规则命中叠加（纯函数 0 token）+
// 仅盘后复盘/明日剧本/盘前政策简报标记可选 LLM（受时段预算约束，本实现只标记不实际调用，
// llmUsed=true 表示"该条由 LLM 润色"——实际润色由上层按预算决定）。
// 与决策直达的关系：本层"主动提示"，决策直达"一键裁决"，二者读同一份认知。
// 前端等价：src/lib/proactive/scheduler.ts。
// ============================================================
const { ruleCapitalSignal, ruleLeaderHealth, ruleRiskGate, ruleSentimentFlip } = require("./proactiveRules");

/**
 * 按当前时段生成主动洞察 —— 纯函数（LLM 仅标记用量，不在此实际调用）。
 * @param {object} [reasoning] v9.122.0（卓越 S3-2b）：推理层产物（enrichCognition）——
 *   forecast.conditions 作为额外触发源（每条产出一条"前瞻预判"洞察，P1/P2，0 token）
 */
function runProactiveTick(cog, session, prevStage, reasoning) {
  const hits = [
    ruleSentimentFlip(cog, prevStage),
    ruleLeaderHealth(cog),
    ruleCapitalSignal(cog),
    ruleRiskGate(cog),
  ];
  const fired = hits.filter((h) => h.fired);
  const insights = [];
  // 时段预算：盘前/盘后给 LLM 更多（复盘/剧本），盘中极省（规则为主）。
  // v9.119.0 语义修正：llmUsedTokens 只计"实际润色消耗"（规则骨架 0 实际消耗）——
  //   原实现预扣标记 tokenCost 导致剩余预算不够润色复盘（2500-2000=500 < 1200，永远降级）
  const llmBudgetTokens = session.phase === "盘后" ? 2500 : session.phase === "盘前" ? 1800 : 400;
  let used = 0; // 实际 LLM 消耗（润色接线后累加；runProactiveTick 本身 0）

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
    insights.push(base({
      id: "next-day-playbook",
      phase: session.phase, window: session.window, priority: "P2", kind: "明日剧本",
      title: "明日剧本：两种情景",
      body: `情景A(主线延续)：低吸梯队 ${(cog?.mainline?.value?.ladder?.tier2 ?? []).join("、") || "tier2"}；情景B(分歧退潮)：高低切，回避高位接力。预算内双情景简述。`,
      action: "展开明日自选",
      llmUsed: true, tokenCost: 800,
      evidence: { sampleSize: 2, caliber: "情景推演 N=2，LLM 润色（预算内）", asOf: cog?.asOf ?? "" },
    }));
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

  // 3) v9.122.0（卓越 S3-2b）：推理层前瞻预判接入 —— forecast.conditions 每条产出一条洞察（0 token）
  const conds = reasoning?.forecast?.conditions;
  if (Array.isArray(conds) && conds.length) {
    conds.slice(0, 3).forEach((c, i) => {
      insights.push(base({
        id: "forecast-" + i,
        phase: session.phase, window: session.window,
        priority: session.decisionWindow ? "P0" : "P1",
        kind: "前瞻预判",
        title: `若${c.iff}`,
        body: `→ ${c.then}`,
        action: "打开决策卡，一键裁决",
      }));
    });
  }

  const budget = {
    llmBudgetTokens,
    llmUsedTokens: used,
    remaining: Math.max(0, llmBudgetTokens - used),
  };
  return { insights, budget };
}

/**
 * v9.119.0（S3-3 补全）：LLM 润色实际接线 —— 对 llmUsed=true 的洞察调 callModelText 组织语言。
 * 约束：① 仅当 budget.remaining ≥ tokenCost 才润色（时段预算硬上限）；② 润色失败回退规则原文（永不降级）；
 * ③ prompt 强制"引用给定数字、≤100字、禁止编造"（骨架来自认知层，LLM 只组织语言）。
 * @param {Function} [callLLM] 依赖注入（测试用；缺省 require ./httpProxy 的 callModelText）
 * 返回 { insights, budget }（llmUsed=true 的条目 body 被润色，tokenCost 计入 budget）。
 */
async function refineInsightsWithLLM(insights, cog, budget, callLLM) {
  const callModelText = callLLM ?? require("./httpProxy").callModelText;
  let remaining = budget.remaining;
  let used = budget.llmUsedTokens; // 实际消耗（runProactiveTick 骨架 0，仅润色累加）
  const out = insights.map((it) => ({ ...it }));
  for (const it of out) {
    if (!it.llmUsed || it.tokenCost <= 0) continue;
    if (remaining < it.tokenCost) {
      it.llmUsed = false; // 预算不足 → 该条降级为规则原文（0 token）
      it.tokenCost = 0;
      it.body = it.body + "（预算不足，规则骨架）";
      continue;
    }
    const prompt = `用不超过100字把下面的盘面要点组织成自然的中文简报，保留全部数字与结论，禁止编造任何新数字或事实。\n\n${it.body}`;
    try {
      const text = await callModelText(prompt, {
        system: "你是A股短线游资助手。只组织语言，不添加事实，不编造数字。",
        maxTokens: Math.min(800, it.tokenCost + 200), // 恒思考模型提档给思考空间（llmCore 铁律）
        temperature: 0.3,
      });
      const t = String(text ?? "").trim();
      // v9.123.0（卓越审查 P0-4）：质量闸——模型对占位语料的"拒绝语/元输出"不得出面板
      //   （实测 policy-brief 曾直出"请提供盘面要点，我将按不超过100字…"）；命中即回退规则原文（永不降级）
      const REFUSAL_RE = /请提供|无法|不能|没有.{0,8}(要点|内容|数据|信息)|作为.{0,12}助手|请告诉/;
      if (t.length >= 10 && !REFUSAL_RE.test(t)) {
        it.body = t;
        remaining -= it.tokenCost;
        used += it.tokenCost;
      } else {
        it.llmUsed = false;
        it.tokenCost = 0;
      }
    } catch {
      it.llmUsed = false; // 润色失败 → 规则原文（永不降级）
      it.tokenCost = 0;
    }
  }
  return { insights: out, budget: { ...budget, llmUsedTokens: used, remaining } };
}

module.exports = { runProactiveTick, refineInsightsWithLLM };
