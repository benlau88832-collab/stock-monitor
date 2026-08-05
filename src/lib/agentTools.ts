// ============================================================
// v9.38（V3-1）：Agent 工具注册表
// 把现有 16+ 决策/数据函数包装成工具描述符（name/desc/execute）。
// execute 直接调现有纯函数，不触发额外 LLM 调用（省 token 设计）。
// 供 V3-2 aiAgent 主循环调用（"AI 调工具查数据，而不是闭眼判断"）
// ============================================================

export interface AgentTool<TResult = unknown> {
  name: string;
  description: string;
  /** 执行函数：纯规则/数据查询，禁止内部再调 LLM */
  execute: (args: any) => Promise<TResult> | TResult;
}

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

export function getAgentTools(): AgentTool[] {
  if (cachedTools) return cachedTools;
  cachedTools = [
    {
      name: "getAdmissionVerdict",
      description: "最终准入闸：强度×阶段×闸门×梯队 → 可上车/观望/禁止",
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
      execute: async () => {
        const { backtestSignals } = await import("./signalBacktest");
        return await backtestSignals(14) ?? [];
      },
    },
    {
      name: "reconcileFundNews",
      description: "资金-消息对账：消息利好板块 × 资金流 → 兑现/背离/待观察",
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
      execute: async () => {
        const { buildThemeCalendar } = await import("./themeCalendar");
        return await buildThemeCalendar(7) ?? [];
      },
    },
    {
      name: "detectSealDecay",
      description: "封单衰减检测：封单环比变化 → 黄/红预警",
      execute: async (ctx: ToolContext) => {
        return { red: ctx.sealRed ?? 0, yellow: ctx.sealYellow ?? 0 };
      },
    },
    {
      name: "getNewsDeep",
      description: "事件深挖（V3-14）：仅对政策级/高分事件(catalystScore>=60)触发 LLM 推演影响路径；低分事件不深挖（成本控制）",
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
  ];
  return cachedTools;
}
