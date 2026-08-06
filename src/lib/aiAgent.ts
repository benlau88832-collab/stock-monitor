// ============================================================
// v9.38（V3-2/3/6）：AI 决策 Agent（轻量 ReAct）+ Critic + 自洽投票
// 不依赖原生 tool_calls 协议（callAI 为单轮），采用务实编排：
//   ① 收集器：把 ToolContext 喂给全部规则工具 → 结构化证据包（0 次 LLM）
//   ② 裁决器：Agnes 读证据包 → 结构化裁决（可上车/观望/禁止 + 置信 + 理由）
//   ③ Critic：Agnes 换"挑刺者"视角复核 → 有效反对则降置信/改判
//   ④ 自洽：裁决用 temperature {0.1,0.4,0.7} 各一次多数票（开关，默认关省配额）
// 降级：LLM 不可用 → 规则 decisionBus 裁决兜底
// v9.43：因子健康度三层闭环 —— ①预注入（LLM 必见）②factorHealth 工具（可深查）
//         ③finalize 强制扣置信（≥50%→-15 / ≥30%→-8，与 decisionBus 同规则，AI 跑不掉门控）
// ============================================================
import { callAI, parseAIJSON, callAgentChat, type AgentChatResult } from "./ai";
import { getAgentTools, getStockAgentTools, evaluateFactorHealth, type FactorHealthReport } from "./agentTools";
// v9.58（V8-9）：AI 结论全站联动 store
import { setStockAI } from "./aiConclusionStore";
import { runConsensus, type EvidenceSource } from "./decisionBus";
import type { ToolContext } from "./agentTools";

