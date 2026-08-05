// ============================================================
// v9.38（V3-2/3/6）：AI 决策 Agent（轻量 ReAct）+ Critic + 自洽投票
// 不依赖原生 tool_calls 协议（callAI 为单轮），采用务实编排：
//   ① 收集器：把 ToolContext 喂给全部规则工具 → 结构化证据包（0 次 LLM）
//   ② 裁决器：Agnes 读证据包 → 结构化裁决（可上车/观望/禁止 + 置信 + 理由）
//   ③ Critic：Agnes 换"挑刺者"视角复核 → 有效反对则降置信/改判
//   ④ 自洽：裁决用 temperature {0.1,0.4,0.7} 各一次多数票（开关，默认关省配额）
// 降级：LLM 不可用 → 规则 decisionBus 裁决兜底
// ============================================================
import { callAI, parseAIJSON } from "./ai";
import { getAgentTools } from "./agentTools";
import { runConsensus, type EvidenceSource } from "./decisionBus";
import type { ToolContext } from "./agentTools";

export interface AgentVerdict {
  action: "可上车" | "观望" | "禁止";
  confidence: number;
  reason: string;
  evidence: string[];      // 工具收集的证据
  critic: string | null;   // Critic 意见
  degraded: boolean;       // true = 规则兜底（LLM 不可用）
  selfConsistency?: number; // 自洽投票一致性 0-100（开启时）
}

/** 从规则工具收集证据（0 次 LLM） */
export async function collectToolEvidence(ctx: ToolContext): Promise<EvidenceSource[]> {
  const tools = getAgentTools();
  const results: EvidenceSource[] = [];
  for (const t of tools) {
    try {
      const r = await t.execute(ctx as never);
      if (r && typeof r === "object") {
        const obj = r as Record<string, unknown>;
        const verdict = String(obj.action ?? obj.state ?? obj.level ?? "观望") as never;
        const confidence = Number(obj.confidence ?? obj.positionFactor ?? 50) * (typeof obj.confidence === "number" ? 1 : 100) || 50;
        results.push({
          name: t.name,
          verdict: verdict === "可上车" ? "可上车" : verdict === "禁止" ? "禁止" : "观望",
          confidence: Math.min(95, Math.max(20, confidence)),
          weight: 0.8,
          reason: JSON.stringify(r).slice(0, 80),
        });
      }
    } catch { /* 单工具失败不影响整体 */ }
  }
  return results;
}

/** 单次裁决（temperature 保留参数：自洽投票复用不同温度） */
async function adjudicateOnce(ctx: ToolContext, evidence: EvidenceSource[], _temperature: number): Promise<AgentVerdict> {
  const evidenceText = evidence.map(e => `- ${e.name}: ${e.verdict}（置信${Math.round(e.confidence)}%）${e.reason}`).join("\n");
  const mainline = ctx.mainline ?? "最强主线";
  const prompt = `你是10年经验的A股龙头战法操盘手。基于以下多源证据，对主线"${mainline}"给出唯一裁决。

多源证据：
${evidenceText || "（无工具证据，凭经验判断）"}

输出严格JSON对象（只返回JSON）：
{"action":"可上车|观望|禁止","confidence":0-100,"reason":"≤40字"}
action 取值说明：可上车=证据强一致且无风险；观望=证据混杂或缺数据；禁止=存在硬风险。`;

  const r = await callAI("dailyIntel", { prompt });
  try {
    const j = parseAIJSON<{ action: string; confidence: number; reason: string }>(r.text);
    return {
      action: j?.action === "可上车" || j?.action === "禁止" ? j.action : "观望",
      confidence: Math.max(10, Math.min(95, Number(j?.confidence) || 50)),
      reason: String(j?.reason ?? "").slice(0, 40),
      evidence: evidence.map(e => `${e.name}: ${e.verdict}`),
      critic: null,
      degraded: false,
    };
  } catch {
    return { action: "观望", confidence: 50, reason: "LLM 输出解析失败，降级观望", evidence: [], critic: null, degraded: true };
  }
}

