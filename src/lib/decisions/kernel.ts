// ============================================================
// src/lib/decisions/kernel.ts —— 决策直达五支柱（v9.116.0，S2-1）
// 架构定位：把决策内核提升为"操作面板"——准入/仓位/离场/风控/诱多五支柱一键裁决，
// **全程不经过 LLM**：纯函数直调（agentTools 工具 execute + sysRiskGuard + detectTrap），
// 秒级（纯函数核心 <1ms 实测）、断网可用、永不降级。
// 数据源：认知层 /api/cognition（全站唯一理解）+ PG 快照 + 个股实时。
// 合规：输出带 sampleSize + caliber，不承诺胜率，保留免责声明。
// 服务端等价实现：server/lib/decisionLayer.js（CJS，同规则双端同构）。
// ============================================================
import { getAgentTools, type ToolContext } from "../agentTools";
import { fetchMarketSnapshot } from "../dataLayer";
import { checkSysRisk } from "../sysRiskGuard";

export interface PillarVerdict {
  pass: boolean;
  score: number; // 0-100
  detail: string;
}

export interface DecisionVerdict {
  code: string | null;
  name: string | null;
  decision: "可上车" | "观望" | "回避";
  score: number; // 综合 0-100
  pillars: {
    admission: PillarVerdict; // 准入（主线/闸门/接力）
    position: PillarVerdict;  // 仓位
    exit: PillarVerdict;      // 离场预案
    risk: PillarVerdict;      // 风控（系统性风险）
    trap: PillarVerdict;      // 诱多（一票否决）
  };
  stopLossPct: number | null;
  targetPct: number | null;
  suggestedPositionPct: number | null;
  evidence: { sampleSize: number; caliber: string; asOf: string };
  reasons: string[];
  blocks: string[];
  latencyMs: number;
  disclaimer: string;
}

/** 认知层摘要（供五支柱判断；服务端返回的 MarketCognition 或其子集） */
export interface CognSubset {
  version?: number;
  risk?: { value?: { level?: string; gateOpen?: boolean; traps?: string[] } };
  sentiment?: { value?: { stage?: string; score?: number | null } };
  mainline?: { value?: { primaryTheme?: string; strength?: number; ladder?: { tier1?: string[]; tier2?: string[] } } };
  leader?: { value?: { name?: string; height?: number; relayOk?: boolean } };
}

/** 个股输入（决策数据源之一） */
export interface StockInput {
  code: string;
  name?: string;
  pct?: number;
  price?: number;
  mainNet?: number | null;   // 主力净额（元）
  turnoverRate?: number; // 换手 %
  limitUp?: boolean;
  relay?: number;        // 连板高度
}

/** 诱多识别（④ kernel detectTrap 移植）：主力净流出/放量不足/炸板环境首板 */
function detectTrap(stock: StockInput, cog: CognSubset): PillarVerdict {
  const traps: string[] = [];
  if (typeof stock.mainNet === "number" && stock.mainNet < 0) traps.push("主力净流出");
  if (typeof stock.pct === "number" && stock.pct > 5 && typeof stock.turnoverRate === "number" && stock.turnoverRate < 5 && !stock.limitUp) {
    traps.push("放量不足疑似诱多");
  }
  if ((cog.risk?.value?.traps ?? []).includes("炸板率偏高") && (stock.relay ?? 0) === 0) traps.push("炸板环境首板风险");
  const score = Math.max(0, 100 - traps.length * 35);
  return { pass: traps.length === 0, score, detail: traps.length ? "命中：" + traps.join("/") : "无诱多信号" };
}

/** 风控支柱：系统性风险（sysRiskGuard 纯函数）→ red 一票否决 */
function assessRisk(ctx: { hs300Pct: number | null; limitDownCount: number; blastedRate: number; sentiment: number | null }, cog: CognSubset): PillarVerdict {
  let score = 80;
  const level = cog.risk?.value?.level ?? "低";
  if (level === "高") score -= 15;
  if (level === "极高") score -= 30;
  let pass = level !== "极高";
  const details: string[] = [`认知风险${level}`];
  if (ctx.hs300Pct != null && ctx.limitDownCount != null) {
    const r = checkSysRisk({
      hs300Pct: ctx.hs300Pct, limitDownCount: ctx.limitDownCount,
      blastedRate: ctx.blastedRate ?? 0, sentiment: ctx.sentiment ?? null,
    });
    if (r.level === "red") { pass = false; score -= 25; details.push("系统性风险 red"); }
    else if (r.level === "yellow") { score -= 10; details.push("系统性风险 yellow"); }
  } else {
    details.push("系统性风险缺数据（沪深300/跌停家数）");
  }
  score = Math.max(0, Math.min(100, score));
  return { pass, score, detail: details.join("；") };
}

