// ============================================================
// v9.38（V3-1）：Agent 工具注册表
// 把现有 16+ 决策/数据函数包装成工具描述符（name/desc/execute）。
// execute 直接调现有纯函数，不触发额外 LLM 调用（省 token 设计）。
// 供 V3-2 aiAgent 主循环调用（"AI 调工具查数据，而不是闭眼判断"）
// v9.43：+ factorHealth 工具 —— 幻方"因子会失效"喂给 AI
// ============================================================

export interface AgentTool<TResult = unknown> {
  name: string;
  description: string;
  /** v9.40（V4-F）：工具类别 —— vote=决策类（归一为 EvidenceSource 投票）/ data=数据类（原始盘面，供 LLM 独立推理） */
  kind?: "vote" | "data";
  /** v9.40（V4-F）：统一 schema 归一函数 —— 由工具自身把结果映射为 {verdict, confidence, reason}，消除 ?? 链脆弱映射 */
  normalize?: (raw: any) => { verdict: Verdict; confidence: number; reason: string } | null;
  /** 执行函数：纯规则/数据查询，禁止内部再调 LLM */
  execute: (args: any) => Promise<TResult> | TResult;
}

export type Verdict = "可上车" | "观望" | "禁止";

// ---- 工具输入类型（宽松，execute 内部防御） ----
export interface ToolContext {
  mainline?: string;
  code?: string;
  board?: string;
  strengthScore?: number | null;
  stage?: string;
  ztCount?: number;
  height?: number;
  exitSignal?: boolean;
  marketState?: string;
  marketFactor?: number;
  riskLevel?: "red" | "yellow" | "none";
  sealRed?: number;
  sealYellow?: number;
  trapFlagged?: boolean;
  lhbBoost?: boolean;
  fundStreakInflow?: boolean;
  premiumAvg?: number | null;
  blastedRate?: number | null;
  sentiment?: number | null;
  gateMode?: string;
  concentrationPct?: number;
  todayNewPositions?: number;
}

// ---------- 工具定义（懒加载现有引擎，避免循环依赖） ----------
let cachedTools: AgentTool[] | null = null;

// ============================================================
// v9.43：因子健康度评估（喂给 AI 的"因子失效"情报）
// 数据源优先 PG 快照（server cron 落库 factor_ic:日期），无快照降级前端现算。
// 输出含 penalty 建议（与 decisionBus 门控同规则：失效占比≥50%→-15 / ≥30%→-8），
// 供 aiAgent 预注入 + finalize 强制扣置信（AI 跑不掉门控）。
// ============================================================
export interface FactorHealthReport {
  date: string | null;
  window: number;
  items: Array<{ name: string; ic: number; samples: number; decayed: boolean; reversed: boolean }>;
  decayedCount: number;
  reversedCount: number;
  total: number;
  /** 按 decisionBus 规则：0 / 8 / 15 */
  penalty: number;
  summary: string;
}

export async function evaluateFactorHealth(): Promise<FactorHealthReport | null> {
  try {
    const { loadFactorIcHistory, loadFactorRows } = await import("./factorHistory");
    const { FACTORS, markNextWin, evaluateFactorIcSeries } = await import("./factorLib");
    let items: FactorHealthReport["items"] = [];

    // 1. 主数据源：PG 快照（server cron 每日落库，含最新一天的 IC/失效/反转）
    try {
      const hist = await loadFactorIcHistory(30);
      if (hist && hist.dates.length >= 1) {
        const pts = new Map<string, { ic: number; samples: number; decayed: boolean; reversed?: boolean }>();
        for (const f of FACTORS) {
          const series = hist.byFactor[f.name];
          const cur = series && series.length > 0 ? series[series.length - 1] : null;
          if (cur) pts.set(f.name, { ic: cur.ic, samples: cur.samples, decayed: cur.decayed, reversed: cur.reversed });
        }
        if (pts.size > 0) {
          items = FACTORS.map(f => {
            const p = pts.get(f.name);
            return { name: f.name, ic: p?.ic ?? 0, samples: p?.samples ?? 0, decayed: p?.decayed ?? false, reversed: p?.reversed ?? false };
          });
        }
      }
    } catch { /* 快照读取失败 → 降级 */ }

    // 2. 降级：前端现算（market_daily + sentiment）
    if (items.length === 0) {
      const rows = await loadFactorRows(30);
      const series = evaluateFactorIcSeries(markNextWin(rows), 10);
      items = FACTORS.map(f => {
        const cur = series[f.id]?.[series[f.id].length - 1];
        return { name: f.name, ic: cur?.ic ?? 0, samples: cur?.samples ?? 0, decayed: cur?.decayed ?? false, reversed: cur?.reversed ?? false };
      });
    }

    const total = items.length;
    const decayedCount = items.filter(i => i.decayed).length;
    const reversedCount = items.filter(i => !i.decayed && i.reversed).length;
    const ratio = total >= 3 ? decayedCount / total : 0;
    const penalty = ratio >= 0.5 ? 15 : ratio >= 0.3 ? 8 : 0;
    const summary = `${total}因子中 ${decayedCount} 失效${reversedCount > 0 ? `、${reversedCount} 方向反转` : ""}（失效占比 ${Math.round(ratio * 100)}%）${penalty > 0 ? ` → 置信度应扣 ${penalty} 分` : "，未触发置信扣减"}`;
    return { date: null, window: 10, items, decayedCount, reversedCount, total, penalty, summary };
  } catch {
    return null; // 数据层整体不可用（GitHub Pages / 无历史）→ 不影响 AI 主流程
  }
}