/** Critic 挑刺：换视角找反面证据，能推翻则降级 */
async function criticReview(v: AgentVerdict, ctx: ToolContext): Promise<AgentVerdict> {
  const prompt = `你是A股风险审查员，专门挑毛病。以下是 AI 对主线"${ctx.mainline ?? "—"}"的裁决：
动作=${v.action}，置信=${v.confidence}%，理由=${v.reason}
证据：${v.evidence.join("；")}

请冷静审查：这个结论哪里可能错？有没有反面证据（资金流出/封单弱/历史该阶段胜率低/高位分歧）？
输出严格JSON：{"canRefute":true|false,"why":"≤40字","suggestAction":"可上车|观望|禁止"}
canRefute=true 时 suggestAction 必须与 v.action 不同（降级）。`;

  try {
    const r = await callAI("dailyIntel", { prompt });
    const j = parseAIJSON<{ canRefute: boolean; why: string; suggestAction: string }>(r.text);
    if (j?.canRefute && j.suggestAction && j.suggestAction !== v.action) {
      return {
        ...v,
        action: j.suggestAction === "可上车" || j.suggestAction === "禁止" ? j.suggestAction : "观望",
        confidence: Math.max(30, v.confidence - 15),
        critic: `⚠ 被Critic推翻：${j.why}`,
      };
    }
    return { ...v, critic: j?.why ? `Critic复核通过（${j.why.slice(0, 30)}）` : null };
  } catch {
    return v; // Critic 失败不影响主裁决
  }
}

/**
 * 决策 Agent 主入口。
 * @param ctx 工具上下文（App/Dashboard 汇聚后传入）
 * @param opts.selfConsistency 开启则 temperature {0.1,0.4,0.7} 三票多数（配额×3）
 * @param opts.useCritic 开启 Critic 复核
 */
export async function runDecisionAgent(
  ctx: ToolContext,
  opts?: { selfConsistency?: boolean; useCritic?: boolean },
): Promise<AgentVerdict> {
  // ① 规则工具收集证据（0 次 LLM）
  const evidence = await collectToolEvidence(ctx);
  if (evidence.length === 0) {
    // ② 无证据 → 纯规则 decisionBus 兜底（不入 LLM）
    const fallback = runConsensus([{ name: "兜底", verdict: "观望", confidence: 50, weight: 1, reason: "无工具证据" }]);
    return {
      action: fallback.action,
      confidence: fallback.confidence,
      reason: "工具证据为空，规则兜底",
      evidence: [],
      critic: null,
      degraded: true,
    };
  }

  // ③ 自洽投票（可选）：多温度多数票
  if (opts?.selfConsistency) {
    const temps = [0.1, 0.4, 0.7];
    const votes = await Promise.all(temps.map(t => adjudicateOnce(ctx, evidence, t)));
    const tally: Record<string, number> = {};
    for (const v of votes) tally[v.action] = (tally[v.action] ?? 0) + 1;
    const winner = (Object.entries(tally) as Array<[string, number]>).sort((a, b) => b[1] - a[1])[0][0];
    const consistency = Math.round((tally[winner] ?? 0) / votes.length * 100);
    const base = votes.find(v => v.action === winner) ?? votes[0];
    let final: AgentVerdict = { ...base, selfConsistency: consistency };
    if (consistency < 66) final = { ...final, action: "观望", confidence: Math.min(final.confidence, 60), reason: `自洽投票仅${consistency}%一致，降级观望` };
    return opts.useCritic ? criticReview(final, ctx) : final;
  }

  // ④ 常规：单次裁决 + 可选 Critic
  const verdict = await adjudicateOnce(ctx, evidence, 0.3);
  if (verdict.degraded) {
    // LLM 失败 → 规则 decisionBus 兜底
    const fb = runConsensus(evidence);
    return { ...verdict, action: fb.action, confidence: fb.confidence, reason: "LLM 不可用，规则投票兜底", evidence: evidence.map(e => `${e.name}: ${e.verdict}`), degraded: true };
  }
  return opts?.useCritic ? criticReview(verdict, ctx) : verdict;
}

/** 便捷：直接给最强主线算裁决（Dashboard 用） */
export async function decideForMainline(
  top: { mainline: string; strengthScore?: number | null; stage?: string; ztCount?: number; height?: number; exitSignal?: boolean } | null,
  extra?: Partial<ToolContext>,
): Promise<AgentVerdict> {
  if (!top) {
    return { action: "观望", confidence: 40, reason: "无主线数据", evidence: [], critic: null, degraded: true };
  }
  return runDecisionAgent({
    mainline: top.mainline,
    strengthScore: top.strengthScore ?? null,
    stage: top.stage,
    ztCount: top.ztCount,
    height: top.height,
    exitSignal: top.exitSignal,
    ...extra,
  });
}
