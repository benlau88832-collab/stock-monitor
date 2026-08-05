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
  evidence: string[];      // 工具收集的投票证据（结论级）
  rawEvidence?: Array<{ name: string; data: unknown }>; // v9.40（V4-A）：原始盘面（数据类工具结果，LLM 独立信息源）
  critic: string | null;   // Critic 意见
  degraded: boolean;       // true = 规则兜底（LLM 不可用）
  selfConsistency?: number; // 自洽投票一致性 0-100（开启时）
}

/** 从规则工具收集证据（0 次 LLM）—— v9.40（V4-F）：用工具自带 normalize 归一为统一 schema，消除脆弱映射 */
export async function collectToolEvidence(ctx: ToolContext): Promise<{ votes: EvidenceSource[]; raw: Array<{ name: string; data: unknown }> }> {
  const tools = getAgentTools();
  const votes: EvidenceSource[] = [];
  const raw: Array<{ name: string; data: unknown }> = [];
  for (const t of tools) {
    try {
      const r = await t.execute(ctx as never);
      if (r == null) continue;
      // 数据类工具：原始结果进 rawEvidence（LLM 的独立信息源，V4-A）
      if (t.kind === "data") {
        raw.push({ name: t.name, data: r });
        continue;
      }
      // 投票类工具：用 normalize 归一（工具自身负责映射）
      if (t.kind === "vote" && t.normalize) {
        const n = t.normalize(r);
        if (n) {
          votes.push({
            name: t.name,
            verdict: n.verdict,
            confidence: Math.min(95, Math.max(20, n.confidence)),
            weight: 0.8,
            reason: n.reason,
          });
        }
      }
    } catch { /* 单工具失败不影响整体 */ }
  }
  return { votes, raw };
}

/** 单次裁决（temperature 保留参数：自洽投票复用不同温度）—— v9.40（V4-A）：喂原始盘面，AI 有独立信息源可推翻规则 */
async function adjudicateOnce(ctx: ToolContext, votes: EvidenceSource[], raw: Array<{ name: string; data: unknown }>, _temperature: number): Promise<AgentVerdict> {
  const voteText = votes.map(e => `- ${e.name}: ${e.verdict}（置信${Math.round(e.confidence)}%）${e.reason}`).join("\n");
  const rawText = raw.map(r => {
    try { return `- ${r.name}: ${JSON.stringify(r.data).slice(0, 200)}`; }
    catch { return `- ${r.name}: (不可序列化)`; }
  }).join("\n");
  const mainline = ctx.mainline ?? "最强主线";
  const prompt = `你是10年经验的A股龙头战法操盘手。对主线"${mainline}"做独立裁决。

一、规则引擎投票（参考，不一定正确，可能有盲区）：
${voteText || "（无投票证据）"}

二、原始盘面数据（你的独立判断依据，可据此推翻规则结论）：
${rawText || "（无原始数据）"}

请独立分析：规则引擎哪里可能有盲区？原始数据支持还是反对"可上车"？
输出严格JSON对象（只返回JSON）：
{"action":"可上车|观望|禁止","confidence":0-100,"reason":"≤50字"}
action 取值说明：可上车=证据强一致且无风险；观望=证据混杂或缺数据；禁止=存在硬风险。`;

  const r = await callAI("dailyIntel", { prompt });
  try {
    const j = parseAIJSON<{ action: string; confidence: number; reason: string }>(r.text);
    return {
      action: j?.action === "可上车" || j?.action === "禁止" ? j.action : "观望",
      confidence: Math.max(10, Math.min(95, Number(j?.confidence) || 50)),
      reason: String(j?.reason ?? "").slice(0, 50),
      evidence: votes.map(e => `${e.name}: ${e.verdict}`),
      rawEvidence: raw,
      critic: null,
      degraded: false,
    };
  } catch {
    return { action: "观望", confidence: 50, reason: "LLM 输出解析失败，降级观望", evidence: [], rawEvidence: raw, critic: null, degraded: true };
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
  // ① 规则工具收集证据（0 次 LLM）—— 投票类归一 + 数据类原始盘面
  const { votes, raw } = await collectToolEvidence(ctx);
  if (votes.length === 0) {
    // ② 无投票证据 → 纯规则 decisionBus 兜底（不入 LLM）
    const fallback = runConsensus([{ name: "兜底", verdict: "观望", confidence: 50, weight: 1, reason: "无工具证据" }]);
    return {
      action: fallback.action,
      confidence: fallback.confidence,
      reason: "工具证据为空，规则兜底",
      evidence: [],
      rawEvidence: raw,
      critic: null,
      degraded: true,
    };
  }

  // ③ 自洽投票（可选）：多温度多数票
  if (opts?.selfConsistency) {
    const temps = [0.1, 0.4, 0.7];
    const votes3 = await Promise.all(temps.map(t => adjudicateOnce(ctx, votes, raw, t)));
    const tally: Record<string, number> = {};
    for (const v of votes3) tally[v.action] = (tally[v.action] ?? 0) + 1;
    const winner = (Object.entries(tally) as Array<[string, number]>).sort((a, b) => b[1] - a[1])[0][0];
    const consistency = Math.round((tally[winner] ?? 0) / votes3.length * 100);
    const base = votes3.find(v => v.action === winner) ?? votes3[0];
    let final: AgentVerdict = { ...base, selfConsistency: consistency };
    if (consistency < 66) final = { ...final, action: "观望", confidence: Math.min(final.confidence, 60), reason: `自洽投票仅${consistency}%一致，降级观望` };
    return opts.useCritic ? criticReview(final, ctx) : final;
  }

  // ④ 常规：单次裁决 + 可选 Critic
  const verdict = await adjudicateOnce(ctx, votes, raw, 0.3);
  if (verdict.degraded) {
    // LLM 失败 → 规则 decisionBus 兜底
    const fb = runConsensus(votes);
    return { ...verdict, action: fb.action, confidence: fb.confidence, reason: "LLM 不可用，规则投票兜底", evidence: votes.map(e => `${e.name}: ${e.verdict}`), rawEvidence: raw, degraded: true };
  }
  return opts?.useCritic ? criticReview(verdict, ctx) : verdict;
}

/** 便捷：直接给最强主线算裁决（Dashboard 用） */
export async function decideForMainline(
  top: { mainline: string; strengthScore?: number | null; stage?: string; ztCount?: number; height?: number; exitSignal?: boolean } | null,
  extra?: Partial<ToolContext>,
  opts?: { selfConsistency?: boolean; useCritic?: boolean },
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
  }, opts);
}
