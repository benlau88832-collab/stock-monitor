import { useState, useEffect, useMemo } from "react";
import MarketOverview from "./MarketOverview";
// v9.95.1（第五段 P2）：情绪周期雷达卡重新接线 —— v9.48 移除成死代码，验收缺口"周期阶段化（进度条 5 段）"补回
import EmotionCycleCard from "./EmotionCycleCard";
// v9.96.0（批次 1）：市场情绪 Widget + 叙事报告（VibeAlpha）
import MarketEmotionWidget from "./MarketEmotionWidget";
import EmotionReportPanel from "./EmotionReportPanel";
import type { EmotionCycleInput } from "../lib/emotionCycle";
import DisciplinePanel from "./DisciplinePanel";
import ReviewPanel from "./ReviewPanel";
import PortfolioReportPanel from "./PortfolioReportPanel";
import FiveQBar from "./FiveQBar";
import DailySummary from "./DailySummary";
import SignalPanel from "./SignalPanel";
// v9.35（S3）：信号有效性回测面板
import SignalEffectivenessPanel from "./SignalEffectivenessPanel";
// v9.106.0（第六批 B，T-B4）：主线级回测面板
import MainlineBacktestPanel from "./MainlineBacktestPanel";
// v9.42：因子健康度面板（幻方"因子失效"IC 曲线可视化）
import FactorHealthPanel from "./FactorHealthPanel";
// v9.65（V2-P2）：运维可观测面板
import OpsPanel from "./OpsPanel";
// v9.44（②/④）：决策审计时间线 + 信号净值曲线
import DecisionAuditPanel from "./DecisionAuditPanel";
import SignalEquityPanel from "./SignalEquityPanel";
// v9.137.0（审查 P2-05）：待你拍板任务条
import PendingVerdictBar from "./PendingVerdictBar";
// v9.137.0（审查 P2-06）：我的画像卡
import UserProfileCard from "./UserProfileCard";
// v9.36（A2）：竞价强度榜
// v9.36（A3）：龙虎榜×涨停池交叉
import LhbCrossPanel from "./LhbCrossPanel";
// P1-3：极简盯盘皮肤（盘中 3 秒扫一眼）
import SimpleWatchSkin, { type TopMainlineBrief, type WatchAlertBrief } from "./SimpleWatchSkin";
// v9.49（N1）：EventClassifyPanel 已移到"消息面"Tab（事件研判归消息面），Dashboard 不再引用
// v9.38.1（V3-12）：读 kv 事件分级数据（决策消息面证据源）
import { isLocalServer, kvGet, kvSet } from "../lib/cloudStore";
// v9.37（V3-4/7）：AI 终裁决（多源共识）
import DecisionVerdictCard from "./DecisionVerdictCard";
import { SwingVerdictCard } from "./SwingVerdictCard";
import { usePortfolio } from "../hooks/usePortfolio";
import { collectEvidence } from "../lib/decisionCollector";
import { classifyMarketState } from "../lib/marketStateMachine";
import { checkSysRisk } from "../lib/sysRiskGuard";
import { evaluateAdmission } from "../lib/admissionGate";
import { stageOfStrength } from "../lib/stageModel";
// v9.47（V6-L1）：决策证据接回真实数据 —— 组合风险从纪律持仓算、资金连续流入从 fundStreak 读
import { computePortfolioRisk } from "../lib/portfolioRisk";
import { loadDisciplineState } from "../lib/discipline";
// v9.38（V3-2/3）：AI 决策 Agent（手动触发深审）
import { decideForMainline, type AgentVerdict } from "../lib/aiAgent";
import InstitutionFund from "./InstitutionFund";
import Playbook from "./Playbook";
import PopularityRadar from "./PopularityRadar";
// v9.138.0（阶段二：#14）：展示型组件拆入 dashboard/ 子目录（领域组件层），容器只留状态与布局
import { IndexStrip, LimitTempBar, PositionMatchStrip, AnomalyStrip, GateGauge, ImportantFeed, AlertFeed, LadderMini, type WatchStockBrief } from "./dashboard/DashboardWidgets";
export type { WatchStockBrief } from "./dashboard/DashboardWidgets"; // 兼容 App/hooks 既有导入

// v9.26.11：建议动作颜色（轻仓/重仓参与=积极红；观察=黄；禁止/无需=灰）
import LadderPulse from "./LadderPulse";
import WeeklyCoach from "./WeeklyCoach";
import BattlePlan, { type BattlePlanData } from "./BattlePlan";
// v9.52（V7-3）：今日上车标的清单（决策区下方、BattlePlan 之后）
import StockPickList from "./StockPickList";
// v11-4（P1）：GlobalSignals 移出驾驶舱 → fundline Tab"🌐外围信号"（App.tsx 已渲染，此处不再 import）
// v11-5（P1）：事件三级研判回驾驶舱
import { localDateStr } from "../lib/format";
import type { OverviewData, FundStructureData, GlobalData, MainlineData } from "../App";
import type { SessionPhase } from "../lib/tradingSession";
// v9.55-fix（V7-19）：北京时间交易日历（loadFactorRows 回看日期）
import { isTradingDay, bjDateStr } from "../lib/tradeCalendar";
// v9.24-P1-4：异动捕捉引擎（S/A/B 分级 + 事件流）
import { useRef } from "react";
import { subscribeAnomaly, getAnomalies, type AnomalyEvent } from "../lib/anomalyTier";
import { apiFetch } from "../lib/cloudStore";

// ============== 自选股异动项 ==============
// v9.84（性能）：因子行缓存（10min）—— loadFactorRows 跨挂载/跨 effect 共享，首屏不再反复打 40+ kv
let factorRowsCache: Array<{ date: string; sentiment: number | null; blastedRate: number | null; ztCount: number | null; maxBoardHeight: number | null; premiumAvg: number | null; promotionRate: number | null; sealDecayCount: number | null; lhbBoostCount: number | null; fundInflowStreak: number | null; nuclearCount: number | null }> | null = null;
let factorRowsCacheTs = 0;
const FACTOR_ROWS_TTL = 10 * 60 * 1000;


