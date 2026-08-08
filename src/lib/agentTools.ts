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
  /** v9.75（P0-1 修复）：真实市场数据注入 —— 此前 checkSysRisk 硬编码 hs300Pct=null/limitDownCount=0，系统性风险判断被阉割 */
  hs300Pct?: number | null;
  limitDownCount?: number;
  /** v9.75（P0-1 修复）：真实个股数据注入（decideForStock 场景）—— 此前 checkExitSignal/checkStockExitSignal 硬编码假成本/假资金 */
  price?: number;
  pct?: number;
  sealFund?: number;
  amount?: number;
  mainNet?: number;
  mainNetPct?: number;
  retailNetPct?: number;
  mainNet5d?: number;
  mainNet10d?: number;
}

/** v9.75（P0-1 修复）：工具缺数据时的显式标记 —— 替代"喂假数字"（假数据会被 LLM 当真引用，AI 结论失真） */
export interface DataMissingResult {
  dataMissing: true;
  missing: string[];
  note: string;
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
  /** v9.44（③）：已自动反向的因子名（连续反转≥3日） */
  flippedFactors: string[];
  /** v9.44（③）：已退役的因子名（连续真失效≥5日） */
  retiredFactors: string[];
  /** 按 decisionBus 规则：0 / 8 / 15 */
  penalty: number;
  summary: string;
  /** v9.75（阶段二）：失效因子 LLM 归因（为什么失效 + 退役/反向建议；LLM 不可用或全健康时为 null） */
  attribution?: string | null;
}