export function getAgentTools(): AgentTool[] {
  if (cachedTools) return cachedTools;
  cachedTools = [
    {
      name: "getAdmissionVerdict",
      description: "最终准入闸：强度×阶段×闸门×梯队 → 可上车/观望/禁止",
      kind: "vote",
      normalize: (r) => r ? { verdict: r.action as Verdict, confidence: r.confidence ?? 50, reason: (r.reasons ?? []).join("；").slice(0, 60) } : null,
      execute: async (ctx: ToolContext) => {
        const { evaluateAdmission } = await import("./admissionGate");
        const r = evaluateAdmission({
          strengthScore: ctx.strengthScore ?? null,
          stage: (ctx.stage ?? "观察中") as never,
          gateMode: (ctx.gateMode ?? "empty") as never,
          ztCount: ctx.ztCount ?? 0,
          height: ctx.height ?? 0,
          mainlineTrap: ctx.trapFlagged,
        });
        return { action: r.action, confidence: r.confidence, reasons: r.reasons };
      },
    },
    {
      name: "classifyMarketState",
      description: "市场状态机：情绪/涨停/炸板/溢价/高度 → 5 态 + 仓位系数",
      kind: "vote",
      normalize: (r) => r ? {
        verdict: (r.positionFactor ?? 0.5) >= 0.8 ? "可上车" : (r.positionFactor ?? 0.5) >= 0.5 ? "观望" : "禁止",
        confidence: Math.round(40 + (r.positionFactor ?? 0.5) * 50),
        reason: String(r.state ?? "未知") + "市（系数" + (r.positionFactor ?? 0.5) + "）",
      } : null,
      execute: async (ctx: ToolContext) => {
        const { classifyMarketState } = await import("./marketStateMachine");
        const r = classifyMarketState({
          sentiment: ctx.sentiment ?? 50,
          ztCount: ctx.ztCount ?? 0,
          dtCount: 0,
          blastedRate: ctx.blastedRate ?? 0,
          premiumAvg: ctx.premiumAvg ?? null,
          maxBoardHeight: ctx.height ?? null,
        });
        return { state: r.state, positionFactor: r.positionFactor, playbook: r.playbook };
      },
    },
    {
      name: "computePositionAdvice",
      description: "仓位定量化：闸门×强度×单票上限 → 建议仓位% + 分批 + 止损",
      kind: "vote",
      normalize: (r) => r ? { verdict: r.action as Verdict, confidence: Math.min(90, 50 + (r.suggestedPct ?? 0) / 2), reason: "建议仓位" + (r.suggestedPct ?? 0) + "%·止损" + (r.stopLoss ?? 0) + "%" } : null,
      execute: async (ctx: ToolContext) => {
        const { computePositionAdvice } = await import("./positionSizing");
        const r = computePositionAdvice({
          mainline: ctx.mainline ?? "—",
          strengthScore: ctx.strengthScore ?? null,
          stage: (ctx.stage ?? "观察中") as never,
          gate: { mode: (ctx.gateMode ?? "empty") as never, factor: ctx.marketFactor ?? 0.5, positionLimit: 100, riskLevel: "low", label: "Agent", reason: [] },
          discipline: { maxSinglePct: 30, maxTotalPct: 100, maxNewPositionsPerDay: 3, totalCapital: 1e6, cooldownLossStreak: 3 },
          currentTotalPct: 0,
          todayNewPositions: ctx.todayNewPositions ?? 0,
          mainlineTrap: ctx.trapFlagged,
        });
        return { action: r.action, suggestedPct: r.suggestedPct, tranches: r.tranches, stopLoss: r.stopLoss };
      },
    },
    {
      name: "checkExitSignal",
      description: "个股离场：7 条规则 → red/yellow/none",
      kind: "vote",
      normalize: (r) => {
        if (!r) return null;
        const map: Record<string, Verdict> = { red: "禁止", yellow: "观望", none: "可上车" };
        return { verdict: map[r.level] ?? "观望", confidence: r.level === "red" ? 85 : r.level === "yellow" ? 60 : 50, reason: (r.reasons ?? []).join("；").slice(0, 50) };
      },
      execute: async (ctx: ToolContext) => {
        const { checkStockExit } = await import("./stockExit");
        const r = checkStockExit({
          code: ctx.code ?? "600000", name: "标的", cost: 10, price: 10,
          pct: 3, mainNetPct: 0, retailNetPct: 0, mainNet: 0, mainNet5d: 0, mainNet10d: 0,
          sealFund: 0, amount: 0, leaderAlive: true, isLeader: false, mainline: ctx.mainline ?? "",
        });
        return { level: r.level, reasons: r.reasons };
      },
    },
    {
      name: "computePortfolioRisk",
      description: "组合风险预算：市场状态×连亏熔断×集中度 → 总仓位上限",
      kind: "vote",
      normalize: (r) => r ? {
        verdict: (r.maxPositionPct ?? 50) >= 60 ? "可上车" : (r.maxPositionPct ?? 50) >= 40 ? "观望" : "禁止",
        confidence: Math.min(90, (r.maxPositionPct ?? 50)),
        reason: "总仓上限" + (r.maxPositionPct ?? 0) + "%" + (r.lossStreak ? "·连亏" + r.lossStreak + "天" : ""),
      } : null,
      execute: async (ctx: ToolContext) => {
        const { computePortfolioRisk } = await import("./portfolioRisk");
        const r = computePortfolioRisk({
          marketState: (ctx.marketState ?? null) as never,
          positionPnlPcts: [],
          totalCapital: 1e6,
          currentPositionValue: 0,
          concentrationPct: ctx.concentrationPct,
        });
        return { maxPositionPct: r.maxPositionPct, lossStreak: r.lossStreak, advice: r.advice };
      },
    },
    {
      name: "checkSysRisk",
      description: "系统性风险：沪深300/跌停/炸板/情绪 → red/yellow/none",
      kind: "vote",
      normalize: (r) => {
        if (!r) return null;
        const map: Record<string, Verdict> = { red: "禁止", yellow: "观望", none: "可上车" };
        return { verdict: map[r.level] ?? "观望", confidence: r.level === "red" ? 90 : r.level === "yellow" ? 65 : 50, reason: r.text ?? "" };
      },
      execute: async (ctx: ToolContext) => {
        const { checkSysRisk } = await import("./sysRiskGuard");
        const r = checkSysRisk({
          hs300Pct: null,
          limitDownCount: 0,
          blastedRate: ctx.blastedRate ?? 0,
          sentiment: ctx.sentiment ?? null,
        });
        return { level: r.level, text: r.text };
      },
    },
    {
      name: "backtestSignal",
      description: "信号回测：查历史胜率（回测门控用）",
      kind: "data",
      execute: async () => {
        const { backtestSignals } = await import("./signalBacktest");
        return await backtestSignals(14) ?? [];
      },
    },
    {
      name: "reconcileFundNews",
      description: "资金-消息对账：消息利好板块 × 资金流 → 兑现/背离/待观察",
      kind: "vote",
      normalize: (r) => r ? {
        verdict: (r.action === "可上车" ? "可上车" : r.action === "禁止" ? "禁止" : "观望"),
        confidence: r.status === "兑现" ? 72 : r.status === "背离" ? 75 : 55,
        reason: r.conclusion ?? "",
      } : null,
      execute: async (ctx: ToolContext) => {
        const { reconcileFundNews } = await import("./fundNewsReconcile");
        const r = reconcileFundNews({
          board: ctx.board ?? ctx.mainline ?? "—",
          newsScore: ctx.strengthScore ?? 50,
          todayMainNet: 0,
          streakDays: ctx.fundStreakInflow ? 2 : -1,
        });
        return { status: r.status, conclusion: r.conclusion, action: r.action };
      },
    },
    {
      name: "getFundStreak",
      description: "资金连续性：板块连续流入天数（本地服务端）",
      kind: "data",
      execute: async (ctx: ToolContext) => {
        const { buildFundStreaks } = await import("./fundStreak");
        const list = await buildFundStreaks();
        const hit = list?.find(s => s.board === ctx.board);
        return hit ? { board: hit.board, streak: hit.consecutiveInflowDays, todayNet: hit.todayMainNet } : { note: "无该板块数据（非本地或未落库）" };
      },
    },
    {
      name: "getThemeCalendar",
      description: "题材生命周期：首现日/运行天数/阶段（本地服务端）",
      kind: "data",
      execute: async () => {
        const { buildThemeCalendar } = await import("./themeCalendar");
        return await buildThemeCalendar(7) ?? [];
      },
    },
    {
      name: "detectSealDecay",
      description: "封单衰减检测：封单环比变化 → 黄/红预警",
      kind: "vote",
      normalize: (r) => {
        if (!r) return null;
        const red = Number(r.red ?? 0), yellow = Number(r.yellow ?? 0);
        if (red > 0) return { verdict: "禁止", confidence: 85, reason: red + "只封单崩落" };
        if (yellow > 0) return { verdict: "观望", confidence: 60, reason: yellow + "只封单衰减" };
        return { verdict: "可上车", confidence: 50, reason: "封单稳定" };
      },
      execute: async (ctx: ToolContext) => {
        return { red: ctx.sealRed ?? 0, yellow: ctx.sealYellow ?? 0 };
      },
    },
    {
      name: "getNewsDeep",
      description: "事件深挖（V3-14）：仅对政策级/高分事件(catalystScore>=60)触发 LLM 推演影响路径；低分事件不深挖（成本控制）",
      kind: "data",
      execute: async (ctx: ToolContext & { eventTitle?: string; catalystScore?: number; eventLevel?: string; beneficiaries?: string[] }) => {
        const score = ctx.catalystScore ?? 0;
        // 成本护栏：仅高分/政策级事件深挖，普通事件直接返回（不调 LLM）
        if (score < 60) {
          return { deep: false, note: `催化强度 ${score} 分 < 60，未触发深挖（成本控制）；可手动升级关注` };
        }
        const { callAI, parseAIJSON } = await import("./ai");
        try {
          const r = await callAI("eventDeepDive", {
            title: ctx.eventTitle ?? ctx.board ?? "未知事件",
            level: ctx.eventLevel ?? (score >= 65 ? "政策" : "行业"),
            catalystScore: score,
            beneficiaries: ctx.beneficiaries ?? [],
          });
          const j = parseAIJSON<{ chain: string; targets: Array<{ name: string; reason: string }>; risk: string; confirm: string; conclusion: string }>(r.text);
          return { deep: true, ...j };
        } catch {
          return { deep: true, chain: "LLM 深挖失败", targets: [], risk: "", confirm: "看板块主力资金", conclusion: "深挖暂不可用，按分级结果参考" };
        }
      },
    },
    {
      name: "getDecisionEvidence",
      description: "多源决策证据：汇聚各引擎输出（decisionBus 视角）",
      kind: "data",
      execute: async (ctx: ToolContext) => {
        const { collectEvidence } = await import("./decisionCollector");
        return collectEvidence({
          mainline: ctx.mainline ?? "—",
          admissionAction: (ctx.trapFlagged ? "禁止" : "可上车") as never,
          admissionConfidence: 70,
          admissionReason: "Agent 调用",
          marketState: ctx.marketState ?? "分歧震荡",
          marketFactor: ctx.marketFactor ?? 0.5,
          riskOverLimit: false,
          riskLossStreak: 0,
          riskMaxPct: 70,
          trapFlagged: ctx.trapFlagged ?? false,
          trapRate: ctx.trapFlagged ? 0.5 : 0,
          sealRedCount: ctx.sealRed ?? 0,
          sealYellowCount: ctx.sealYellow ?? 0,
          sysRiskLevel: ctx.riskLevel ?? "none",
          lhbBoost: ctx.lhbBoost ?? false,
          fundStreakInflow: ctx.fundStreakInflow ?? false,
        });
      },
    },
    {
      // v9.43：因子健康度 —— 幻方"因子会失效"喂给 AI（决策前必查：失效因子支撑的看好理由要打折）
      name: "factorHealth",
      description: "因子健康度：查全部因子近10交易日滚动IC → 失效/方向反转清单 + 置信扣分建议（失效占比≥50%扣15、≥30%扣8）。决策前建议调用：若支撑你'可上车'的因子正失效，应下调置信甚至观望。",
      kind: "data",
      execute: async () => evaluateFactorHealth(),
    },
  ];
  return cachedTools;
}
