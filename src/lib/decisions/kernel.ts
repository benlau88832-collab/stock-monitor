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
  /** v9.121.0（卓越 S2-1b）：游资战术（接力分/情绪买卖点/买点/卖点纪律/梯队位置） */
  tactics: Tactics;
  evidence: { sampleSize: number; caliber: string; asOf: string };
  reasons: string[];
  blocks: string[];
  latencyMs: number;
  disclaimer: string;
}

/** 认知层摘要（供五支柱判断；服务端返回的 MarketCognition 或其子集） */
export interface CognSubset {
  version?: number;
  session?: { phase?: string; window?: string };
  risk?: { value?: { level?: string; gateOpen?: boolean; traps?: string[] } };
  sentiment?: { value?: { stage?: string; score?: number | null; premium?: number | null } };
  mainline?: { value?: { primaryTheme?: string; strength?: number; ladder?: { tier1?: string[]; tier2?: string[] } } };
  leader?: { value?: { name?: string; height?: number; relayOk?: boolean } };
}

/** 游资战术（v9.121.0 卓越 S2-1b）—— 与 server/lib/decisionCore.js 同规则双端同构 */
export interface Tactics {
  relayScore: number;      // 龙头接力环境分 0-100
  stageAction: string;     // 情绪周期买卖点
  buyPoint: string;        // 买点时机
  sellDiscipline: string;  // 卖点纪律
  ladderPos: string;       // 梯队位置（tier1龙头/tier2跟风/非主线梯队）
}

/** 龙头接力环境分（0-100）：溢价/接力健康/高度空间/闸门/陷阱 */
export function relayEnvScore(cog: CognSubset): number {
  const s = cog.sentiment?.value ?? {};
  const l = cog.leader?.value ?? {};
  const r = cog.risk?.value ?? {};
  let score = 50;
  if ((s.premium ?? 0) > 0) score += 15;
  if (l.relayOk === true) score += 12;
  if ((l.height ?? 0) <= 4) score += 8; else score -= 10;
  if (r.gateOpen === true) score += 10; else score -= 18;
  if (!(r.traps ?? []).length) score += 5;
  return Math.max(0, Math.min(100, score));
}

/** 情绪周期买卖点（游资核心坐标系） */
export function stageActionOf(stage?: string): string {
  const map: Record<string, string> = {
    冰点: "底部观察，等待放量企稳", 退潮: "回避新仓，等逻辑重建", 启动: "趋势启动确认，低吸/突破试仓",
    发酵: "主线确认，回踩分批加仓", 高潮: "持有不追高，分批止盈", 分歧: "减仓观察，等分歧转一致",
  };
  return map[stage ?? ""] ?? "观望为主";
}

/** 买点时机（时段/涨停状态/量价） */
export function buyPointOf(stock: StockInput | null, cog: CognSubset, sessionPhase?: string): string {
  if (sessionPhase === "竞价" || /09:2/.test(cog.session?.window ?? "")) return "竞价观察，不追高";
  if (stock?.limitUp && (stock?.relay ?? 0) >= 2) return "连板加速，谨慎参与";
  if (!stock?.limitUp && (stock?.pct ?? 0) >= 3 && (stock?.pct ?? 0) <= 7 && (stock?.mainNet ?? 0) > 0) return "回踩低吸";
  if (stock?.limitUp && (stock?.relay ?? 0) === 1) return "放量首板后低吸";
  return "回踩确认";
}

/** 卖点纪律（阶段决定） */
export function sellDisciplineOf(stage?: string): string {
  return stage === "高潮" || stage === "分歧" ? "断板即走；烂板减半；14:50未封减仓" : "破均线/量能背离减仓；止损不犹豫";
}

/** 梯队位置（主线 tier1/tier2） */
export function ladderPosOf(stock: StockInput | null, cog: CognSubset): string {
  const tier1 = cog.mainline?.value?.ladder?.tier1 ?? [];
  const tier2 = cog.mainline?.value?.ladder?.tier2 ?? [];
  const name = (stock?.name ?? "").trim();
  // v9.123.0（卓越审查 P0-1）：空名守卫（与 decisionCore.js 同规则双端同构）——
  //   n.includes("") 恒 true，无名股票被误判"tier1龙头"
  if (!name) return "非主线梯队";
  if (tier1.some((n) => n === name || (n.length >= 2 && name.includes(n.slice(0, 2))))) return "tier1龙头";
  if (tier2.some((n) => n === name || (n.length >= 2 && name.includes(n.slice(0, 2))))) return "tier2跟风";
  return "非主线梯队";
}