export interface AgentVerdict {
  action: "可上车" | "观望" | "禁止";
  confidence: number;
  reason: string;
  evidence: string[];      // 工具收集的投票证据（结论级）
  rawEvidence?: Array<{ name: string; data: unknown }>; // v9.40（V4-A）：原始盘面（数据类工具结果，LLM 独立信息源）
  critic: string | null;   // Critic 意见
  degraded: boolean;       // true = 规则兜底（LLM 不可用 / 轮次耗尽 / 配额受限）
  selfConsistency?: number; // 自洽投票一致性 0-100（开启时）
  // v9.45（V5-2）：Agent 路径埋点 —— 验证 flash 真在用原生 tool_calls
  path?: "native_toolcall" | "manual_json" | "rule_fallback";
  rounds?: number;          // 实际 LLM 轮数
  toolsCalled?: string[];   // 本轮实际调用的工具（去重）
  /** v9.45（V5-1）：true = 服务端配额受限（429）导致的降级，非模型不可用 */
  rateLimited?: boolean;
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

/** v9.41（V4-D）：自洽投票 —— final 后换 temperature 再问 2 次纯裁决（无工具，轻量），多数票为准 */
async function selfConsistencyCheck(prev: AgentVerdict): Promise<AgentVerdict> {
  const temps = [0.4, 0.7];
  const extras = await Promise.all(temps.map(async t => {
    const r = await callAgentChat(
      "你是A股龙头战法操盘手。只输出JSON。",
      `对以下裁决独立复核一次（换温度重新判断，可改判）：\n动作=${prev.action} 置信=${prev.confidence}% 理由=${prev.reason}\n调研记录：${(prev.evidence ?? []).join("；").slice(0, 500)}\n\n输出：{"final":{"action":"可上车|观望|禁止","confidence":0-100,"reason":"≤40字"}}`,
      [],
      { temperature: t, maxTokens: 600 },
    );
    if (!r) return null;
    const j = parseAIJSON<{ final?: { action: string; confidence: number; reason: string } }>(r.text);
    return j?.final?.action ?? null;
  }));
  const tally: Record<string, number> = { [prev.action]: 1 };
  for (const a of extras) if (a) tally[a] = (tally[a] ?? 0) + 1;
  const winner = (Object.entries(tally) as Array<[string, number]>).sort((a, b) => b[1] - a[1])[0][0];
  const consistency = Math.round((tally[winner] ?? 0) / (extras.filter(Boolean).length + 1) * 100);
  const out: AgentVerdict = { ...prev, selfConsistency: consistency };
  if (consistency < 66) {
    return { ...out, action: "观望", confidence: Math.min(out.confidence, 60), reason: `自洽投票仅${consistency}%一致，降级观望` };
  }
  return out;
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
 * 决策 Agent 主入口 —— v9.41（V4-A）真·ReAct 多轮循环（LLM 自主决定调哪些工具、观察中间结果）。
 * @param ctx 工具上下文（App/Dashboard 汇聚后传入）
 * @param opts.selfConsistency 开启则 temperature {0.1,0.4,0.7} 三票多数（配额×3）
 * @param opts.useCritic 开启 Critic 复核
 */
export async function runDecisionAgent(
  ctx: ToolContext,
  opts?: { selfConsistency?: boolean; useCritic?: boolean },
): Promise<AgentVerdict> {
  const tools = getAgentTools();
  const mainline = ctx.mainline ?? "最强主线";

  // ---------- v9.43：因子健康度预评估（预注入层 —— 保证"因子失效"必然进入 AI 视野） ----------
  let fhReport: FactorHealthReport | null = null;
  try { fhReport = await evaluateFactorHealth(); } catch { /* 数据层不可用 → 静默 */ }
  const fhInject = fhReport && fhReport.total >= 3
    ? `【因子健康度（幻方监测）】${fhReport.summary}\n失效因子：${fhReport.items.filter(i => i.decayed).map(i => i.name).join("、") || "无"}${fhReport.reversedCount > 0 ? `；方向反转：${fhReport.items.filter(i => i.reversed && !i.decayed).map(i => i.name).join("、")}` : ""}\n规则：失效占比≥50%→最终置信-15、≥30%→-8（与规则门控一致，AI 结论同样适用）。`
    : null;

  // ---------- ① 真·ReAct：LLM 自主调工具（≤5 轮） ----------
  // 轮次预算 5（V3 工程要点 2）；任一工具强否决 → 早停直接"禁止"（V3 要点 4）
  const toolDefs = tools.map(t => ({
    name: t.name,
    description: t.description,
    // v9.41：Agnes 原生 tool_calls 要求 function.parameters（JSON Schema）；宽松 schema 允许任意参数
    parameters: { type: "object", properties: {}, additionalProperties: true },
  }));
  const system = `你是10年经验的A股龙头战法操盘手，正在用工具独立调研主线"${mainline}"是否可上车。

你有以下工具可调用（自主决定调用顺序与次数，最多 5 轮）：
${toolDefs.map(t => `- ${t.name}: ${t.description}`).join("\n")}

规则：
1. 第一轮先调用 1-3 个最关键的检查工具（如 checkSysRisk 先看系统性风险、getAdmissionVerdict 看准入、factorHealth 看因子健康度）。
2. 观察结果后再决定下一轮查什么（如"准入通过→查资金连续性/龙虎榜"）。
3. 一旦发现硬风险（系统性风险red/诱多/封单崩落）→ 立即停止，输出最终裁决 action="禁止"。
4. 每轮只输出严格JSON之一：
   调用工具：{"calls":[{"tool":"工具名","reason":"为什么查它"}]}
   最终裁决：{"final":{"action":"可上车|观望|禁止","confidence":0-100,"reason":"≤50字"}}
5. 最多 5 轮工具调用后必须出最终裁决。
6. 若用户消息中给了【因子健康度】且失效占比≥30%，你的最终置信度必须扣减（≥50%扣15、≥30%扣8），并在理由里说明。
7. 【硬约束·v9.57 V8-5】最终裁决的 reason 必须引用至少 2 个具体数值（如"封单1.2亿/成交3亿=40%、主力净流入8000万"），禁止"资金较强/封单坚决"等无数字空话；数字只能来自工具返回，不得编造。`;

  const toolByName = new Map(tools.map(t => [t.name, t]));
  let history: string[] = []; // 前几轮的工具调用与结果（回灌给 LLM）
  let agentTrace: string[] = [];
  let llmOk = true;
  // v9.45（V5-2）：Agent 路径埋点
  let agentPath: AgentVerdict["path"] = undefined; // 首个成功解析的协议（原生 tool_calls / 手动 JSON）
  let llmRounds = 0;          // 成功执行的 LLM 轮数
  let rateLimitedFlag = false;
  const calledTools = new Set<string>();

  // v9.41（V4-D）：final 后统一过 自洽投票（可选）+ Critic 挑刺（默认开）
  // v9.43：+ 因子健康度强制门控（AI 结论同样适用 decisionBus 的失效因子扣分规则）
  const finalize = async (action: "可上车" | "观望" | "禁止", confidence: number, reason: string): Promise<AgentVerdict> => {
    let v: AgentVerdict = {
      action, confidence, reason, evidence: agentTrace, rawEvidence: [], critic: null, degraded: false,
      path: agentPath, rounds: llmRounds, toolsCalled: [...calledTools],
    };
    if (fhReport && fhReport.penalty > 0 && fhReport.total >= 3) {
      const cap = action === "可上车" ? 60 : 65; // 高失效环境可上车置信不超 60
      v = {
        ...v,
        confidence: Math.max(20, Math.min(cap, v.confidence - fhReport.penalty)),
        reason: `${v.reason}（因子健康度${fhReport.decayedCount}/${fhReport.total}失效，置信-${fhReport.penalty}）`,
        evidence: [...v.evidence, `🧪 因子健康度门控：${fhReport.summary}`],
      };
    }
    if (opts?.selfConsistency) v = await selfConsistencyCheck(v);
    if (opts?.useCritic) v = await criticReview(v, ctx);
    return v;
  };

  for (let round = 0; round < 5; round++) {
    const user = `主线：${mainline}\n强度${ctx.strengthScore ?? "?"}分·涨停${ctx.ztCount ?? "?"}只·高度${ctx.height ?? "?"}板·阶段${ctx.stage ?? "?"}\n${fhInject ? "\n" + fhInject + "\n" : ""}\n${history.join("\n") || "（第一轮，开始调研）"}\n\n本轮请输出JSON（工具调用或最终裁决）：`;
    const r = await callAgentChat(system, user, toolDefs, { temperature: 0.2 });
    if (!r) { llmOk = false; break; } // LLM/服务端不可用 → 降级
    if (r.rateLimited) { llmOk = false; rateLimitedFlag = true; break; } // v9.45：配额受限 → 显式降级
    llmRounds++;

    // ① 原生 tool_calls（Agnes 支持时）
    if (r.toolCalls && r.toolCalls.length > 0) {
      if (!agentPath) agentPath = "native_toolcall"; // 首个协议记录
      let roundOut: string[] = [];
      let hardVeto = false;
      for (const tc of r.toolCalls) {
        const tool = toolByName.get(tc.name);
        if (!tool) { roundOut.push(`未知工具 ${tc.name}`); continue; }
        calledTools.add(tc.name);
        let args = ctx;
        try { args = { ...ctx, ...(JSON.parse(tc.args || "{}") as object) }; } catch { /* 参数解析失败用默认 ctx */ }
        try {
          const res = await tool.execute(args as never);
          agentTrace.push(`${tc.name}(${tc.args.slice(0, 60)}) → ${JSON.stringify(res).slice(0, 120)}`);
          roundOut.push(`${tc.name} 返回：${JSON.stringify(res).slice(0, 200)}`);
          // 早停：强否决工具（系统性风险 red / 诱多 / 封单崩落）
          if (tool.normalize && tool.kind === "vote") {
            const n = tool.normalize(res);
            if (n && n.verdict === "禁止" && ["checkSysRisk", "detectTrap", "detectSealDecay", "computePortfolioRisk"].includes(tc.name)) {
              hardVeto = true;
            }
          }
        } catch (e) { roundOut.push(`${tc.name} 执行失败`); }
      }
      if (hardVeto) {
        return await finalize("禁止", 88, `Agent 调研中触发硬否决（${roundOut[0]?.slice(0, 60) ?? "强风险工具"}）`);
      }
      history.push(`第${round + 1}轮调用：\n${roundOut.join("\n")}`);
      continue;
    }

    // ② LLM 手动 JSON（Agnes 不支持原生 tool_calls 时）：calls 或 final
    const parsed = parseAIJSON<{ calls?: Array<{ tool: string; reason?: string }>; final?: { action: string; confidence: number; reason: string } }>(r.text);
    if (parsed?.final) {
      if (!agentPath) agentPath = "manual_json";
      const f = parsed.final;
      return await finalize(
        f.action === "可上车" || f.action === "禁止" ? f.action : "观望",
        Math.max(10, Math.min(95, Number(f.confidence) || 50)),
        String(f.reason ?? "").slice(0, 50),
      );
    }
    if (parsed?.calls && parsed.calls.length > 0) {
      if (!agentPath) agentPath = "manual_json";
      const roundOut: string[] = [];
      let hardVeto = false;
      for (const c of parsed.calls) {
        const tool = toolByName.get(c.tool);
        if (!tool) { roundOut.push(`未知工具 ${c.tool}`); continue; }
        calledTools.add(c.tool);
        try {
          const res = await tool.execute(ctx as never);
          agentTrace.push(`${c.tool} → ${JSON.stringify(res).slice(0, 120)}`);
          roundOut.push(`${c.tool} 返回：${JSON.stringify(res).slice(0, 200)}`);
          if (tool.normalize && tool.kind === "vote") {
            const n = tool.normalize(res);
            if (n && n.verdict === "禁止" && ["checkSysRisk", "detectTrap", "detectSealDecay", "computePortfolioRisk"].includes(c.tool)) hardVeto = true;
          }
        } catch { roundOut.push(`${c.tool} 执行失败`); }
      }
      if (hardVeto) {
        return await finalize("禁止", 88, `Agent 调研触发硬否决（${roundOut[0]?.slice(0, 60) ?? "强风险工具"}）`);
      }
      history.push(`第${round + 1}轮调用：\n${roundOut.join("\n")}`);
      continue;
    }
    // ③ 输出无法解析 → 重试一次，仍失败降级
    if (round === 0) { history.push("（上一轮输出无法解析，请直接给最终裁决）"); continue; }
    llmOk = false;
    break;
  }

  // ---------- ② 降级：LLM 不可用 / 轮次耗尽 / 配额受限 → 回退 v9.40 全跑工具 + 规则投票 ----------
  const { votes, raw } = await collectToolEvidence(ctx);
  // v9.43：降级路径也接入因子健康度门控（此前 runConsensus 未传 factorStats）
  const factorStats = fhReport && fhReport.total >= 3 ? { decayed: fhReport.decayedCount, total: fhReport.total } : undefined;
  const fb = votes.length > 0 ? runConsensus(votes, { factorStats }) : runConsensus([{ name: "兜底", verdict: "观望", confidence: 50, weight: 1, reason: "无工具证据" }], { factorStats });
  return {
    action: fb.action,
    confidence: fb.confidence,
    reason: rateLimitedFlag
      ? "AI 配额受限（服务端限速），规则投票兜底"
      : llmOk ? `5轮调研后规则兜底（${agentTrace.length} 次工具调用）` : "LLM/服务端不可用，规则投票兜底",
    evidence: votes.map(e => `${e.name}: ${e.verdict}`),
    rawEvidence: raw,
    critic: null,
    degraded: true,
    path: "rule_fallback",
    rounds: llmRounds,
    toolsCalled: [...calledTools],
    rateLimited: rateLimitedFlag || undefined,
  };
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

// ============================================================
// v9.53（V7-2/10）：AI 逐标的研判 —— 让 AI 下探到个股层
// 对"首选/接力"标的做一次轻量 LLM 研判（单次调用，配额友好，不跑 5 轮 ReAct），
// 输出 可买/谨慎/回避 + 理由 + 风险点 + 关键观察点。
// 降级：配额受限/LLM 失败 → degraded=true（前端显式标注"本次为规则筛选"V7-11）。
// ============================================================
import { fmtMoney } from "./format";

export interface StockVerdict {
  code: string;
  name: string;
  verdict: "可买" | "谨慎" | "回避";
  reason: string;        // ≤40字
  riskPoints: string[];  // 风险点
  keyLevel: string;      // 关键观察点（封单/换手/竞价）
  degraded: boolean;     // true = 规则兜底（配额受限/失败）
  rateLimited?: boolean;
}

// ============================================================
// v9.57（V8-4）：decideForStock 升级为"精简 ReAct"—— LLM 自主调 ≥2 个股工具
// （getStockFund 资金面 / detectStockTrap 诱多 / checkStockExitSignal 离场），
// 让个股 AI 与主线 AI 同深度（不再是单轮、不再只凭 6 个涨停池字段）。
// ============================================================

/** 对单只标的做一句话 AI 研判（标的清单每只显示；ReAct ≤3 轮，配额友好） */
export async function decideForStock(
  stock: { code: string; name: string; boardCount: number; pct: number; sealFund: number; amount: number; blastCount: number; role: string },
  mainlineCtx: { mainline: string; stage: string },
): Promise<StockVerdict> {
  const tools = getStockAgentTools({
    code: stock.code, name: stock.name, pct: stock.pct,
    sealFund: stock.sealFund, amount: stock.amount, blastCount: stock.blastCount,
    mainline: mainlineCtx.mainline, stage: mainlineCtx.stage, boardCount: stock.boardCount,
  });
  const toolDefs = tools.map(t => ({
    name: t.name,
    description: t.description,
    parameters: { type: "object", properties: {}, additionalProperties: true },
  }));
  const system = `你是10年A股游资操盘手，正在用工具独立调研个股"${stock.name}(${stock.code})"是否值得上车。
背景：主线「${mainlineCtx.mainline}」（${mainlineCtx.stage}）· 标的${stock.boardCount}板 · 角色=${stock.role} · 涨幅${stock.pct}% · 封单${fmtMoney(stock.sealFund)} · 成交${fmtMoney(stock.amount)} · 炸板${stock.blastCount}次。

你有以下工具（自主决定调用顺序，最多 3 轮）：
${toolDefs.map(t => `- ${t.name}: ${t.description}`).join("\n")}

规则：
1. 第一轮先调用 getStockFund（查真实主力资金）+ detectStockTrap（查诱多）。
2. 拿到资金/诱多数据后，结合封单/炸板/连板位置做综合研判。
3. 每轮只输出严格JSON之一：
   调用工具：{"calls":[{"tool":"工具名","reason":"为什么查它"}]}
   最终裁决：{"final":{"verdict":"可买|谨慎|回避","reason":"≤40字且必须引用≥1个具体数字（如'主力净流入8000万/封单比40%'），禁止'资金较强'类空话","riskPoints":["风险1","风险2"],"keyLevel":"关键观察点（如：竞价封单>0.8亿且不炸）"}}
4. 最多 3 轮工具调用后必须出最终裁决。`;

  const toolByName = new Map(tools.map(t => [t.name, t]));
  let history: string[] = [];
  let llmOk = true;
  let rateLimitedFlag = false;
  const fallback = (degraded: boolean, rateLimited?: boolean): StockVerdict => ({
    code: stock.code, name: stock.name, verdict: "谨慎",
    reason: "AI 配额受限/失败，规则降级", riskPoints: [], keyLevel: "", degraded, rateLimited,
  });

  for (let round = 0; round < 3; round++) {
    const user = `个股数据：${stock.boardCount}板·涨幅${stock.pct}%·封单${fmtMoney(stock.sealFund)}·成交${fmtMoney(stock.amount)}·炸板${stock.blastCount}次·角色${stock.role}\n${history.join("\n") || "（第一轮，开始调研）"}\n\n本轮请输出JSON（工具调用或最终裁决）：`;
    let r: AgentChatResult | null;
    try { r = await callAgentChat(system, user, toolDefs, { temperature: 0.2 }); } catch { r = null; }
    if (!r) { llmOk = false; break; }
    if (r.rateLimited) { llmOk = false; rateLimitedFlag = true; break; }

    // ① 原生 tool_calls
    if (r.toolCalls && r.toolCalls.length > 0) {
      const roundOut: string[] = [];
      for (const tc of r.toolCalls) {
        const tool = toolByName.get(tc.name);
        if (!tool) { roundOut.push(`未知工具 ${tc.name}`); continue; }
        let args: any = {};
        try { args = JSON.parse(tc.args || "{}"); } catch { /* 默认空参数 */ }
        try {
          const res = await tool.execute(args);
          roundOut.push(`${tc.name} 返回：${JSON.stringify(res).slice(0, 220)}`);
        } catch { roundOut.push(`${tc.name} 执行失败`); }
      }
      history.push(`第${round + 1}轮调用：\n${roundOut.join("\n")}`);
      continue;
    }

    // ② 手动 JSON：calls 或 final
    const parsed = parseAIJSON<{ calls?: Array<{ tool: string }>; final?: { verdict?: string; reason?: string; riskPoints?: string[]; keyLevel?: string } }>(r.text);
    if (parsed?.final?.verdict) {
      const f = parsed.final;
      const v = f.verdict === "可买" || f.verdict === "回避" ? f.verdict : "谨慎";
      // v9.58（V8-9）：AI 结论写入全局 store（个股雷达等处可见，不再孤立）
      try { setStockAI({ code: stock.code, verdict: v, reason: String(f.reason ?? "").slice(0, 40), ts: Date.now() }); } catch { /* 静默 */ }
      return {
        code: stock.code, name: stock.name,
        verdict: v,
        reason: String(f.reason ?? "").slice(0, 40),
        riskPoints: Array.isArray(f.riskPoints) ? f.riskPoints.slice(0, 3) : [],
        keyLevel: String(f.keyLevel ?? "").slice(0, 40),
        degraded: false,
      };
    }
    if (parsed?.calls && parsed.calls.length > 0) {
      const roundOut: string[] = [];
      for (const c of parsed.calls) {
        const tool = toolByName.get(c.tool);
        if (!tool) { roundOut.push(`未知工具 ${c.tool}`); continue; }
        try {
          const res = await tool.execute({});
          roundOut.push(`${c.tool} 返回：${JSON.stringify(res).slice(0, 220)}`);
        } catch { roundOut.push(`${c.tool} 执行失败`); }
      }
      history.push(`第${round + 1}轮调用：\n${roundOut.join("\n")}`);
      continue;
    }
    // ③ 无法解析 → 继续下一轮或降级
    history.push(`（第${round + 1}轮 LLM 输出无法解析）`);
  }
  if (!llmOk) return fallback(true, rateLimitedFlag);
  return fallback(true); // 3 轮未出裁决（LLM 输出异常）→ 规则降级
}