// ============== Props ==============
interface DashboardProps {
  overview: OverviewData | null;
  fund: FundStructureData | null;
  globalData?: GlobalData | null;
  mainline?: MainlineData | null;
  battlePlan?: BattlePlanData | null;
  /** v9.135.0（阶段三）：认知层主线（作战卡一致性徽标） */
  cognMainline?: string;
  loading: boolean;
  phase?: SessionPhase;
  watchStocks?: WatchStockBrief[];
  /** v9.24-P1-4：今日主线名（异动分级"呼应主线"判断用） */
  mainlines?: string[];
  onSwitchTab?: (tab: string) => void;
  /** v9.19-F2：今日涨停池（竞价台用） */
  /** v9.19-F2：昨日涨停股（竞价台用） */
  yesterdayZt?: Array<{ code: string; name: string }>;
  /** v9.33（缺口3）：LLM 盘后三剧本 / 竞价龙头预判 / 风险雷达 */
  nextScenarios?: Array<{ scenario: string; probability: number; conditions: string[]; focus: string[] }> | null;
  riskRadarText?: string | null;
  /** v9.75（阶段二）：次日闸门预测 */
  nextGatePredict?: { nextGate: string; reason: string; watchPoints: string[] } | null;
  /** v9.34（S1）：封单衰减预警（终裁决证据源） */
  sealAlerts?: Array<{ level: "yellow" | "red" }> | null;
  /** v9.99.2（B3）：盘后四任务 LLM 降级标记（三剧本/闸门/风险雷达/龙一预判）—— 规则版兜底不得伪装 AI */
  llmBriefDegraded?: Record<string, boolean>;
}