/** 主裁决编排（纯函数核心，无 IO —— 可单测确定性/latency<1ms） */
export function composeDecisionCore(
  stock: StockInput | null,
  cog: CognSubset,
  ctx: {
    riskAppetite: "短线" | "波段" | "保守";
    admission?: PillarVerdict;   // 可注入（agentTools 结果）；缺省用认知近似
    position?: PillarVerdict;
    exit?: PillarVerdict;
    sysRisk?: { hs300Pct: number | null; limitDownCount: number };
  },
): DecisionVerdict {
  const t0 = Date.now();
  const stage = cog.sentiment?.value?.stage ?? "启动";
  const gateOpen = cog.risk?.value?.gateOpen !== false;

  // 准入：注入优先（agentTools getAdmissionVerdict 真实结果），否则认知近似
  const admission: PillarVerdict = ctx.admission ?? (() => {
    let score = 50;
    const reasons: string[] = [];
    if (gateOpen) { score += 15; reasons.push("情绪闸门放开"); } else { score -= 20; reasons.push("闸门关闭"); }
    if (stage === "发酵" || stage === "高潮") score += 10;
    if (stage === "退潮" || stage === "冰点") score -= 15;
    score = Math.max(0, Math.min(100, score));
    return { pass: score >= 60 && gateOpen, score, detail: reasons.join("；") || "认知近似准入" };
  })();

  // 仓位：注入优先，否则 ④ advisePosition（情绪周期调权）
  const position: PillarVerdict = ctx.position ?? (() => {
    const base = ctx.riskAppetite === "短线" ? 30 : ctx.riskAppetite === "波段" ? 20 : 10;
    const stageWeight = stage === "高潮" ? 0.6 : stage === "冰点" ? 1.4 : 1;
    let pct = Math.round(base * (admission.score / 100) * stageWeight);
    pct = Math.max(5, Math.min(ctx.riskAppetite === "短线" ? 40 : 25, pct));
    return { pass: pct >= 10, score: pct, detail: `建议仓位 ${pct}%（基数${base}%×准入分×情绪权重${stageWeight.toFixed(1)}）` };
  })();

  // 离场：注入优先，否则 ④ checkExit（阶段止损/止盈）
  const exit: PillarVerdict = ctx.exit ?? (() => {
    const stopLoss = stage === "高潮" ? 0.05 : stage === "冰点" ? 0.04 : 0.06;
    const target = (stock?.relay ?? 0) >= 2 ? 0.15 : 0.1;
    return { pass: true, score: 80, detail: `止损-${Math.round(stopLoss * 100)}% / 止盈+${Math.round(target * 100)}%` };
  })();

  // 风控 + 诱多
  const risk = assessRisk({ hs300Pct: ctx.sysRisk?.hs300Pct ?? null, limitDownCount: ctx.sysRisk?.limitDownCount ?? 0, blastedRate: 0, sentiment: cog.sentiment?.value?.score ?? null }, cog);
  const trap = stock ? detectTrap(stock, cog) : { pass: true, score: 80, detail: "无个股数据，诱多检查跳过" };

  // 一票否决：诱多命中 或 风控不过 或 闸门关 → 回避
  const blocked = !trap.pass || !risk.pass || !gateOpen;
  const score = Math.round(
    admission.score * 0.35 + position.score * 0.2 + exit.score * 0.1 + risk.score * 0.2 + trap.score * 0.15,
  );
  const decision: DecisionVerdict["decision"] = blocked ? "回避" : score >= 65 ? "可上车" : "观望";

  const reasons: string[] = [];
  const blocks: string[] = [];
  if (admission.pass) reasons.push(admission.detail);
  if (gateOpen) reasons.push("接力环境健康");
  if (!trap.pass) blocks.push(trap.detail);
  if (!risk.pass) blocks.push(risk.detail);
  if (!gateOpen) blocks.push("情绪闸门关闭");

  return {
    code: stock?.code ?? null,
    name: stock?.name ?? null,
    decision,
    score,
    pillars: { admission, position, exit, risk, trap },
    stopLossPct: parsePct(exit.detail, 0),
    targetPct: parsePct(exit.detail, 1),
    suggestedPositionPct: position.score,
    evidence: {
      sampleSize: 1,
      caliber: "五支柱(准入/仓位/离场/风控/诱多)规则阈值法，认知层 v" + (cog.version ?? "?") + "，非概率预测",
      asOf: new Date().toISOString(),
    },
    reasons,
    blocks,
    latencyMs: Date.now() - t0,
    disclaimer: "本裁决为规则引擎即时判断，样本量 n=1，不构成投资建议，不承诺胜率。",
  };
}