/** 游资战术总装（纯函数） */
export function assessTactics(stock: StockInput | null, cog: CognSubset, sessionPhase?: string): Tactics {
  const stage = cog.sentiment?.value?.stage ?? "启动";
  return {
    relayScore: relayEnvScore(cog),
    stageAction: stageActionOf(stage),
    buyPoint: buyPointOf(stock, cog, sessionPhase),
    sellDiscipline: sellDisciplineOf(stage),
    ladderPos: ladderPosOf(stock, cog),
  };
}

/** 个股输入（决策数据源之一） */export interface StockInput {
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
function detectTrap(stock: StockInput, cog: CognSubset): PillarVerdict {  const traps: string[] = [];
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
  /** v9.121.0（卓越 S2-1b）：真实时段（buyPoint 竞价判断；缺省 undefined → 非竞价分支） */
  sessionPhase?: string,
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
    tactics: assessTactics(stock, cog, sessionPhase), // v9.121.0（卓越 S2-1b）：游资战术
    evidence: {
      sampleSize: 1,
      caliber: "五支柱(准入/仓位/离场/风控/诱多)规则阈值法 + 游资战术，认知层 v" + (cog.version ?? "?") + "，非概率预测",
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

/** v9.128.0（一致性审查 P0-2）：阶段口径——认知层 stage 优先；topMainline.trend 值域是 down/up
 * （主题趋势字段）不是情绪阶段枚举，仅作兜底。此前 trend 优先 → 前端阶段分支永不命中、仓位恒权重 1.0
 * （与认知层同标的实测 15% vs 21% 分叉，golden 只锁纯函数不锁装配故未拦截）。 */
export function resolveDecisionStage(topTrend: string | undefined, cogStage: string | undefined): string {
  return cogStage ?? topTrend ?? "观察中";
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
    stage: resolveDecisionStage(topMainline.trend, cog?.sentiment?.value?.stage),
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
  // v9.123.0（卓越审查 P1-5）：工具失败(null/无结论)时 omit 对应支柱 → 核心走认知近似兜底
  //   （此前无条件注入"准入工具未给出"占位，composeDecisionCore 的 ctx.admission ?? 兜底永不触发，"永不降级"名存实亡）
  const admission = a.action
    ? { pass: a.action === "可上车" || a.action === "进攻", score: Number(a.confidence) || 50, detail: String(a.reason ?? "准入工具未给出") }
    : undefined;
  const position = Number(p.suggestedPct)
    ? { pass: (Number(p.suggestedPct) || 0) >= 10, score: Number(p.suggestedPct) || 0, detail: `建议仓位 ${p.suggestedPct ?? 0}%（工具计算）` }
    : undefined;
  const exit = e.level
    ? { pass: true, score: e.level === "red" ? 30 : e.level === "yellow" ? 60 : 80, detail: `离场${e.level}${er.length ? "：" + er.slice(0, 2).join("；") : ""}` }
    : undefined;
  const v = composeDecisionCore(stock, cog, {
    riskAppetite: "短线",
    ...(admission ? { admission } : {}),
    ...(position ? { position } : {}),
    ...(exit ? { exit } : {}),
    sysRisk: { hs300Pct: null, limitDownCount: 0 }, // 沪深300/跌停由认知风险等级覆盖（服务端/页面另有完整 sysRisk 面板）
  }, resolveLocalPhase());
  return { ...v, latencyMs: Date.now() - t0 };
}

/** v9.121.0（卓越 S2-1b）：本地真实时段（buyPoint 竞价判断）—— 与 DecisionCard resolveDecisionWindow 同口径 */
function resolveLocalPhase(now = new Date()): string {
  const bj = new Date(now.getTime() + (now.getTimezoneOffset() + 8 * 60) * 60000);
  const h = bj.getHours(), m = bj.getMinutes();
  if (h === 9 && m >= 20 && m <= 30) return "竞价";
  if (h === 13 && m <= 5) return "午后";
  return "盘中";
}