export async function evaluateFactorHealth(): Promise<FactorHealthReport | null> {
  try {
    const { loadFactorIcHistory, loadFactorRows } = await import("./factorHistory");
    const { FACTORS, markNextWin, evaluateFactorIcSeries, resolveAutoStates } = await import("./factorLib");
    let items: FactorHealthReport["items"] = [];
    let seriesMap: Record<string, unknown[]> = {};

    // 1. 主数据源：PG 快照（server cron 每日落库，含最新一天的 IC/失效/反转）
    try {
      const hist = await loadFactorIcHistory(30);
      if (hist && hist.dates.length >= 1) {
        const pts = new Map<string, { ic: number; samples: number; decayed: boolean; reversed?: boolean }>();
        for (const f of FACTORS) {
          const series = hist.byFactor[f.name];
          const cur = series && series.length > 0 ? series[series.length - 1] : null;
          if (cur) pts.set(f.name, { ic: cur.ic, samples: cur.samples, decayed: cur.decayed, reversed: cur.reversed });
          if (series && series.length > 0) seriesMap[f.id] = series; // 完整序列 → 自动处置判定
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
      seriesMap = series;
    }

    // v9.44（③）：自动处置判定 —— 连续反转≥3日自动反向 / 连续真失效≥5日退役
    const auto = seriesMap && Object.keys(seriesMap).length > 0
      ? resolveAutoStates(seriesMap as Record<string, import("./factorLib").FactorIcPoint[]>)
      : [];
    const flippedFactors = auto.filter(a => a.flipped).map(a => a.name);
    const retiredFactors = auto.filter(a => a.retired).map(a => a.name);

    const total = items.length;
    const decayedCount = items.filter(i => i.decayed).length;
    const reversedCount = items.filter(i => !i.decayed && i.reversed).length;
    const ratio = total >= 3 ? decayedCount / total : 0;
    const penalty = ratio >= 0.5 ? 15 : ratio >= 0.3 ? 8 : 0;
    const autoNote = [
      flippedFactors.length > 0 ? `${flippedFactors.length} 因子已自动反向(${flippedFactors.join("、")})` : "",
      retiredFactors.length > 0 ? `${retiredFactors.length} 因子已退役(${retiredFactors.join("、")})` : "",
    ].filter(Boolean).join("；");
    const summary = `${total}因子中 ${decayedCount} 失效${reversedCount > 0 ? `、${reversedCount} 方向反转` : ""}（失效占比 ${Math.round(ratio * 100)}%）${penalty > 0 ? ` → 置信度应扣 ${penalty} 分` : "，未触发置信扣减"}${autoNote ? `；${autoNote}` : ""}`;
    return { date: null, window: 10, items, decayedCount, reversedCount, total, flippedFactors, retiredFactors, penalty, summary };
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
        // v9.64（V2-P0-3）：真实资金地基 —— totalCapital 用 discipline 设置，不再硬编码 1e6（假数据算真仓位=地基沙子）
        // v9.77（P0-15 修复）：单票/总仓上限、当前持仓%、今日开仓 全部读真实纪律，替代硬编码 30%/100%/0
        let discipline = { maxSinglePct: 30, maxTotalPct: 100, maxNewPositionsPerDay: 3, totalCapital: 1000000, cooldownLossStreak: 3 };
        let currentTotalPct = 0;
        try {
          const { loadDisciplineState } = await import("./discipline");
          const ds = loadDisciplineState();
          if (ds.settings) discipline = { ...discipline, ...ds.settings };
          currentTotalPct = ds.positions.length > 0
            ? Math.min(100, ds.positions.reduce((s, p) => s + (p.value ?? 0), 0) / Math.max(1, discipline.totalCapital) * 100)
            : 0;
        } catch { /* 读不到设置时保持默认 */ }
        const r = computePositionAdvice({
          mainline: ctx.mainline ?? "—",
          strengthScore: ctx.strengthScore ?? null,
          stage: (ctx.stage ?? "观察中") as never,
          gate: { mode: (ctx.gateMode ?? "empty") as never, factor: ctx.marketFactor ?? 0.5, positionLimit: 100, riskLevel: "low", label: "Agent", reason: [] },
          discipline,
          currentTotalPct,
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
        if (!r || r.dataMissing) return null; // v9.75：缺数据不投票（原来喂假数据 → 离场检查假阳性/假阴性）
        const map: Record<string, Verdict> = { red: "禁止", yellow: "观望", none: "可上车" };
        return { verdict: map[r.level] ?? "观望", confidence: r.level === "red" ? 85 : r.level === "yellow" ? 60 : 50, reason: (r.reasons ?? []).join("；").slice(0, 50) };
      },
      execute: async (ctx: ToolContext) => {
        // v9.75（P0-1 修复）：主线级决策无真实个股（原硬编码 600000/成本10/资金0 → LLM 引用假数字）。
        // 现在：调用方注入真实个股数据（decideForStock）才算；否则显式 dataMissing 提示 LLM。
        const missing = [];
        if (ctx.price == null || ctx.mainNet == null) missing.push("个股实时行情/资金");
        if (missing.length > 0) {
          return { dataMissing: true as const, missing, note: "主线级决策未注入个股数据，跳过离场检查" };
        }
        const { checkStockExit } = await import("./stockExit");
        const r = checkStockExit({
          code: ctx.code ?? "?", name: "标的",
          cost: null, // 无持仓成本信息 → 不触发成本止损规则（诚实的 null，而非假成本）
          price: ctx.price!, pct: ctx.pct ?? 0,
          mainNetPct: ctx.mainNetPct ?? 0, retailNetPct: ctx.retailNetPct ?? 0,
          mainNet: ctx.mainNet ?? 0, mainNet5d: ctx.mainNet5d ?? 0, mainNet10d: ctx.mainNet10d ?? 0,
          sealFund: ctx.sealFund ?? 0, amount: ctx.amount ?? 0,
          leaderAlive: true, isLeader: false, mainline: ctx.mainline ?? "",
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
        // v9.64（V2-P0-3）：真实资金地基 —— 持仓市值/总资金来自 discipline，不再硬编码 0/1e6
        let totalCapital = 1000000, currentPositionValue = 0;
        try {
          const { loadDisciplineState } = await import("./discipline");
          const ds = loadDisciplineState();
          if (ds.settings && ds.settings.totalCapital > 0) totalCapital = ds.settings.totalCapital;
          currentPositionValue = ds.positions.reduce((s, p) => s + (p.value ?? 0), 0);
        } catch { /* 读不到设置时保持默认 */ }
        const r = computePortfolioRisk({
          marketState: (ctx.marketState ?? null) as never,
          positionPnlPcts: [],
          totalCapital,
          currentPositionValue,
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
        if (!r || r.dataMissing) return null; // v9.75：缺数据不投票（原来 hs300=null/跌停=0 → red 判定被阉割）
        const map: Record<string, Verdict> = { red: "禁止", yellow: "观望", none: "可上车" };
        return { verdict: map[r.level] ?? "观望", confidence: r.level === "red" ? 90 : r.level === "yellow" ? 65 : 50, reason: r.text ?? "" };
      },
      execute: async (ctx: ToolContext) => {
        // v9.75（P0-1 修复）：原硬编码 hs300Pct=null、limitDownCount=0 → 系统性风险 red 判定永远失效；
        // 现在要求调用方注入真实市场数据（Dashboard decisionSources 已具备），缺失则显式 dataMissing
        if (ctx.hs300Pct == null || ctx.limitDownCount == null) {
          return {
            dataMissing: true as const,
            missing: ctx.hs300Pct == null ? ["沪深300涨跌"] : ["跌停家数"],
            note: "缺少真实市场数据（沪深300/跌停家数），系统性风险判定降级",
          };
        }
        const { checkSysRisk } = await import("./sysRiskGuard");
        const r = checkSysRisk({
          hs300Pct: ctx.hs300Pct,
          limitDownCount: ctx.limitDownCount,
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
        // v9.77（P0-13 修复）：此前 todayMainNet 硬编码 0 → 强利好主线永远命中
        //   "消息利好但主力净流出"→ 观望/禁止，资金-消息对账引擎结构性判负。
        //   现从 fund_streak 真实落库读该板块今日主力净额 + 连续流入天数；非本地/未落库回退 ctx.mainNet。
        let todayMainNet = ctx.mainNet ?? 0;
        let streakDays = ctx.fundStreakInflow ? 2 : -1;
        try {
          const { buildFundStreaks } = await import("./fundStreak");
          const list = await buildFundStreaks();
          const hit = list?.find(s => s.board === (ctx.board ?? ctx.mainline));
          if (hit) {
            if (hit.todayMainNet != null) todayMainNet = hit.todayMainNet;
            if (hit.consecutiveInflowDays != null) streakDays = hit.consecutiveInflowDays;
          }
        } catch { /* 非本地/未落库 → 用 ctx 兜底 */ }
        const r = reconcileFundNews({
          board: ctx.board ?? ctx.mainline ?? "—",
          newsScore: ctx.strengthScore ?? 50,
          todayMainNet,
          streakDays,
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
      execute: async () => {
        const report = await evaluateFactorHealth();
        // v9.75（阶段二）：失效因子 LLM 归因层 —— 纯统计只给"失效"，不解释"为什么失效"。
        // 对当日失效/反转因子做一次轻量 LLM 归因（日级缓存防重复计费，失败静默不影响主流程）
        if (report && (report.decayedCount > 0 || report.reversedCount > 0)) {
          try {
            const cacheKey = `factor_attr:${report.date ?? new Date().toISOString().slice(0, 10)}`;
            const cached = localStorage.getItem(cacheKey);
            let attribution: string | null = null;
            if (cached) {
              try {
                const j = JSON.parse(cached);
                if (j && Date.now() - (j.ts ?? 0) < 24 * 3600 * 1000) attribution = j.text;
              } catch { /* 缓存损坏忽略 */ }
            }
            if (!attribution) {
              const { callAI, parseAIJSON } = await import("./ai");
              const decayedList = report.items.filter(i => i.decayed || i.reversed).map(i => `${i.name}(IC=${i.ic != null ? i.ic.toFixed(3) : "?"},样本${i.samples})`).join("、");
              const r = await callAI("factorAttribution", { prompt: `以下A股短线因子近期失效/方向反转（滚动IC接近0或与预期方向相反）。结合当前市场环境，给出最可能的失效原因（如：情绪因子在震荡市钝化/封单数据口径变化/样本不足等），并建议是否需要退役或反向使用。\n失效因子：${decayedList}`, });
              const j = parseAIJSON<{ summary: string; suggestions: string[] }>(r.text);
              attribution = j?.summary ? `${j.summary}${(j.suggestions ?? []).length ? `（建议：${j.suggestions.slice(0, 2).join("；")}）` : ""}` : null;
              if (attribution && !r.degraded) {
                try { localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), text: attribution })); } catch { /* 存储满忽略 */ }
              }
            }
            if (attribution) report.attribution = attribution;
          } catch { /* LLM 归因失败不影响健康度报告 */ }
        }
        return report;
      },
    },
    // v11-6（P1）：数据缺失主动推断 —— 不要因缺字段拒绝裁决
    estimateMissingFields,
  ];
  return cachedTools;
}

// ============== v9.57（V8-4）：个股级 Agent 工具集 ==============
// decideForStock 升级 ReAct 用：资金面（fetchStockOne）+ 诱多（detectTrap）+ 离场（checkStockExit）
// 真实数据注入（非 ctx），让个股 AI 与主线 AI 同深度
export interface StockToolInput {
  code: string; name: string; pct: number;
  sealFund: number; amount: number; blastCount: number;
  mainline: string; stage: string; boardCount: number;
}

// ============== v11-6（P1）：数据缺失主动推断工具 ==============
// 目标：AI 不再因字段缺失"罢工"——用已有数据推断缺失值并在返回中标注"推断"
const estimateMissingFields: AgentTool = {
  name: "estimateMissingFields",
  description: "数据缺失时用已有数据推断缺失字段（不因此拒绝裁决）：传 {turnoverRate?, boardPct?, promotionRate?, ztYesterday?, ztToday?, mainNet5d?, mainNet10d?} —— 换手率缺失用板块涨幅推断(涨>5%≈12%/涨>2%≈8%/其他4%)；晋级率缺失用昨日/今日涨停对比推断；10日资金缺失用5日资金×1.8近似。返回推断值+推断依据（reason 里标注'基于部分数据推断'）",
  kind: "data",
  execute: async (args: any) => {
    const out: Record<string, unknown> = { ...args };
    const inferred: string[] = [];
    // 换手率：板块涨幅 + 量价推断（涨>5%+放量≈换手8-15%）
    if (args.turnoverRate == null && args.boardPct != null) {
      out.turnoverRate = args.boardPct > 5 ? 12 : args.boardPct > 2 ? 8 : 4;
      inferred.push(`换手率(板块涨幅${args.boardPct}%推断≈${out.turnoverRate}%)`);
    }
    // 晋级率：昨日涨停 → 今日涨停池对比
    if (args.promotionRate == null && args.ztYesterday != null && args.ztToday != null) {
      out.promotionRate = args.ztYesterday > 0 ? Math.round((args.ztToday / args.ztYesterday) * 100) / 100 : 0.2;
      inferred.push(`晋级率(昨日${args.ztYesterday}→今日${args.ztToday}推断≈${out.promotionRate})`);
    }
    // 10日资金：5日资金 × 1.8 近似
    if (args.mainNet10d == null && args.mainNet5d != null) {
      out.mainNet10d = Math.round(Number(args.mainNet5d) * 1.8);
      inferred.push(`10日资金(5日×1.8近似≈${out.mainNet10d})`);
    }
    return { ...out, inferred, note: "基于部分数据推断（非真实值），仅供参考" };
  },
};

export function getStockAgentTools(stock: StockToolInput): AgentTool[] {
  return [
    // v11-6（P1）：个股 Agent 同样可推断缺失字段
    estimateMissingFields,
    {
      name: "getStockFund",
      description: "个股资金面：主力净流入(元/占比)/5日/10日/换手/量比（fetchStockOne 实时）",
      kind: "data",
      execute: async () => {
        try {
          const { fetchStockOne } = await import("./api");
          const d = await fetchStockOne(stock.code);
          if (!d) return { error: "个股行情获取失败" };
          return {
            code: d.code, name: d.name, price: d.price, pct: d.pct,
            mainNet: d.mainNet, mainNetPct: d.mainNetPct,
            mainNet5d: d.mainNet5d, mainNet5dPct: d.mainNet5dPct,
            mainNet10d: d.mainNet10d,
            turnoverRate: d.turnoverRate, volumeRatio: d.volumeRatio,
            extraLargeNet: d.extraLargeNet, largeNet: d.largeNet, smallNet: d.smallNet,
          };
        } catch (e) { return { error: `资金查询失败:${e}` }; }
      },
    },
    {
      name: "detectStockTrap",
      description: "个股诱多检测：封单/成交比、炸板次数、涨幅 → 是否诱多出货特征",
      kind: "vote",
      normalize: (r) => r && r.isTrap ? { verdict: "禁止", confidence: Math.round((r.confidence ?? 50) + 20), reason: `诱多特征(${r.type})` } : null,
      execute: async () => {
        const { detectTrap } = await import("./trapDetector");
        const r = detectTrap({
          code: stock.code, name: stock.name, pct: stock.pct,
          sealFund: stock.sealFund, amount: stock.amount, blastCount: stock.blastCount,
          isMainline: true,
        });
        return { isTrap: r.isTrap, type: r.type, confidence: r.confidence };
      },
    },
    {
      name: "checkStockExitSignal",
      description: "个股离场信号：7 条规则（成本/主力结构/封单）→ red/yellow/none",
      kind: "vote",
      normalize: (r) => {
        if (!r || r.dataMissing) return null; // v9.75：缺数据不投票
        return r ? { verdict: r.level === "red" ? "禁止" : r.level === "yellow" ? "观望" : "可上车", confidence: r.level === "red" ? 85 : r.level === "yellow" ? 60 : 50, reason: (r.reasons ?? []).join("；").slice(0, 50) } : null;
      },
      execute: async () => {
        // v9.75（P0-1 修复）：原硬编码 cost=10/price=10/mainNet=0 → 离场信号失真。
        // 现在用真实行情：fetchStockOne 实时拉资金/价格（getStockFund 同源），成本无持仓信息 → 诚实 null
        let real: Awaited<ReturnType<typeof import("./api").fetchStockOne>> | null = null;
        try {
          const { fetchStockOne } = await import("./api");
          real = await fetchStockOne(stock.code);
        } catch { /* 拉取失败走 dataMissing */ }
        if (!real) {
          return { dataMissing: true as const, missing: ["个股实时行情/资金"], note: "行情拉取失败，跳过离场检查" };
        }
        // v9.60 语义：关键资金字段缺失 → 视为数据缺失，不喂 0 给规则（0 会触发"持续净流出"误报）
        if ((real as { dataMissing?: boolean }).dataMissing) {
          return { dataMissing: true as const, missing: ["关键资金字段"], note: "东财资金字段缺失，跳过离场检查" };
        }
        const { checkStockExit } = await import("./stockExit");
        const r = checkStockExit({
          code: stock.code, name: stock.name,
          cost: null, // 无持仓成本 → 不触发成本止损（诚实 null，非假成本 10）
          price: real.price, pct: real.pct,
          mainNetPct: real.mainNetPct ?? 0, retailNetPct: 0,
          mainNet: real.mainNet ?? 0, mainNet5d: real.mainNet5d ?? 0, mainNet10d: real.mainNet10d ?? 0,
          sealFund: stock.sealFund, amount: stock.amount,
          leaderAlive: true, isLeader: stock.boardCount >= 2,
          mainline: stock.mainline,
        });
        return { level: r.level, reasons: r.reasons };
      },
    },
  ];
}