export default function Dashboard({
  overview, fund, globalData, mainline, battlePlan, loading, cognMainline,
  phase: phaseProp = "post", watchStocks = [], mainlines = [], onSwitchTab, yesterdayZt,
  nextScenarios = null, riskRadarText = null, sealAlerts = null, nextGatePredict = null,
  llmBriefDegraded = {},
}: DashboardProps) {
  // v9.19-fix：默认值字面量导致类型收窄，显式拓宽回联合类型
  const phase: SessionPhase = phaseProp;
  // P1-3：极简盯盘皮肤 —— trading 阶段默认开启（3 秒扫一眼），可切换回深度视图
  const [simpleSkin, setSimpleSkin] = useState<boolean>(() => {
    try { return localStorage.getItem("simple_skin_default_on") === "1"; } catch { return false; }
  });
  const [watchAlerts, setWatchAlerts] = useState<WatchAlertBrief[]>([]);
  // trading 阶段且用户未设置过偏好 → 默认开启极简皮肤
  useEffect(() => {
    if (phase === "trading" && !localStorage.getItem("simple_skin_default_on")) {
      setSimpleSkin(true);
      try { localStorage.setItem("simple_skin_default_on", "1"); } catch { /* 静默 */ }
    }
  }, [phase]);
  // 拉盯价偏离（供极简皮肤自选预警卡使用；失败静默）
  useEffect(() => {
    if (!simpleSkin) return;
    let alive = true;
    (async () => {
      try {
        const r = await apiFetch("/api/watch/list");
        const j = await r.json();
        if (!alive) return;
        const items: Array<{ code: string; name: string; deviation: number | null }> = j?.items ?? [];
        setWatchAlerts(
          items
            .filter(x => x.deviation != null && Math.abs(x.deviation) > 0)
            .map(x => ({ code: x.code, name: x.name || x.code, deviationPct: Math.round((x.deviation ?? 0) * 10) / 10 }))
            .slice(0, 10),
        );
      } catch { /* 服务端不可用静默 */ }
    })();
    const t = setInterval(() => { /* 30s 刷新由外部 PriceWatchPanel 负责，此皮肤读快照即可 */ }, 30000);
    return () => { alive = false; clearInterval(t); };
  }, [simpleSkin]);
  // v9.45.1：面板展开状态持久化 —— 刷新/重开页面保持用户上次展开的面板（不再"神秘消失"）
  const PANEL_PREF_KEY = "dashboard_panels_pref";
  const loadPanelPref = (): Record<string, boolean> => {
    try { return JSON.parse(localStorage.getItem(PANEL_PREF_KEY) ?? "{}"); } catch { return {}; }
  };
  const [panelPref] = useState(loadPanelPref); // 惰性初始化，仅首帧读取
  const portfolio = usePortfolio();
  // 修复：原代码只在组件首次挂载时算一次 phase，phase 改变时不会重新打开 AI 复盘
  const [showAI, setShowAI] = useState(panelPref.showAI ?? phase === "post");
  const [showSignal, setShowSignal] = useState(Boolean(panelPref.showSignal));
  // v9.35（S3）：信号有效性回测面板
  const [showSignalEffect, setShowSignalEffect] = useState(Boolean(panelPref.showSignalEffect));
  // v9.42：因子健康度面板（幻方"因子失效"IC 曲线）
  const [showFactorHealth, setShowFactorHealth] = useState(Boolean(panelPref.showFactorHealth));
  // v9.106.0（第六批 B，T-B4）：主线级回测面板（zt_snapshot 板块延续胜率）
  const [showMainlineBt, setShowMainlineBt] = useState(false);
  // v9.44（②/④）：决策审计 + 信号净值
  const [showAudit, setShowAudit] = useState(Boolean(panelPref.showAudit));
  const [showEquity, setShowEquity] = useState(Boolean(panelPref.showEquity));
  // v9.48（D3）：盘后预演（风险雷达 + 明日三剧本 + 每日复盘）—— 盘中默认收起
  const [showPreview, setShowPreview] = useState(Boolean(panelPref.showPreview));
  // 任何 toggle 变化 → 写回 localStorage（跨刷新保持）
  useEffect(() => {
    try { localStorage.setItem(PANEL_PREF_KEY, JSON.stringify({ showAI, showSignal, showSignalEffect, showFactorHealth, showAudit, showEquity, showPreview })); } catch { /* 静默 */ }
  }, [showAI, showSignal, showSignalEffect, showFactorHealth, showAudit, showEquity, showPreview]);
  useEffect(() => {
    // 当 phase 变到 post 时自动打开 AI 复盘（盘后场景）
    if (phase === "post") setShowAI(true);
  }, [phase]);

  // v9.48（D5）：单一布局收敛 —— 不再需要 isTrading/isPost 独立布局（相位只做强调点）
  const gate = battlePlan?.gate ?? null;

  // v9.38（V3-2/3）：Agent 深审 —— v9.39 起自动主导（5 分钟节流）+ 保留手动按钮
  // v9.41（V4-E）：覆盖 Top-3 主线（每条一个 AI 裁决，共享节流）
  const [agentResults, setAgentResults] = useState<Array<{ mainline: string; verdict: AgentVerdict; snap: { strengthScore: number; ztCount: number } }>>([]);
  const [agentLoading, setAgentLoading] = useState(false);
  const agentLastRunRef = useRef(0); // 自动触发节流（5 分钟）
  // v9.84（性能）：龙虎榜交叉/资金连续流入检查 60s 节流（原依赖 rawZTPool 引用被 18s 快刷触发级联）
  const crossCheckAtRef = useRef(0);
  // v11-3（P0）：上次裁决 action（变化提示用）—— ref 在 setAgentResults 前存旧值
  const lastActionRef = useRef<string | null>(null);
  const runAgent = async (auto = false) => {
    // v9.82（性能/配额）：自动模式只在盘中（trading/auction）跑 ——
    // 休市/盘后（周末、收盘后）不空转烧 Agnes 配额（免费版每日限流，避免 429 拖垮其他 AI 功能）；
    // 手动按钮不受限
    if (auto && phase !== "trading" && phase !== "auction") return;
    // v9.45（V5-1）：自动触发只覆盖 Top-1（最强主线，把单周期 ~18 次调用降到 ~6）；
    // 手动按钮才覆盖 Top-3 全量
    const cands = battlePlan?.candidates?.slice(0, auto ? 1 : 3) ?? [];
    if (cands.length === 0 || agentLoading) return;
    // 自动触发节流：5 分钟内不重复跑（省配额）；手动按钮不受限
    if (auto) {
      // v9.77（P0-7 修复）：主线切换 → 跳过 5 分钟节流立即复裁。
      // 原实现节流检查在数据变化检查之前，盘中主线切换要等满 5 分钟才重跑，
      // 导致"9:38 主线切换 → 9:35 旧裁决仍置顶到 9:45"的时效脱节。
      const switched = agentResults.length > 0 && agentResults[0].mainline !== cands[0]?.mainline;
      if (!switched) {
        const now = Date.now();
        if (now - agentLastRunRef.current < 5 * 60 * 1000) return;
        agentLastRunRef.current = now;
        // v11-3（P0）：数据未显著变化时复用上次裁决（防前后矛盾）
        // 判据：强度分变化 <10 且 涨停数变化 <3 → 保持上次结果，不重跑 Agent
        if (agentResults.length > 0) {
          const last = agentResults[0];
          const top0 = cands[0];
          const scoreDelta = Math.abs((top0.strengthScore ?? 0) - (last.snap?.strengthScore ?? 0));
          const ztDelta = Math.abs((top0.ztCount ?? 0) - (last.snap?.ztCount ?? 0));
          if (scoreDelta < 10 && ztDelta < 3) return;
        }
      } else {
        agentLastRunRef.current = Date.now(); // 记录本轮时间，避免切换后连刷
      }
    }
    setAgentLoading(true);
    if (!auto) setAgentResults([]);
    const prevAction = agentResults[0]?.verdict.action ?? null;
    const results: Array<{ mainline: string; verdict: AgentVerdict; snap: { strengthScore: number; ztCount: number } }> = [];
    for (const top of cands) {
      try {
        const r = await decideForMainline(
          { mainline: top.mainline, strengthScore: top.strengthScore, ztCount: top.ztCount, height: top.height, exitSignal: top.exitSignal },
          // v9.75（P0-1 修复）：注入真实市场数据 —— 此前 Agent 工具 checkSysRisk 硬编码
          // hs300Pct=null/limitDownCount=0，系统性风险 red 判定永远失效（AI 决策建立在沙子上）。
          // decisionSources 已聚合 overview 真实值，这里透传给 Agent 工具层。
          {
            trapFlagged: false,
            // v9.100.0（P2-03）：marketFactor 接真实情绪分（0-100 归一 0.1-0.9）—— 原硬编码 0.6/0.5 恒定两值，
            //   系统性风险判定与实际市场状态脱钩（审查：市场状态 confidence 判断恒真/恒假）
            marketFactor: overview?.sentiment != null && Number.isFinite(overview.sentiment)
              ? Math.max(0.1, Math.min(0.9, overview.sentiment / 100))
              : 0.5,
            hs300Pct: overview?.indices?.find((i: any) => i.code === "000300")?.pct ?? null,
            limitDownCount: overview?.limitPool?.limitDownCount ?? 0,
            blastedRate: overview?.limitPool?.blastedRate ?? 0,
            sentiment: overview?.sentiment ?? null,
            sealRed: (sealAlerts ?? []).filter(a => a.level === "red").length,
            sealYellow: (sealAlerts ?? []).filter(a => a.level === "yellow").length,
            ztCount: overview?.limitPool?.limitUpCount ?? 0,
            premiumAvg: overview?.premiumAvg ?? null,
            // v9.77（P0-13 修复）：注入该主线真实主力净额/5日净额 —— reconcileFundNews 资金-消息对账
            //   不再拿硬编码 0 当"净流出"（对账引擎此前对强利好主线恒判"资金背离→观望/禁止"）
            mainNet: top.mainNet ?? undefined,
            mainNet5d: top.mainNet5d ?? undefined,
          },
          // v9.40（V4-D）：默认开 Critic 挑刺；自洽投票默认关省配额
          { useCritic: true, selfConsistency: false },
        );
        results.push({ mainline: top.mainline, verdict: r, snap: { strengthScore: top.strengthScore ?? 0, ztCount: top.ztCount ?? 0 } });
      } catch { /* 单条失败不影响其他 */ }
    }
    lastActionRef.current = results[0]?.verdict.action ?? prevAction;
    setAgentResults(results);
    setAgentLoading(false);
  };

  // P1-5：竞价极端事件 → 强制 Agent 复裁决（跳过 5 分钟节流）
  const runAgentRef = useRef(runAgent);
  useEffect(() => { runAgentRef.current = runAgent; }, [runAgent]);
  useEffect(() => {
    const onAuctionExtreme = () => {
      agentLastRunRef.current = 0; // 清零节流时间戳，允许立即重跑
      runAgentRef.current(true);
    };
    try {
      window.addEventListener("auction-extreme", onAuctionExtreme);
      return () => window.removeEventListener("auction-extreme", onAuctionExtreme);
    } catch { /* 静默 */ }
  }, []);

  // v9.39（改造1）：AI 自动主导 —— 主线数据更新后自动裁决（盘中/盘后/盘前都跑，5 分钟节流）
  useEffect(() => {
    const top = battlePlan?.candidates?.[0];
    if (!top) return;
    const t = setTimeout(() => runAgent(true), 1500); // 延迟 1.5s 等决策证据就绪
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battlePlan]);

  // v9.39（改造2）：幻方门控数据 —— 信号回测胜率（激活 V3-5 门控）+ 因子 IC 健康度（接入降权）
  const [signalGates, setSignalGates] = useState<Array<{ name: string; winRate: number | null; samples: number | null }>>([]);
  const [factorStats, setFactorStats] = useState<{ decayed: number; total: number; samples?: number | null } | null>(null);
  useEffect(() => {
    if (!isLocalServer()) return;
    let alive = true;
    (async () => {
      try {
        // 1. 信号回测胜率 → 门控
        const { backtestSignals } = await import("../lib/signalBacktest");
        const stats = await backtestSignals(30);
        if (stats && alive) {
          setSignalGates(stats.map(s => ({ name: s.name, winRate: s.verdict === "样本不足" ? null : s.winRate, samples: s.samples })));
        }
        // 2. 因子 IC 健康度（factorLib）→ 决策降权 + 落库 factor_ic:日期（改造3）
        const { evaluateAllFactors, markNextWin } = await import("../lib/factorLib");
        const rows = await loadFactorRows();
        if (rows.length >= 3 && alive) {
          const ics = evaluateAllFactors(markNextWin(rows));
          const decayed = ics.filter(i => i.decayed).length;
          // v9.57-fix（V8-3）：传 samples（交易日数）→ decisionBus 样本<30 时不扣置信
          setFactorStats({ decayed, total: ics.length, samples: rows.length });
          // 落库（供 SignalEffectivenessPanel/历史对比）
          const d = new Date();
          const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          kvSet(`factor_ic:${ds}`, { date: ds, items: ics.map(i => ({ name: i.factorName, ic: i.ic, samples: i.samples, decayed: i.decayed })) }).catch(() => {});
        }
      } catch { /* 静默 */ }
    })();
    return () => { alive = false; };
  }, []);

  // v9.47（V6-L1）：决策证据接回真实数据 —— lhb 加持 / 资金连续流入（异步读 kv，不再硬编码 false）
  const [lhbBoost, setLhbBoost] = useState(false);
  const [fundStreakInflow, setFundStreakInflow] = useState(false);
  // v9.47（V6-L1）：异动事件流（诱多判定源 —— anomalyTier 已接入 detectTrap）
  const [anomalyEvents, setAnomalyEvents] = useState<AnomalyEvent[]>(() => getAnomalies());
  useEffect(() => {
    const refresh = () => setAnomalyEvents([...getAnomalies()]);
    refresh();
    return subscribeAnomaly(refresh);
  }, []);
  useEffect(() => {
    if (!isLocalServer()) return;
    // v9.84（性能）：消灭 18s kv 级联 —— refreshFast 每 18s 换 rawZTPool 引用导致本 effect 每 18s 重跑
    // ~10 个顺序 kv；龙虎榜/资金连续流入是慢变量（分钟级），60s 节流足够
    const now = Date.now();
    if (now - crossCheckAtRef.current < 60 * 1000) return;
    crossCheckAtRef.current = now;
    let alive = true;
    (async () => {
      // 1. 龙虎榜 × 涨停交叉（与 LhbCrossPanel 同口径：lhb:日期 净买 ∩ 今日涨停池）
      try {
        const ztCodes = new Set<string>(
          (overview?.limitPool?.rawZTPool ?? []).map((s: any) => String(s.c || "").replace(/^[A-Z]{2}/, "")),
        );
        for (let i = 0; i < 3; i++) {
          const d = new Date(); d.setDate(d.getDate() - i);
          const key = `lhb:${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          const r = await apiFetch(`/api/db/kv?key=${encodeURIComponent(key)}`);
          if (!r.ok) continue;
          const v = await r.json();
          const items = v?.value?.items;
          if (Array.isArray(items) && items.length > 0) {
            // v9.77（A7-01）：lhb 数据日 ≠ 今日 → 不视为"席位加持"（防昨日榜单×今日涨停伪造信号）
            const lhbDate = String(v?.value?.date ?? key.slice(4));
            const isTodayLhb = lhbDate === localDateStr();
            if (isTodayLhb) {
              const crossed = items.filter((x: any) => ztCodes.has(String(x.code)));
              if (alive) setLhbBoost(crossed.length > 0);
            } else {
              if (alive) setLhbBoost(false);
            }
            break;
          }
        }
      } catch { /* 静默 */ }
      // 2. 主线行业资金连续流入（buildFundStreaks → 主线匹配）
      try {
        const { buildFundStreaks } = await import("../lib/fundStreak");
        const list = await buildFundStreaks();
        const top = battlePlan?.candidates?.[0];
        if (list && top && alive) {
          const m = top.mainline;
          const hit = list.find(s => m.includes(s.board.slice(0, 3)) || s.board.includes(m.slice(0, 3)));
          setFundStreakInflow(Boolean(hit && hit.consecutiveInflowDays > 0));
        }
      } catch { /* 静默 */ }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overview?.limitPool?.rawZTPool, battlePlan?.candidates?.[0]?.mainline]);

  // 组装因子历史行（读 sentiment/market_daily 序列；v9.40 V4-G 补 4 因子输入字段）
  // v9.55-fix（V7-19 复盘补做）：用北京时间交易日历判回看日期（原 getDay 本地时区会偏移）
  // v14-9（P2）：market_daily kv 精确类型（替代 as any）
  interface MarketDailyLite {
    ztCount?: number | null;
    blastedRate?: number | null;
    maxBoardHeight?: number | null;
    premiumAvg?: number | null;
    promotionRate?: number | null;
    sealDecayCount?: number | null;
    lhbBoostCount?: number | null;
    fundInflowStreak?: number | null;
    nuclearCount?: number | null;
  }
  async function loadFactorRows(): Promise<Array<{ date: string; sentiment: number | null; blastedRate: number | null; ztCount: number | null; maxBoardHeight: number | null; premiumAvg: number | null; promotionRate: number | null; sealDecayCount: number | null; lhbBoostCount: number | null; fundInflowStreak: number | null; nuclearCount: number | null }>> {
    // v9.84（性能）：交易日间并行 + 10min 缓存 —— 原 14 交易日 × 3 kv 顺序 await = 首屏 42 个串行请求
    const now = Date.now();
    if (factorRowsCache && now - factorRowsCacheTs < FACTOR_ROWS_TTL) return factorRowsCache;
    const daysList: Array<{ ds: string; t: Date }> = [];
    const d = new Date();
    for (let i = 13; i >= 0; i--) {
      const t = new Date(d); t.setDate(t.getDate() - i);
      if (!isTradingDay(t)) continue; // 周末/节假日跳过（北京时间）
      daysList.push({ ds: bjDateStr(t), t });
    }
    const out = await Promise.all(daysList.map(async ({ ds, t }) => {
      const row: any = { date: ds, sentiment: null, blastedRate: null, ztCount: null, maxBoardHeight: null, premiumAvg: null, promotionRate: null, sealDecayCount: null, lhbBoostCount: null, fundInflowStreak: null, nuclearCount: null };
      try {
        const nxt = new Date(t); nxt.setDate(nxt.getDate() + 1);
        // v9.84：当日 3 个 kv 并行（sentiment / market_daily / 次日 market_daily）
        const [sv, md, nxtMd] = await Promise.all([
          kvGet(`sentiment:${ds}`).catch(() => null),
          kvGet(`market_daily:${ds}`).catch(() => null) as Promise<MarketDailyLite | null>,
          kvGet(`market_daily:${bjDateStr(nxt)}`).catch(() => null) as Promise<MarketDailyLite | null>,
        ]);
        const num = Number(sv ?? NaN);
        if (Number.isFinite(num)) row.sentiment = num;
        // v14-9（P2）：market_daily 用精确接口替代 as any
        if (md) {
          row.ztCount = md.ztCount ?? null;
          row.blastedRate = md.blastedRate ?? null;
          row.maxBoardHeight = md.maxBoardHeight ?? null;
          // v9.56（V8-2）：premium/promotion 已由 server 落库 → 读进因子行（此前永远 null）
          row.premiumAvg = md.premiumAvg ?? null;
          row.promotionRate = md.promotionRate ?? null;
          row.sealDecayCount = md.sealDecayCount ?? null;
          row.lhbBoostCount = md.lhbBoostCount ?? null;
          row.fundInflowStreak = md.fundInflowStreak ?? null;
          row.nuclearCount = md.nuclearCount ?? null;
        }
        // v9.57（V8-1）：读次日 market_daily（ztCount/maxBoardHeight）→ "主线延续"标签数据
        if (nxtMd) {
          row.nextZtCount = nxtMd.ztCount ?? null;
          row.nextHeight = nxtMd.maxBoardHeight ?? null;
        }
      } catch { /* 静默 */ }
      return row;
    }));
    factorRowsCache = out;
    factorRowsCacheTs = now;
    return out;
  }

  // v9.38.1（V3-12）：政策级事件数（读 kv event_classify，注入消息面证据源）
  const [policyEventCount, setPolicyEventCount] = useState(0);
  useEffect(() => {
    if (!isLocalServer()) return;
    let alive = true;
    (async () => {
      try {
        const d = new Date();
        const key = `event_classify:${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const v = (await kvGet(key)) as { items?: Array<{ level: string }> } | null;
        if (v?.items && alive) setPolicyEventCount(v.items.filter(i => i.level === "政策").length);
      } catch { /* 静默 */ }
    })();
    return () => { alive = false; };
  }, []);

  // v9.37（V3-4/7）：AI 终裁决 —— 多源证据汇聚
  // v9.47（V6-L1/L2）：去掉硬编码中性证据 —— trap 从异动流筛、lhb/fundStreak 读真实数据、
  // portfolioRisk 从纪律持仓算、hs300 从 overview.indices 取（决策准确性直接提升）
  const decisionSources = useMemo(() => {
    const top = battlePlan?.candidates?.[0];
    const admission = evaluateAdmission({
      strengthScore: top?.strengthScore ?? null,
      stage: top ? stageOfStrength({ strengthScore: top.strengthScore, ztCount: top.ztCount, exitSignal: top.exitSignal }) : "观察中",
      gateMode: battlePlan?.gate?.mode ?? "empty",
      ztCount: top?.ztCount ?? 0,
      height: top?.height ?? 0,
    });
    const ms = overview
      ? classifyMarketState({
          sentiment: overview.sentiment ?? 50,
          ztCount: overview.limitPool?.limitUpCount ?? 0,
          dtCount: overview.limitPool?.limitDownCount ?? 0,
          blastedRate: overview.limitPool?.blastedRate ?? 0,
          premiumAvg: overview.premiumAvg ?? null,
          maxBoardHeight: overview.maxBoardHeight ?? null,
        })
      : null;
    // V6-L2：真实沪深300涨跌（000300，系统性风险 red 信号不再失效）
    const hs300Pct = overview?.indices?.find((i: any) => i.code === "000300")?.pct ?? null;
    const sysRisk = overview
      ? checkSysRisk({
          hs300Pct,
          limitDownCount: overview.limitPool?.limitDownCount ?? 0,
          blastedRate: overview.limitPool?.blastedRate ?? 0,
          sentiment: overview.sentiment ?? null,
        })
      : { level: "none" as const, reasons: [], text: "" };
    const sealRed = (sealAlerts ?? []).filter(a => a.level === "red").length;
    const sealYellow = (sealAlerts ?? []).filter(a => a.level === "yellow").length;
    // V6-L1：诱多 —— 从异动事件流筛（anomalyTier 已接入 detectTrap）
    const trapHits = anomalyEvents.filter(e =>
      (e.aiComment ?? "").includes("诱多") || (e.action ?? "").includes("诱多") || (e.reason ?? "").includes("诱多"));
    const trapFlagged = trapHits.length > 0;
    const trapRate = anomalyEvents.length > 0 ? Math.round(trapHits.length / anomalyEvents.length * 100) / 100 : 0;
    // V6-L1：组合风险 —— 从纪律持仓算（与 DisciplinePanel 同口径，不再写死 false）
    let riskOverLimit = false, riskLossStreak = 0, riskMaxPct = 70;
    try {
      const dstate = loadDisciplineState();
      const totalValue = dstate.positions.reduce((s, p) => s + p.value, 0);
      const pr = computePortfolioRisk({
        marketState: ms?.state ?? null,
        positionPnlPcts: dstate.positions.map(p => p.pnlPct),
        totalCapital: dstate.settings.totalCapital,
        currentPositionValue: totalValue,
      });
      riskOverLimit = pr.overLimit;
      riskLossStreak = pr.lossStreak;
      riskMaxPct = pr.maxPositionPct;
    } catch { /* 持仓读取失败 → 保持中性 */ }
    return collectEvidence({
      mainline: top?.mainline ?? "—",
      admissionAction: admission.action,
      admissionConfidence: admission.confidence,
      admissionReason: admission.reasons?.[0] ?? admission.action,
      marketState: ms?.state ?? "分歧震荡",
      marketFactor: ms?.positionFactor ?? 0.5,
      riskOverLimit,
      riskLossStreak,
      riskMaxPct,
      trapFlagged,
      trapRate,
      sealRedCount: sealRed,
      sealYellowCount: sealYellow,
      sysRiskLevel: sysRisk.level,
      lhbBoost,
      fundStreakInflow,
      policyEventCount,
    });
  }, [battlePlan, overview, sealAlerts, policyEventCount, anomalyEvents, lhbBoost, fundStreakInflow]);

  // ============== P1-3：极简盯盘皮肤（trading 阶段默认，盘中 3 秒扫一眼） ==============
  if (simpleSkin) {
    const top0 = battlePlan?.candidates?.[0];
    const topMainline: TopMainlineBrief | null = top0 ? {
      mainline: top0.mainline,
      score: top0.strengthScore ?? top0.score ?? null,
      height: top0.height ?? null,
      zt: top0.ztCount ?? null,
      agent: agentResults[0]?.verdict ? { action: agentResults[0].verdict.action, confidence: agentResults[0].verdict.confidence } : null,
    } : null;
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between px-1 pt-1">
          <div className="text-xs text-slate-500">⚡ 极简盯盘模式（盘中重点 3 秒可读）</div>
          <div className="flex gap-2">
            <button onClick={() => { setSimpleSkin(false); try { localStorage.setItem("simple_skin_default_on", "0"); } catch { /* 静默 */ } }}
              className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-[11px] font-bold text-sky-300 hover:bg-sky-500/20">
              🔍 展开深度视图
            </button>
          </div>
        </div>
        <SimpleWatchSkin overview={overview} topMainline={topMainline} watchAlerts={watchAlerts} />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* 指数光带（极薄通栏） */}
      <IndexStrip overview={overview} />

      {/* v9.137.0（审查 P2-05）：待你拍板任务条 —— AI 主动找用户确认的聚合入口（无待办时自隐） */}
      <PendingVerdictBar />

      {/* ============== 共用顶部决策区（v9.46：全阶段可见，决策靠前） ============== */}
      {/* 驾驶舱 + 今日作战卡 + Agent 重审 + Top 摘要 —— 任何阶段（盘前/盘中/盘后/午休）都置顶 */}
      <div className="space-y-2">
        {/* v9.23-3：游资五问条（驾驶舱顶部常驻） */}
        <FiveQBar battlePlan={battlePlan ?? null} overview={overview} fund={fund ?? null} />
        {/* v9.145.0（第二轮 P0-1）：波段投研决策卡优先展示，旧五支柱降级为战术参考 */}
        <SwingVerdictCard
          addTrade={portfolio.addTrade}
          saveLogic={portfolio.saveLogic}
          initialCode={(() => {
            const lead = battlePlan?.candidates?.[0]?.leaders?.[0];
            return lead ? lead.code : "";
          })()}
          initialName={(() => {
            const lead = battlePlan?.candidates?.[0]?.leaders?.[0];
            return lead ? lead.name : "";
          })()}
        />
        {/* v9.37（V3-7）：AI 终裁决（多源共识，替代决策的可见终点） */}
        <DecisionVerdictCard
          mainline={battlePlan?.candidates?.[0]?.mainline ?? "—"}
          sources={decisionSources}
          agent={agentResults[0]?.verdict ?? null}
          signalGates={signalGates}
          factorStats={factorStats ?? undefined}
          // v11-3（P0）：上次裁决 action（变化提示用）
          prevAction={lastActionRef.current}
          // v9.77（P0-2 修复）：Agent 实际裁决的主线 —— 主标题切换后卡片检测错配，AI 结论不再张冠李戴
          agentMainline={agentResults[0]?.mainline ?? null}
          // v9.77（P0-15 修复）：拍板联动传真实 stage/闸门/强度（原硬编码"观察中"→仓位恒 0%）
          hookCtx={{
            gate: battlePlan?.gate ?? undefined,
            strengthScore: battlePlan?.candidates?.[0]?.strengthScore ?? null,
          }}
          // v9.77（A7-02 修复）：主线拍板带代表标的（龙一 + 涨停池现价）→ 拍板 T+5 盈亏回填从"永远积累中"变为可产出
          representCode={(() => {
            const lead = battlePlan?.candidates?.[0]?.leaders?.[0];
            return lead ? lead.code : null;
          })()}
          representPrice={(() => {
            const lead = battlePlan?.candidates?.[0]?.leaders?.[0];
            if (!lead) return null;
            const z = (overview?.limitPool?.rawZTPool ?? []).find((s: any) => String(s.c) === String(lead.code));
            return z && Number(z.p) > 0 ? Number(z.p) / 1000 : null;
          })()}
          // v9.95.5（第五段 P3）：逐标的裁决 —— 主线 leaders（龙一/二/三）传决策卡
          leaders={battlePlan?.candidates?.[0]?.leaders?.map(l => ({ code: l.code, name: l.name, role: l.role })) ?? null}
          // v9.100.0（P2-18）：传今日涨停池供逐标的裁决取真实字段（封单/涨幅/炸板）
          ztPool={overview?.limitPool?.rawZTPool ?? null}
        />
        {/* v10-3（P0）：选股清单紧贴裁决 —— "可上车→买这些"一气呵成，中间不插 BattlePlan/LimitTempBar */}
        <StockPickList
          candidate={battlePlan?.candidates?.[0] ?? null}
          rawPool={overview?.limitPool?.rawZTPool ?? []}
          potential={mainline?.potential?.map(p => ({
            code: p.code, name: p.name,
            mainNetPct: p.mainNetPct ?? 0, mainNet5dPct: 0, // potential 无 5d 字段，增强仅用当日主力占比
            vetoed: Boolean(p.vetoed), vetoReasons: p.vetoReasons ?? [],
          }))}
          gate={battlePlan?.gate ?? null}
        />
        {/* v11-5（P1）：事件三级研判 —— v9.133.0（游资改造）移回消息面 Tab（驾驶舱决策区只留裁决+选股） */}
        {/* v9.38（V3-2/3）：Agent 手动重审按钮（自动已每5分钟跑，手动可即时刷新） */}
        <div className="flex items-center gap-2">
          <button onClick={() => runAgent(false)} disabled={agentLoading}
            className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] font-bold text-amber-300 hover:bg-amber-500/20 disabled:opacity-50">
            {agentLoading ? "🤖 Agent 调研中…" : "⚡ 立即重审（LLM）"}
          </button>
          <span className="text-xs text-slate-600">自动每 5 分钟裁决一次；点击即时重审</span>
        </div>
        {/* v9.41（V4-E）：Top-2/3 主线 AI 裁决摘要 */}
        {agentResults.length > 1 && (
          <div className="space-y-1 rounded-lg border border-white/5 bg-black/20 p-2">
            {agentResults.slice(1).map(({ mainline, verdict }) => (
              <div key={mainline} className="flex items-center gap-2 text-xs">
                <span className="w-24 truncate text-slate-400" title={mainline}>{mainline}</span>
                <span className={`rounded px-1.5 py-0.5 font-bold ${
                  verdict.action === "可上车" ? "bg-emerald-500/15 text-emerald-300"
                  : verdict.action === "禁止" ? "bg-rose-500/15 text-rose-300"
                  : "bg-amber-500/15 text-amber-300"
                }`}>{verdict.action}</span>
                <span className="text-slate-600">{verdict.confidence}%</span>
                <span className="flex-1 truncate text-slate-500">{verdict.reason}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ============== 风险信号流（v9.47 L6：跨相位保留 —— 午休/盘后不再消失） ============== */}
      {/* 预警流水 + 龙虎榜×涨停交叉：任何阶段都渲染（无数据时组件自返 null） */}
      <div className="space-y-2">
        <AlertFeed />
        <LhbCrossPanel overview={overview} />
      </div>

      {/* ============== 主区（v9.48 D5：单一布局收敛 —— 相位只做强调点插值，不再三套布局整体跳变） ============== */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_300px]">
        {/* 左 2/3：决策证据 + 数据详情 */}
        <div className="space-y-2">
          {/* v9.130.0（终审 D1）：竞价作战区已上移至驾驶舱顶部（App.tsx dashboard 分支）——
              竞价台/竞价强度榜/AI 预判龙一 收敛为「竞价作战区」，不再散落本组件左栏底部 */}
          {/* v9.48 D4：核心温度条提到决策区下方（盘中核心进阶指标，D2 已去 EmotionCycle 冗余） */}
          <LimitTempBar overview={overview} />
          {/* v9.95.1（第五段 P2）：情绪周期雷达卡 —— v9.133.0（游资改造）默认折叠（与认知横幅去重，证据链展开看） */}
          {overview && overview.limitPool && (
            <details className="rounded-lg border border-white/10 bg-black/20">
              <summary className="cursor-pointer select-none px-2 py-1 text-[10px] text-slate-500 hover:text-slate-300">🎚️ 情绪周期雷达（证据链 · 展开）</summary>
              <div className="px-2 pb-2">
                {(() => {
                  const cycleInput: EmotionCycleInput = {
                    sentiment: overview.sentiment,
                    ztCount: overview.limitPool.limitUpCount,
                    ztCountYesterday: yesterdayZt && yesterdayZt.length > 0 ? yesterdayZt.length : null,
                    maxBoardHeight: overview.maxBoardHeight,
                    maxBoardYesterday: null,
                    blastedRate: overview.limitPool.blastedRate,
                    blastedRatePrev: null,
                    premiumAvg: overview.premiumAvg,
                    promotionRate: overview.promotionRate,
                    blastedCount: overview.limitPool.blastedCount ?? null,
                    redRate: (() => {
                      const d = overview.premiumDist;
                      if (!d) return null;
                      const total = d.ltNeg5 + d.neg5to0 + d.zeroTo3 + d.gt3;
                      return total > 0 ? (d.zeroTo3 + d.gt3) / total : null;
                    })(),
                  };
                  return <EmotionCycleCard input={cycleInput} premiumDist={overview.premiumDist ?? null} />;
                })()}
              </div>
            </details>
          )}
          {/* v9.96.0（批次 1）：红涨绿跌比例条（复用 breadth，零新增请求） */}
          <MarketEmotionWidget overview={overview} />
          {/* v10-4（P1）：作战卡内嵌 AI 裁决徽章（每条主线显示 LLM 结论） */}
          <BattlePlan data={battlePlan ?? null} agentResults={agentResults} cognMainline={cognMainline} />
          {/* v10-3：StockPickList 已上移至裁决区（见上），此处不再重复渲染 */}
          <AnomalyStrip stocks={watchStocks} mainlines={mainlines} ztPool={overview?.limitPool?.rawZTPool ?? []} />
          <PositionMatchStrip stocks={watchStocks} boards={mainline?.boards} />
          <MarketOverview data={overview} loading={loading} />
          <PopularityRadar />
        </div>
        {/* 右 1/3：风控纪律 + 数据源（恒定，不再分阶段重复定义） */}
        <div className="space-y-2">
          {/* v9.19-F7：仓位与纪律面板 */}
          <DisciplinePanel overview={overview} />
          <GateGauge overview={overview} gate={gate} />
          <ImportantFeed />
          <LadderMini overview={overview} onSwitchTab={() => onSwitchTab?.("dragon")} />
          <Playbook sentiment={overview?.sentiment} limitUpCount={overview?.limitPool?.limitUpCount}
            blastedRate={overview?.limitPool?.blastedRate} overview={overview} globalData={globalData} mainline={mainline} />
          {/* v11-4（P1）：GlobalSignals 已移出驾驶舱（fundline Tab"🌐外围信号"已有，此处不再重复渲染） */}
          <InstitutionFund />
          <LadderPulse overview={overview} />
          <WeeklyCoach />
        </div>
      </div>
      {/* v9.49（N1）：EventClassifyPanel 已移到"消息面"Tab（消息研判归消息面），驾驶舱不再渲染 */}

      {/* ============== 复盘工具（v9.46）—— v9.133.0（游资改造）：研究台 details（盘后默认展开，盘中折叠防分散注意力） ============== */}
      <details className="rounded-xl border border-white/10 bg-white/5" open={phase === "post"}>
        <summary className="cursor-pointer select-none px-4 py-2 text-sm font-bold text-slate-300 hover:text-slate-100">
          📚 研究台（情绪叙事报告 · 回测 · 审计 · 复盘 —— 盘后默认展开）
        </summary>
        <div className="px-4 pb-4 space-y-2">
      <EmotionReportPanel />
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setShowAI(v => !v)}
          className="rounded px-3 py-1 text-xs bg-violet-500/10 text-violet-300 hover:bg-violet-500/20 border border-violet-500/20">
          {showAI ? "收起AI复盘" : "AI复盘总结"}
        </button>
        {/* v9.35（S3）：信号有效性回测面板 */}
        <button onClick={() => setShowSignalEffect(v => !v)}
          className="rounded px-3 py-1 text-xs bg-violet-500/15 text-violet-300 hover:bg-violet-500/25 border border-violet-500/30">
          {showSignalEffect ? "收起回测" : "🧪 信号有效性回测"}
        </button>
        {/* v9.106.0（第六批 B，T-B4）：主线级回测 */}
        <button onClick={() => setShowMainlineBt(v => !v)}
          className="rounded px-3 py-1 text-xs bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 border border-cyan-500/20">
          {showMainlineBt ? "收起主线回测" : "📊 主线回测"}
        </button>
        {/* v9.42：因子健康度面板（幻方"因子失效"IC 曲线） */}
        <button onClick={() => setShowFactorHealth(v => !v)}
          className="rounded px-3 py-1 text-xs bg-violet-500/20 text-violet-300 hover:bg-violet-500/30 border border-violet-500/40">
          {showFactorHealth ? "收起因子" : "📉 因子健康度"}
        </button>
        {/* v9.44（②）：决策审计时间线 */}
        <button onClick={() => setShowAudit(v => !v)}
          className="rounded px-3 py-1 text-xs bg-violet-500/20 text-violet-300 hover:bg-violet-500/30 border border-violet-500/40">
          {showAudit ? "收起审计" : "📜 决策审计"}
        </button>
        {/* v9.44（④）：信号净值曲线 */}
        <button onClick={() => setShowEquity(v => !v)}
          className="rounded px-3 py-1 text-xs bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 border border-rose-500/30">
          {showEquity ? "收起净值" : "💰 信号净值"}
        </button>
        {/* v9.47（L7）：信号账本移到最后 —— 按钮顺序与渲染顺序一致 */}
        <button onClick={() => setShowSignal(v => !v)}
          className="rounded px-3 py-1 text-xs bg-slate-500/20 text-slate-300 hover:bg-slate-500/30 border border-slate-500/40">
          {showSignal ? "收起信号/日记" : "信号账本/日记"}
        </button>
        {/* v9.48（D3）：盘后预演 —— 风险雷达 + 明日三剧本 + 每日复盘（盘中不显示，收起态） */}
        <button onClick={() => setShowPreview(v => !v)}
          className="rounded px-3 py-1 text-xs bg-violet-500/20 text-violet-300 hover:bg-violet-500/30 border border-violet-500/40">
          {showPreview ? "收起预演" : "📋 盘后预演"}
        </button>
      </div>
      {showAI && <DailySummary overview={overview} fund={fund} />}
      {/* v9.48（D3）：盘后预演折叠区（风险雷达/明日三剧本/每日复盘 —— 从盘中布局移出） */}
      {showPreview && (
        <div className="space-y-2">
          {riskRadarText && (
            <div className={`rounded-lg border px-3 py-2 text-xs ${
              riskRadarText.includes("[高]") ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
              : riskRadarText.includes("[中]") ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
              : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"}`}>
              🛡 {riskRadarText}
              {llmBriefDegraded.riskRadar && <span className="ml-1 text-[10px] text-amber-300">⚡ 规则版（LLM 不可用）</span>} {/* v9.99.2（B3） */}
            </div>
          )}
          {/* v9.75（阶段二）：次日闸门预测（LLM 结合隔夜外围/政策预判） */}
          {nextGatePredict && nextGatePredict.nextGate && (
            <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs">
              <span className="font-bold text-slate-200">🚦 次日闸门预测：</span>
              {llmBriefDegraded.nextGate && <span className="ml-1 text-[10px] text-amber-300">⚡ 规则版（LLM 不可用）</span>} {/* v9.99.2（B3） */}
              <span className={nextGatePredict.nextGate.includes("全开") ? "text-emerald-300" : nextGatePredict.nextGate.includes("低") || nextGatePredict.nextGate.includes("谨慎") ? "text-amber-300" : "text-slate-300"}>{nextGatePredict.nextGate}</span>
              {nextGatePredict.reason && <span className="text-slate-400">（{nextGatePredict.reason}）</span>}
              {nextGatePredict.watchPoints.length > 0 && (
                <div className="mt-1 text-[11px] text-slate-400">👀 观察：{nextGatePredict.watchPoints.join("；")}</div>
              )}
            </div>
          )}
          {nextScenarios && nextScenarios.length > 0 && (
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-[11px] font-bold text-slate-200 mb-2">🎬 明日三剧本（LLM 盘后推演）
                {llmBriefDegraded.nextScenarios && <span className="ml-1 text-[10px] text-amber-300">⚡ 规则版（LLM 不可用）</span>} {/* v9.99.2（B3） */}
              </div>
              <div className="space-y-1.5">
                {nextScenarios.map((s, i) => (
                  <div key={i} className="rounded border border-white/5 bg-black/20 px-2 py-1.5">
                    <div className="flex items-center justify-between">
                      <span className={`text-[11px] font-bold ${i === 0 ? "text-amber-300" : i === 1 ? "text-slate-200" : "text-emerald-300"}`}>
                        {i + 1}. {s.scenario}
                      </span>
                      <span className="text-[11px] font-mono text-slate-400">{s.probability}%</span>
                    </div>
                    {s.conditions.length > 0 && (
                      <div className="mt-0.5 text-xs text-slate-500">触发：{s.conditions.join("；")}</div>
                    )}
                    {s.focus.length > 0 && (
                      <div className="text-xs text-amber-200/70">关注：{s.focus.join("、")}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          <ReviewPanel />
          <PortfolioReportPanel />
        </div>
      )}
      {showSignalEffect && <SignalEffectivenessPanel />}
      {/* v9.106.0（第六批 B，T-B4）：主线级回测面板 */}
      {showMainlineBt && <MainlineBacktestPanel />}
      {/* v9.42：因子健康度（server cron 15:40 落库 factor_ic:日期） */}
      {showFactorHealth && <FactorHealthPanel />}
      {/* v9.65（V2-P2）：运维可观测面板（数据源/AI配额/队列/因子） */}
      <OpsPanel />
      {/* v9.44（②）：决策审计时间线（decision_log） */}
      {showAudit && <DecisionAuditPanel />}
      {/* v9.137.0（审查 P2-06）：我的画像卡 —— 常驻研究台（有数据才显示） */}
      <UserProfileCard />
      {/* v9.44（④）：信号净值曲线（signalLedger 等权复利） */}
      {showEquity && <SignalEquityPanel />}
      {showSignal && <SignalPanel />}
        </div>
      </details>
    </div>
  );
}