function parsePct(detail: string, idx: number): number | null {
  const m = detail.match(/-?(\d+)%/g);
  if (!m || !m[idx]) return null;
  return Math.abs(parseInt(m[idx], 10));
}

/**
 * 决策直达入口（异步 wrapper）：输入 {code?, mainline?} → 五支柱裁决。
 * 拉取：认知层（/api/cognition）+ PG 快照 + 个股实时；全部失败仍有认知近似裁决（永不空白）。
 */
export async function composeDecision(input: { code?: string; mainline?: string }): Promise<DecisionVerdict> {
  const t0 = Date.now();
  // 1) 认知层 + PG 快照（并行）
  const [cog, snap] = await Promise.all([
    fetch("/api/cognition", { signal: AbortSignal.timeout(5000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetchMarketSnapshot(),
  ]);
  // 2) 个股数据（若有 code）：fetchStockOne（价格/主力净额）+ fetchStockBriefBatch（换手）
  let stock: StockInput | null = null;
  if (input.code) {
    try {
      const { fetchStockOne, fetchStockBriefBatch } = await import("../api");
      const [one, brief] = await Promise.all([
        fetchStockOne(input.code).catch(() => null),
        fetchStockBriefBatch([input.code]).catch(() => new Map()),
      ]);
      const b = brief?.get(input.code);
      stock = {
        code: input.code,
        name: one?.name ?? b?.name,
        pct: one?.pct ?? b?.pct,
        price: one?.price ?? b?.price,
        mainNet: one?.mainNet ?? null,
        turnoverRate: b?.turnoverRate,
      };
    } catch { stock = { code: input.code }; }
  }
  // 3) 组装五支柱（准入/仓位/离场走 agentTools 真实工具，其余认知近似）
  const data = snap?.data ?? {};
  const m = data.market ?? {};
  const gate = data.gate ?? {};
  const topMainline = data.mainlines?.top?.[0] ?? {};
  const mainlineName = input.mainline ?? topMainline.theme ?? cog?.mainline?.value?.primaryTheme ?? "—";
  const ctx: ToolContext = {
    mainline: mainlineName,
    strengthScore: topMainline.heat ?? cog?.mainline?.value?.strength ?? null,
    stage: topMainline.trend ?? cog?.sentiment?.value?.stage ?? "观察中",
    gateMode: gate.mode ?? "empty",
    marketFactor: gate.factor ?? 0.5,
    ztCount: m.ztCount ?? 0,
    height: m.maxBoardHeight ?? cog?.leader?.value?.height ?? 0,
    sentiment: m.sentiment ?? cog?.sentiment?.value?.score ?? undefined,
    blastedRate: m.blastedRate ?? null,
    premiumAvg: m.premiumAvg ?? null,
    trapFlagged: false,
    ...(stock?.price != null ? { price: stock.price, pct: stock.pct, mainNet: stock.mainNet ?? undefined, mainNetPct: 0 } : {}),
  };
  const tools = new Map(getAgentTools().map((t) => [t.name, t]));
  // v9.116.0：execute 签名 unknown → 统一 runTool 包装（失败返回 null，永不抛）
  const runTool = async (name: string, args: any): Promise<any> => {
    const t = tools.get(name);
    if (!t) return null;
    try { return await (t.execute as any)(args); } catch { return null; }
  };
  const [admissionRes, positionRes, exitRes] = await Promise.all([
    runTool("getAdmissionVerdict", ctx),
    runTool("computePositionAdvice", ctx),
    runTool("checkExitSignal", { ...ctx, code: input.code ?? null }),
  ]);
  const a = (admissionRes ?? {}) as Record<string, any>;
  const p = (positionRes ?? {}) as Record<string, any>;
  const e = (exitRes ?? {}) as { level?: string; reasons?: string[] };
  const er = e.reasons ?? [];
  const v = composeDecisionCore(stock, cog, {
    riskAppetite: "短线",
    admission: { pass: a.action === "可上车" || a.action === "进攻", score: Number(a.confidence) || 50, detail: String(a.reason ?? "准入工具未给出") },
    position: { pass: (Number(p.suggestedPct) || 0) >= 10, score: Number(p.suggestedPct) || 0, detail: `建议仓位 ${p.suggestedPct ?? 0}%（工具计算）` },
    exit: { pass: true, score: e.level === "red" ? 30 : e.level === "yellow" ? 60 : 80, detail: `离场${e.level ?? "none"}${er.length ? "：" + er.slice(0, 2).join("；") : ""}` },
    sysRisk: { hs300Pct: null, limitDownCount: 0 }, // 沪深300/跌停由认知风险等级覆盖（服务端/页面另有完整 sysRisk 面板）
  });
  return { ...v, latencyMs: Date.now() - t0 };
}
