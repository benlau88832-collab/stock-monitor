import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import { saveTodaySentiment, loadPrevTradingDaySentiment, recordIntradaySentiment } from "./lib/sentimentStore";
import TopNav, { type TabKey } from "./components/TopNav";
import MainlineRanking from "./components/MainlineRanking";
import FundStructure from "./components/FundStructure";
import DarkPool from "./components/DarkPool";
import GlobalSignals from "./components/GlobalSignals";
// 深潜组件 lazy 分包：龙虎榜/个股雷达/消息面不在首屏，按需加载
const StockWatchlist = lazy(() => import("./components/StockWatchlist"));
const NewsPanel = lazy(() => import("./components/NewsPanel"));
const DragonTiger = lazy(() => import("./components/DragonTiger"));
const LimitBoard = lazy(() => import("./components/LimitBoard"));
import Dashboard, { type WatchStockBrief } from "./components/Dashboard";
import ThemeLadder from "./components/ThemeLadder";
import CommodityChain from "./components/CommodityChain";
import MarginPanel from "./components/MarginPanel";
import { type BattlePlanData } from "./components/BattlePlan";
import { detectHighLowSwitch, type ZTPoolItem } from "./lib/themeLadder";
import { classifyBoard } from "./lib/boardTaxonomy";
import { ensureBoardMap } from "./lib/boardMap";
import { saveZTSnapshot, loadPrevZTSnapshot } from "./lib/ztSnapshot";
import { computeGate } from "./lib/regimeGate";
import { computeThemeScores, type NewsItem as ThemeNewsItem } from "./lib/themeScore";
import { computeETFScores, ETF_POOL, type ETFQuote } from "./lib/etfScore";
import { detectMarketStyle } from "./lib/mainline";
import { rankMainlinesWithLLM } from "./lib/mainlineLLM";
import { classifyStocksToMainlines, type MainlineGroup } from "./lib/stockToMainline";
import { buildMainlineCatalysts } from "./lib/mainlineCatalyst";
import { calcMainlineStrength } from "./lib/mainlineScore";
import { checkExitSignal } from "./lib/exitSignal";
import { stageOfFunds } from "./lib/stageModel";
import { getAllSince } from "./lib/dataStore";
// v9.33（缺口3）：LLM 三剧本/龙头预判/风险雷达
import { callAI, parseAIJSON } from "./lib/ai";
// v9.34（S1）：封单衰减实时监控（龙一开板前兆）
import { detectSealDecay, type SealAlert } from "./lib/sealMonitor";
// v9.36（B2）：昨日涨停统计纯函数（溢价/核按钮/晋级率）
import { computePrevZtStats } from "./lib/prevZtStats";
import { fetchPopularityRank } from "./lib/api";
import IndustryFundFlowChart from "./components/IndustryFundFlowChart";

import StatusBar from "./components/StatusBar";
import AlertBanner, { type AlertItem } from "./components/AlertBanner";
// v9.32：系统性风险预警（沪深300大跌/跌停数/炸板率/极端情绪）
import { checkSysRisk } from "./lib/sysRiskGuard";
import { appendSignal } from "./lib/signalLedger";
import { runSignalBackfill, isBackfilledToday, markBackfilledToday } from "./lib/signalLedger";
import { recordRecommendation, runAttribution } from "./lib/recTracker";
import { getCurrentSession, type SessionPhase } from "./lib/tradingSession";
import { emit as emitAlert } from "./lib/alertBus";
import { localDateStr, localDateStrOffset } from "./lib/format";

// 告警跃迁护栏：只在 false→true 时报一次，避免每分钟刷屏
const lastSignalActive: Record<string, boolean> = {};
import {
  fetchIndexOverview,
  fetchMarketBreadth,
  fetchMarketMainFund,
  fetchGlobalIndices,
  fetchCommodities,
  fetchMarketTurnover,
  fetchBoardFundFlow,
  fetchBoardConstituents,
  fetchMarketFundHistory,
  fetchBoardRankTopBottom,
  fetchLimitPoolSummary,
  fetchTurnoverHistory,
  fetchStockBriefBatch,
  isRealConceptBoard,
  stockLimitPct,
  tradeDateStr,
  type IndexQuote,
  type MarketBreadth,
  type GlobalIndex,
  type BoardFlowItem,
  type BoardStock,
  type BoardRankItem,
  type FundSnapshot,
  type LimitPoolSummary,
} from "./lib/api";

// ============== 溢价/晋级率计分常量（可调） ==============
/** 溢价因子：溢价1%计1分，clamp在±5（即溢价±5%封顶） */
const PREMIUM_SCORE_MIN = -5;
const PREMIUM_SCORE_MAX = 5;
/** 晋级率因子阈值：昨日首板今日继续封板的比例 → ≥50%→+5, ≥30%→+2.5, ≥15%→0, ≥5%→-2.5, <5%→-5 */
const PROMO_TIER = [
  { threshold: 0.5,  score:  5   },
  { threshold: 0.3,  score:  2.5 },
  { threshold: 0.15, score:  0   },
  { threshold: 0.05, score: -2.5 },
] as const;
const PROMO_FLOOR_SCORE = -5;

export interface SentimentFactors {
  upDownScore: number;
  limitScore: number;
  avgPctScore: number;
  indexScore: number;
  limitUpBonus: number;
  blastedPenalty: number;
  fundFlowScore: number;
  premiumScore: number;
  promotionScore: number;
}

export interface OverviewData {
  indices: IndexQuote[];
  breadth: MarketBreadth | null;
  sentiment: number | null;
  sentimentLabel: string;
  sentimentFactors: SentimentFactors | null;
  sentimentYesterday: number | null;
  limitPool: LimitPoolSummary | null;
  turnoverAmount: number;
  turnoverYesterday: number | null;
  turnoverAvg5d: number | null;
  premiumAvg: number | null;       // 昨日涨停股今日平均涨幅%
  premiumDist?: {
    ltNeg5: number;   // 昨日涨停今日 < -5%（焖面，亏钱效应）
    neg5to0: number;  // -5% ~ 0%（亏钱）
    zeroTo3: number;  // 0% ~ 3%（平/小赚）
    gt3: number;      // > 3%（连板高溢价，赚钱效应）
  } | null;           // v9.32.1：溢价分布（游资看第一眼的是分布不是均值）
  promotionRate: number | null;    // 2板→3板晋级率(0~1)
  maxBoardHeight: number | null;   // 今日最高连板
}

export interface FundStructureData {
  structure: {
    today: { mainNet: number; extraLargeNet: number; largeNet: number; mediumNet: number; smallNet: number };
    mainNet5d: number;
    mainNet10d: number;
    verdict: string;
    vetoTriggered: boolean;
    reasons: string[];
    actionHint: string;
  };
  history: FundSnapshot[];
  boardRank: {
    inflow: BoardRankItem[];
    outflow: BoardRankItem[];
  } | null;
  turnoverAmount: number; // 两市成交额（用于出货强度计算）
}

export interface DarkPoolData {
  // 明盘 = 超大单+大单（明面上的大资金行为）
  // 暗盘 = 中单+小单（看似散户，但可能包含主力拆单的隐蔽资金）
  // 资金总体 = 主力净流入（f62）
  totalFlow: number;      // 资金总体流向（主力净流入）
  openPoolToday: number;  // 今日明盘净流入（超大单+大单）
  darkPoolToday: number;  // 今日暗盘净流入（中单+小单）
  darkPool5d: number;     // 近5日主力净流入
  darkPool10d: number;    // 近10日主力净流入
  marketFlowType: string; // 主力动向判断（同花顺6种组合）
  topBoards: Array<{
    code: string;
    name: string;
    pct: number;
    openNet: number;    // 明盘净流入（超大单+大单）
    darkNet: number;    // 暗盘净流入（中单+小单）
    flowType: string;   // 主力动向判断
    boardType: string;
  }>;
  boardStocks: Record<string, BoardStock[]>;
}

export interface GlobalData {
  globalSignals: GlobalIndex[];
  commodities: GlobalIndex[];
  turnover: { amount: number; available: boolean };
}

export interface MainlineData {
  boards: Array<BoardFlowItem & { stage: string; stageReason: string; weight: string }>;
  potential: Array<{
    code: string; name: string; price: number; pct: number;
    mainNet: number; mainNetPct: number; turnoverRate: number; volumeRatio: number;
    pe: number | null; boardName: string; vetoed: boolean; vetoReasons: string[];
    crowding: string;
  }>;
}

function boardWeight(stage: string) {
  if (stage === "高潮期" || stage === "退潮期") return "降级观察";
  if (stage === "观察中") return "谨慎参与";
  return "推荐关注";
}

export default function App() {
  // 启动 tab 优先级：URL hash > localStorage > 默认 dashboard
  const initialTab = (() => {
    const fromUrl = typeof window !== "undefined" ? window.location.hash.replace("#", "") : "";
    const fromLs = typeof window !== "undefined" ? localStorage.getItem("stock:activeTab") : null;
    const keys: TabKey[] = ["dashboard", "fundline", "radar", "dragon", "news"];
    if (keys.includes(fromUrl as TabKey)) return fromUrl as TabKey;
    if (fromLs && keys.includes(fromLs as TabKey)) return fromLs as TabKey;
    return "dashboard";
  })();
  const [active, setActive] = useState<TabKey>(initialTab);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [countdown] = useState(60); // v9.26.10：仅作 TopNav 兜底初值（实际显示用 nextRefreshAt）
  // v9.26.10：下次自动刷新时间戳（替代每秒 setCountdown，避免全树重渲染）
  const [nextRefreshAt, setNextRefreshAt] = useState<number>(0);
  const [overview, setOverview] = useState<OverviewData | null>(null);
  // v9.32.1（缺口1）：核按钮预警（昨高位涨停今日秒跌停，退潮信号）
  const [nuclearAlerts, setNuclearAlerts] = useState<string[]>([]);
  const [fundStructure, setFundStructure] = useState<FundStructureData | null>(null);
  const [darkPool, setDarkPool] = useState<DarkPoolData | null>(null);
  const [globalData, setGlobalData] = useState<GlobalData | null>(null);
  const [mainline, setMainline] = useState<MainlineData | null>(null);
  const [battlePlan, setBattlePlan] = useState<BattlePlanData | null>(null);
  // v9.26.19：行业资金流向（行业板块前 8 流入 + 前 8 流出 = 16 个，挂在 fundline tab）
  const [topIndustryFund, setTopIndustryFund] = useState<Array<{ code: string; name: string; mainNet: number }>>([]);
  const [watchStocks, setWatchStocks] = useState<WatchStockBrief[]>([]);
  const [currentPhase, setCurrentPhase] = useState<SessionPhase>(() => getCurrentSession().phase);
  // v9.33（缺口3）：LLM 盘后三剧本 / 竞价龙头预判 / 风险雷达
  const [nextScenarios, setNextScenarios] = useState<Array<{ scenario: string; probability: number; conditions: string[]; focus: string[] }> | null>(null);
  const [leaderPredict, setLeaderPredict] = useState<{ predictLeader: { code: string; name: string } | null; confidence: number; reason: string; watch: string } | null>(null);
  const [riskRadarText, setRiskRadarText] = useState<string | null>(null);
  // v9.34（S1）：封单衰减预警（18s 高频通道轮询对比）
  const [sealAlerts, setSealAlerts] = useState<SealAlert[]>([]);
  const inFlight = useRef(false);
  // v9.26.9：LLM 主线精排竞态护栏（慢响应不覆盖新一轮结果）
  const llmRankSeq = useRef(0);
  // F-02 修复：refreshAll 空依赖，闭包需读最新 state → 用 ref 镜像（避免陈旧闭包）
  const overviewRef = useRef(overview);
  useEffect(() => { overviewRef.current = overview; }, [overview]);
  const darkPoolRef = useRef(darkPool);
  useEffect(() => { darkPoolRef.current = darkPool; }, [darkPool]);

  const refreshAll = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    // 静默刷新：仅首次加载显示 loading 骨架，后续刷新数据原位更新不闪烁
    const isFirstLoad = overviewRef.current === null;
    if (isFirstLoad) setLoading(true);
    try {
      // Parallel fetches
      const [indices, breadth, fundMain, globals, turnover, fundHistory, limitPoolRes, turnoverHistRes] = await Promise.allSettled([
        fetchIndexOverview(),
        fetchMarketBreadth(),
        fetchMarketMainFund(),
        fetchGlobalIndices(),
        fetchMarketTurnover(),
        fetchMarketFundHistory(30),
        fetchLimitPoolSummary(),
        fetchTurnoverHistory(10),
      ]);

      // === Overview ===
      const idxData = indices.status === "fulfilled" ? indices.value : [];
      const brData = breadth.status === "fulfilled" ? breadth.value : null;
      const limitPool = limitPoolRes.status === "fulfilled" ? limitPoolRes.value : null;
      const turnoverData = turnover.status === "fulfilled" ? turnover.value : { amount: 0, available: false };
      const fm0 = fundMain.status === "fulfilled" ? fundMain.value : null;
      
      // ============== 溢价/晋级率/最高板计算（修改点1） ==============
      let premiumAvg: number | null = null;
      let promotionRate: number | null = null;
      let maxBoardHeight: number | null = null;

      // 今日最高板
      if (limitPool && limitPool.rawZTPool && limitPool.rawZTPool.length > 0) {
        let maxLbc = 0;
        for (const s of limitPool.rawZTPool) {
          const lbc = s.lbc ?? 1;
          if (lbc > maxLbc) maxLbc = lbc;
        }
        maxBoardHeight = maxLbc > 0 ? maxLbc : null;
      }

      // 昨日快照 → 溢价 + 晋级率（v9.36 B2：逻辑抽到 lib/prevZtStats.ts）
      const prevZTPool = loadPrevZTSnapshot(limitPool?.qdate ?? null);
      // v9.32.1（缺口1）：溢价分布 4 档（游资看第一眼的是分布不是均值）
      let premiumDist: OverviewData["premiumDist"] = null;
      if (prevZTPool && prevZTPool.length > 0) {
        // v9.26.17：取全部代码去重（push2 批量单接口 100 只限制改分批处理；昨日涨停常 > 100 不应截断）
        const codes = [...new Set(prevZTPool.map(s => String(s.c)))];
        if (codes.length > 0) {
          try {
            const briefMap = await fetchStockBriefBatch(codes);
            if (briefMap.size > 0) {
              // v9.36（B2）：溢价均值/4档分布/核按钮/晋级率 全部抽到纯函数
              const stats = computePrevZtStats({ prevZTPool, todayRawPool: limitPool?.rawZTPool ?? null, briefMap });
              premiumAvg = stats.premiumAvg;
              premiumDist = stats.premiumDist;
              if (stats.nuclearAlerts.length > 0) setNuclearAlerts(stats.nuclearAlerts);
              promotionRate = stats.promotionRate;
            }
          } catch { /* 查询失败 → premiumAvg 保持 null */ }
        }
      }

      let sentiment: number | null = null;
      let sentimentLabel = "数据不足";
      let sentimentFactors: SentimentFactors | null = null;
      if (brData && brData.total > 0) {
        const upRatio = brData.up / brData.total;
        const upDownScore = Math.round(upRatio * 40 * 10) / 10;
        const limitDiff = limitPool ? limitPool.limitUpCount - limitPool.limitDownCount : 0;
        const limitScore = Math.round(Math.max(-15, Math.min(15, limitDiff * 0.3)) * 10) / 10;
        const avgPctScore = Math.round(Math.max(-15, Math.min(15, brData.avgPct * 3)) * 10) / 10;
        let indexScore = 0;
        if (idxData.length > 0) {
          const avgIdxPct = idxData.reduce((s, idx) => s + (idx.pct ?? 0), 0) / idxData.length;
          indexScore = Math.round(Math.max(-15, Math.min(15, avgIdxPct * 5)) * 10) / 10;
        }
        // 涨停池加分（涨停多=市场活跃）
        const limitUpBonus = limitPool ? Math.round(Math.min(10, limitPool.limitUpCount * 0.1) * 10) / 10 : 0;
        // 炸板率扣分（炸板多=情绪不稳）
        const blastedPenalty = limitPool ? Math.round(Math.min(8, limitPool.blastedRate * 0.15) * 10) / 10 : 0;
        // 主力资金方向加减分
        const fundFlowScore = fm0 ? Math.round(Math.max(-8, Math.min(8, fm0.mainNet / 1e10)) * 10) / 10 : 0;

        // 溢价因子：premiumAvg 为 null 计 0；否则 clamp 到 ±5
        const premiumScore = premiumAvg != null
          ? Math.round(Math.max(PREMIUM_SCORE_MIN, Math.min(PREMIUM_SCORE_MAX, premiumAvg)) * 10) / 10
          : 0;
        // 晋级率因子
        let promotionScore = 0;
        if (promotionRate != null) {
          let matched = false;
          for (const tier of PROMO_TIER) {
            if (promotionRate >= tier.threshold) { promotionScore = tier.score; matched = true; break; }
          }
          if (!matched) promotionScore = PROMO_FLOOR_SCORE;
        }

        sentimentFactors = { upDownScore, limitScore, avgPctScore, indexScore, limitUpBonus, blastedPenalty, fundFlowScore, premiumScore, promotionScore };
        sentiment = Math.round(upDownScore + limitScore + avgPctScore + indexScore + limitUpBonus - blastedPenalty + fundFlowScore + premiumScore + promotionScore + 15);
        sentiment = Math.max(0, Math.min(100, sentiment));

        if (sentiment >= 80) sentimentLabel = "极度贪婪";
        else if (sentiment >= 65) sentimentLabel = "贪婪";
        else if (sentiment >= 45) sentimentLabel = "中性";
        else if (sentiment >= 25) sentimentLabel = "恐慌";
        else sentimentLabel = "极度恐慌";
        // 信号账本：情绪分穿越关键阈值时记录
        if (sentiment >= 80 || sentiment <= 25) {
          const today = localDateStr();
          appendSignal({
            date: today, type: "sentiment_cross", typeLabel: sentiment >= 80 ? "极度贪婪" : "极度恐慌",
            code: "MARKET", name: "全市场", priceAtSignal: idxData[0]?.price ?? 0,
            description: `情绪温度计${sentiment}分(${sentimentLabel})`,
          });
        }
      }
      // 情绪分按交易日冻结存储（有效值才保存，null 不保存）
      if (sentiment != null) {
        saveTodaySentiment(sentiment);
        // P2：日内轨迹采样（5分钟节流），供情绪动量折线/仓位建议使用
        recordIntradaySentiment(sentiment);
      }
      const prevData = loadPrevTradingDaySentiment();
      const prevSentiment = prevData?.score ?? null;

      // 若当前情绪为 null（数据缺失），尝试用昨日情绪填充，仍为 null 则保持 null
      if (sentiment == null) {
        sentiment = prevSentiment; // 可能为 null（首日无数据）
        if (sentiment != null) {
          // 从存储恢复的昨日情绪，需要反推 sentimentLabel
          if (sentiment >= 80) sentimentLabel = "极度贪婪";
          else if (sentiment >= 65) sentimentLabel = "贪婪";
          else if (sentiment >= 45) sentimentLabel = "中性";
          else if (sentiment >= 25) sentimentLabel = "恐慌";
          else sentimentLabel = "极度恐慌";
        } else {
          sentimentLabel = "数据不足";
        }
      }

      // 计算昨日成交额和近5日均值
      const turnoverHist = turnoverHistRes.status === "fulfilled" ? turnoverHistRes.value : [];
      // turnoverHist[0] 是最新日（可能是今天），[1] 是昨天
      const yesterdayAmount = turnoverHist.length >= 2 ? turnoverHist[1].amount : null;
      const avg5dArr = turnoverHist.slice(1, 6); // 排除今天，取前5天
      const turnoverAvg5d = avg5dArr.length > 0 ? avg5dArr.reduce((s, t) => s + t.amount, 0) / avg5dArr.length : null;

      // 涨停池快照写入主刷新管道（与 Tab 解耦，确保高低切/断板检测次日有数据）
      if (limitPool && limitPool.rawZTPool && limitPool.rawZTPool.length > 0) {
        saveZTSnapshot(limitPool.qdate ?? tradeDateStr(), limitPool.rawZTPool);
      }

      setOverview({
        indices: idxData, breadth: brData, sentiment, sentimentLabel,
        sentimentFactors, sentimentYesterday: prevSentiment,
        limitPool,
        turnoverAmount: turnoverData.amount,
        turnoverYesterday: yesterdayAmount,
        turnoverAvg5d,
        premiumAvg,
        premiumDist,
        promotionRate,
        maxBoardHeight,
      });

      // === Fund Structure ===
      if (fundMain.status === "fulfilled") {
        const fm = fundMain.value;
        const mainNet = fm.mainNet;
        const smallNet = fm.smallNet;
        const mainNet5d = fm.mainNet5d;
        const mainNet10d = fm.mainNet10d;
        const mainOutRetailIn = mainNet < 0 && smallNet > 0;
        const persistentOutflow = mainNet5d < 0 && mainNet10d < 0;
        let verdict = "healthy";
        let vetoTriggered = false;
        const reasons: string[] = [];
        let actionHint = "";
        if (mainOutRetailIn && persistentOutflow) {
          vetoTriggered = true; verdict = "danger";
          reasons.push("今日主力资金净流出且散户净流入，同时近5日、近10日主力资金均为净流出");
          actionHint = "当前结构资金承压，历史统计中该类结构后续风险偏高。";
        } else if (mainOutRetailIn) {
          verdict = "warning";
          reasons.push("今日出现「主力净流出 + 散户净流入」结构，需警惕分歧加大");
          actionHint = "可小仓位试探，严格设置止损。";
        } else if (mainNet5d < 0 && mainNet < 0) {
          verdict = "warning";
          reasons.push("主力资金连续净流出（今日 + 近5日），资金面偏弱");
          actionHint = "建议观望，等待资金结构方向进一步明确。";
        } else if (mainNet > 0 && mainNet5d > 0) {
          verdict = "healthy";
          reasons.push("今日与近5日主力资金均为净流入，资金面结构健康");
          actionHint = "资金面支持顺势操作，仍需结合个股风险确认。";
        } else {
          verdict = "caution";
          reasons.push("资金结构处于分歧状态，今日与近5日方向不一致");
          actionHint = "建议观望，等待资金结构方向进一步明确。";
        }
        const history = fundHistory.status === "fulfilled" ? fundHistory.value : [];
        // 获取板块资金流排行（净流入/净流出 Top10）
        let boardRank: FundStructureData["boardRank"] = null;
        try {
          boardRank = await fetchBoardRankTopBottom("concept", 10);
        } catch { /* 板块排行获取失败不影响主数据 */ }
        setFundStructure({
          structure: {
            today: { mainNet: fm.mainNet, extraLargeNet: fm.extraLargeNet, largeNet: fm.largeNet, mediumNet: fm.mediumNet, smallNet: fm.smallNet },
            mainNet5d: fm.mainNet5d, mainNet10d: fm.mainNet10d,
            verdict, vetoTriggered, reasons, actionHint,
          },
          history,
          boardRank,
          turnoverAmount: turnoverData.amount,
        });
      }

      // === Global ===
      let commodities: GlobalIndex[] = [];
      try { commodities = await fetchCommodities(); } catch { /* skip */ }
      setGlobalData({
        globalSignals: globals.status === "fulfilled" ? globals.value : [],
        commodities,
        turnover: turnover.status === "fulfilled" ? turnover.value : { amount: 0, available: false },
      });

      // === Dark Pool (concept boards) ===
      // 明暗盘判断逻辑（参照同花顺6种组合模型）：
      // 明盘 = 超大单+大单（明面上的大资金行为）
      // 暗盘 = 中单+小单（看似散户，但可能包含主力拆单的隐蔽资金）
      // 四象限判断（f62≡f66+f72，totalFlow与openNet恒等，只有openNet与darkNet两个独立维度）
      function judgeFlowType(openNet: number, darkNet: number): string {
        if (openNet >= 0 && darkNet >= 0) return "共振流入（看多）";
        if (openNet < 0 && darkNet < 0) return "共振流出（看空）";
        if (openNet >= 0 && darkNet < 0) return "主力承接（分歧偏多）";
        return "主力撤离（分歧偏空）";
      }

      try {
        const conceptBoards = await fetchBoardFundFlow("concept", 60);
        const topBoards: DarkPoolData["topBoards"] = [];
        for (const d of conceptBoards) {
          if (!isRealConceptBoard(d.name)) continue;
          const openNet = d.extraLargeNet + d.largeNet;
          const darkNet = d.mediumNet + d.smallNet;
          const flowType = judgeFlowType(openNet, darkNet);
          topBoards.push({ code: d.code, name: d.name, pct: d.pct, openNet, darkNet, flowType, boardType: "concept" });
        }
        // 按主力净流入（mainNet = openNet）排序
        topBoards.sort((a, b) => b.openNet - a.openNet);
        const top10 = topBoards.slice(0, 10);

        // 全市场级别
        const fm = fundMain.status === "fulfilled" ? fundMain.value : null;
        const marketOpenNet = fm ? fm.extraLargeNet + fm.largeNet : 0;  // 明盘
        const marketDarkNet = fm ? fm.mediumNet + fm.smallNet : 0;       // 暗盘
        const marketTotalFlow = fm ? fm.mainNet : 0; // 资金总体流向=主力净流入(f62)
        const marketMainNet5d = fm ? fm.mainNet5d : 0;
        const marketMainNet10d = fm ? fm.mainNet10d : 0;

        const marketFlowType = fm ? judgeFlowType(marketOpenNet, marketDarkNet) : "数据不足";

        // Fetch constituents for ALL top10 boards
        const boardStocks: Record<string, BoardStock[]> = {};
        const stockFetchPromises = top10.map(async (b) => {
          try {
            const stocks = await fetchBoardConstituents(b.code, 8);
            boardStocks[b.code] = stocks;
          } catch {
            boardStocks[b.code] = [];
          }
        });
        await Promise.allSettled(stockFetchPromises);

        setDarkPool({
          totalFlow: marketTotalFlow,
          openPoolToday: marketOpenNet, darkPoolToday: marketDarkNet,
          darkPool5d: marketMainNet5d, darkPool10d: marketMainNet10d,
          marketFlowType, topBoards: top10, boardStocks,
        });
      } catch {
        // 失败时保留上一次有效数据（比清空显示"获取失败"更好）
        // 首次即失败才显示null→"数据不可用"
        if (!darkPoolRef.current) setDarkPool(null);
      }

      // === Mainline ===
      let mainlineBoards: MainlineData["boards"] = []; // 作战引擎需要引用
      try {
        // v9.12 修复：扩大主线拉取范围（industry 10→30, concept 10→30, region 6→10），
        // 让"持仓-主线匹配"更容易命中（涨停票常因小众概念发力，不在 top10 industry 内）
        const [industryRes, conceptRes, regionRes] = await Promise.allSettled([
          fetchBoardFundFlow("industry", 30),
          fetchBoardFundFlow("concept", 30),
          fetchBoardFundFlow("region", 10),
        ]);
        const boards: MainlineData["boards"] = [];
        for (const r of [industryRes, conceptRes, regionRes]) {
          if (r.status !== "fulfilled") continue;
          for (const b of r.value) {
            const { stage, reason } = stageOfFunds({ pct: b.pct, mainNetPct: b.mainNetPct, mainNet5dPct: b.mainNet5dPct, mainNet10dPct: b.mainNet10dPct });
            boards.push({ ...b, stage, stageReason: reason, weight: boardWeight(stage) });
          }
        }
        boards.sort((a, b) => b.mainNet - a.mainNet);
        const topBoards = boards.slice(0, 15);
        const leaderBoards = topBoards.filter(b => b.weight === "推荐关注").slice(0, 3);
        const potential: MainlineData["potential"] = [];
        for (const board of leaderBoards) {
          try {
            const stocks = await fetchBoardConstituents(board.code, 6);
            for (const s of stocks) {
              const vetoReasons: string[] = [];
              if (s.mainNet < 0 && s.smallNet > 0) vetoReasons.push("主力净流出而散户净流入，结构不健康");
              if (s.pct >= stockLimitPct(s.code) - 0.2) vetoReasons.push("已涨停，短线博弈风险陡增");
              if (s.turnoverRate > 25) vetoReasons.push("换手率过高（>25%），交易过度拥挤");
              let crowding = "正常";
              if (s.turnoverRate > 20 || s.volumeRatio > 3) crowding = "极度拥挤";
              else if (s.turnoverRate > 10 || s.volumeRatio > 1.8) crowding = "偏高";
              potential.push({
                code: s.code, name: s.name, price: s.price, pct: s.pct,
                mainNet: s.mainNet, mainNetPct: s.mainNetPct, turnoverRate: s.turnoverRate,
                volumeRatio: s.volumeRatio, pe: s.pe, boardName: board.name,
                vetoed: vetoReasons.length > 0, vetoReasons, crowding,
              });
            }
          } catch { /* skip */ }
        }
        const seen = new Set<string>();
        const dedupedPotential = potential.filter(p => { if (seen.has(p.code)) return false; seen.add(p.code); return true; });
        dedupedPotential.sort((a, b) => Number(a.vetoed) - Number(b.vetoed) || b.mainNet - a.mainNet);
        mainlineBoards = topBoards; // 供作战引擎复用
        setMainline({ boards: topBoards, potential: dedupedPotential.slice(0, 15) });
      } catch {
        setMainline(null);
      }

      // ============== 作战推荐引擎（规则机版） ==============
      try {
        // 需要 overview 数据（此处 limitPool/sentiment 已算好）
        const overviewForGate: OverviewData = {
          indices: idxData, breadth: brData, sentiment, sentimentLabel,
          sentimentFactors, sentimentYesterday: prevSentiment, limitPool,
          turnoverAmount: turnoverData.amount, turnoverYesterday: yesterdayAmount,
          turnoverAvg5d, premiumAvg, promotionRate, maxBoardHeight,
        };
        const gate = computeGate(overviewForGate);

        // ============== 主线作战引擎（v9.16 打破重建） ==============
        // 三层：涨停潮检测 → 风格感知 → 主线排序 + ETF 直出
        const mlBoards = mainlineBoards;
        const rawPool = limitPool?.rawZTPool ?? [];
        // v9.16 修复：newsItems 原来写死空数组 → 接 dataStore 真实新闻（近2日）
        const { news: storeNews } = getAllSince(localDateStrOffset(2));
        const newsItems: ThemeNewsItem[] = storeNews.map(n => ({ title: n.title, stars: n.stars ?? 0 }));
        const hlPulseNew: string[] = [];

        // 行业频道新增一次拉取（v9.30.1：all=true 拉全量含流出行业，资金走势图红绿双榜才完整）
        let industryBoards: typeof mlBoards = [];
        try {
          const indRaw = await fetchBoardFundFlow("industry", 30, { all: true });
          industryBoards = indRaw.map(b => {
            const { stage } = stageOfFunds({ pct: b.pct, mainNetPct: b.mainNetPct, mainNet5dPct: b.mainNet5dPct, mainNet10dPct: b.mainNet10dPct });
            return { ...b, stage, stageReason: "", weight: "" };
          });
        } catch { /* 行业频道拉取失败不影响题材推荐 */ }

        // 合并：mlBoards(concept已过滤style) + industryBoards，带kind字段
        // F-08 修复：保留 mainNet/mainNet5d（旧版 map 丢弃后 as unknown as 强断言，导致资金显示 undefined/NaN）
        const allScoringBoards = [
          ...mlBoards
            .filter(b => { const k = classifyBoard(b.name, "concept"); return k === "theme"; })
            .map(b => ({ code: b.code, name: b.name, pct: b.pct, mainNet: b.mainNet, mainNet5d: b.mainNet5d, mainNetPct: b.mainNetPct, mainNet5dPct: b.mainNet5dPct, mainNet10dPct: b.mainNet10dPct, stage: b.stage, kind: "theme" as const })),
          ...industryBoards
            .filter(b => classifyBoard(b.name, "industry") === "industry")
            .map(b => ({ code: b.code, name: b.name, pct: b.pct, mainNet: b.mainNet, mainNet5d: b.mainNet5d, mainNetPct: b.mainNetPct, mainNet5dPct: b.mainNet5dPct, mainNet10dPct: b.mainNet10dPct, stage: b.stage, kind: "industry" as const })),
        ];

        // v9.26.20：行业资金流向图 —— 不硬编码数量，全部有数据的行业板块传入，组件按实际数据动态展示
        const sortedIndustry = [...industryBoards]
          .filter(b => b.code && typeof b.mainNet === "number" && Number.isFinite(b.mainNet))
          .sort((a, b) => (b.mainNet ?? 0) - (a.mainNet ?? 0));
        const topIndustryFund = sortedIndustry
          .map(b => ({ code: b.code, name: b.name, mainNet: b.mainNet ?? 0 }));
        setTopIndustryFund(topIndustryFund);

        const themeResults = rawPool.length > 0 && allScoringBoards.length > 0
          ? computeThemeScores(allScoringBoards, rawPool, newsItems, hlPulseNew)
          : [];

        // ---- ① LLM 涨停主线归类（v9.17 核心：取代 hybk 硬分类） ----
        // 一次 LLM 调用把涨停池按"软语义"重新归类到主线（AI应用/云计算/机器人等）
        // 失败降级回 hybk 硬分类（stockToMainline.fallbackByHybk）
        const llmClassify = await classifyStocksToMainlines({
          rawPool,
          // F-08 修复：字段已补全，无需 as unknown as 强断言
          boards: allScoringBoards,
          newsItems,
        });
        // 把 LLM 归类结果适配到 candidates（BattlePlan.tsx 期望的形状）
        const candidates: MainlineGroup[] = llmClassify.groups;
        const classifyOverview = llmClassify.overview;

        // ---- v9.23-1/2：主线强度分 + 离场信号注入（PRD 6.1/6.4） ----
        // 基于涨停家数占比/连板高度/资金连续性 计算，避免"资金流入金额大≠主线强"
        try {
          const totalZt = rawPool.length || 30;
          // v9.23.1-fix：昨日涨停池按主线分组（用股票名匹配 candidates.mainline 或 hybk 近似）
          // 由于没有"昨日主线归类"历史，用"今日主线名包含昨日股名/昨日股 hybk 匹配今日主线"近似
          const yesterdayZtByMainline = new Map<string, { zt: number; height: number }>();
          if (prevZTPool && prevZTPool.length > 0) {
            for (const z of prevZTPool) {
              const yHybk = String(z.hybk ?? "");
              const yName = String(z.n ?? "");
              // 尝试匹配到今日某个主线（按 hybk 或 名字模糊匹配）
              for (const c of candidates) {
                if (
                  c.mainline.includes(yHybk) ||
                  yHybk.includes(c.mainline) ||
                  c.mainline.includes(yName.slice(0, 2)) ||
                  c.leaders.some(l => l.name === yName)
                ) {
                  const cur = yesterdayZtByMainline.get(c.mainline) ?? { zt: 0, height: 0 };
                  yesterdayZtByMainline.set(c.mainline, {
                    zt: cur.zt + 1,
                    height: Math.max(cur.height, z.lbc ?? 1),
                  });
                  break;
                }
              }
            }
          }
          for (const c of candidates) {
            // v9.26 A.4：快照抓取时间（每条候选打同一时间戳，可回放审计）
            c.observedAt = new Date().toISOString();
            const strength = calcMainlineStrength({
              ztCount: c.ztCount,
              totalZtCount: totalZt,
              height: c.height,
              totalMaxHeight: Math.max(...candidates.map(x => x.height), 2),
              promotionRate: null, // 晋级率暂无逐主线数据，中性
              mainNet5d: c.mainNet5d,
              mainNet10d: null,
              boardPct: c.boardPct,
              turnoverRate: null,
              catalystStrength: c.newsTitles.length > 0 ? 60 : 50, // 有新闻催化 → 略加分
            });
            c.strengthScore = strength.score;
            c.strengthFactors = strength.factors;
            // v9.26 F-12：数据完整度 + 缺失字段（UI 显示"数据缺失"与置信度下调）
            c.strengthCompleteness = strength.dataCompleteness;
            c.strengthMissing = strength.missingFields;
            // v9.23.1-fix：离场信号接入昨日数据（涨停数/高度环比）
            const yesterday = yesterdayZtByMainline.get(c.mainline);
            const exit = checkExitSignal({
              mainline: c.mainline,
              ztCountToday: c.ztCount,
              ztCountYesterday: yesterday?.zt ?? null,
              heightToday: c.height,
              heightYesterday: yesterday?.height ?? null,
              blastedRateToday: limitPool?.blastedRate ?? null,
              blastedRateYesterday: null, // 昨日炸板率无快照，暂缺
              mainNetToday: c.mainNet,
              mainNetYesterday: null, // 昨日资金无快照，暂缺
            });
            c.exitSignal = exit.triggered;
            c.exitSignalText = exit.text;
          }
          // 按强度分重新排序（最强主线在前）
          candidates.sort((a, b) => (b.strengthScore ?? 0) - (a.strengthScore ?? 0));
        } catch { /* 强度分计算失败不影响主流程 */ }

        // ---- ①.5 人气榜对照（v9.17-fix）：给各主线龙头打人气排名 ----
        // 用户要求对照人气榜单 + 资金进攻强度（如蓝色光标人气第一）
        // 失败静默（不影响主线展示）
        try {
          const popularityList = await fetchPopularityRank(50);
          const popRank = new Map<string, number>();
          popularityList.forEach((item, idx) => {
            if (item.code) popRank.set(item.code, idx + 1);
          });
          for (const c of candidates) {
            for (const l of c.leaders) {
              const rank = popRank.get(l.code);
              if (rank != null) l.popularRank = rank;
            }
            // 龙一未入榜但组内涨停人气最高 → 用组内最高的人气
            if (c.leaders.length > 0 && c.leaders[0].popularRank < 0) {
              let bestRank = -1;
              for (const l of c.leaders) if (l.popularRank > 0) bestRank = Math.min(bestRank < 0 ? l.popularRank : bestRank, l.popularRank);
            }
          }
        } catch { /* 人气榜不可用不阻塞 */ }

        // ---- ② 市场风格感知（进攻/轮动/防守） ----
        const marketStyle = detectMarketStyle({
          sentiment,
          gateFactor: gate.factor,
          ztCount: rawPool.length,
          blastedRate: limitPool?.blastedRate ?? null,
          maxBoardHeight: maxBoardHeight ?? 0,
          upRatio: brData && brData.total > 0 ? brData.up / brData.total : null,
        });

        // ETF 行情：一次批量查询（fields 含 f164=5日主力净额）
        const etfQuotes = new Map<string, ETFQuote>();
        try {
          const etfSecids = ETF_POOL.map(s => `${/^(60|68|5)/.test(s.code) ? "1" : "0"}.${s.code}`).join(",");
          const etfUrl = `https://push2.eastmoney.com/api/qt/ulist.np/get?ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&fields=f3,f12,f14,f62,f164&secids=${etfSecids}`;
          const etfJson = await (await import("./lib/jsonpQueue")).queuedJsonp<any>(etfUrl, 8000, "cb", 1);
          const etfDiffRaw = etfJson?.data?.diff;
          const etfDiff: any[] = Array.isArray(etfDiffRaw) ? etfDiffRaw : (etfDiffRaw && typeof etfDiffRaw === "object" ? Object.values(etfDiffRaw) : []);
          for (const d of etfDiff) {
            const code = String(d.f12 ?? "");
            if (code) {
              etfQuotes.set(code, {
                code,
                mainNet5d: Number(d.f164) || 0,
                pct: Number(d.f3) || 0,  // v9.22-fix: ETF 自身今日涨跌幅
                valid: true,
              });
            }
          }
        } catch {
          console.warn("[ETF批量行情] 请求失败，资金趋势维记50");
        }

        const themeScoreMap = new Map<string, number>();
        for (const t of themeResults) themeScoreMap.set(t.board, t.total);

        // 商品涨跌幅映射
        const commodityPcts: Record<string, number> = {};
        try {
          for (const c of commodities) {
            if (c.name.includes("黄金")) commodityPcts.gold = c.pct;
            if (c.name.includes("原油")) commodityPcts.oil = c.pct;
            if (c.name.includes("铜")) commodityPcts.copper = c.pct;
          }
        } catch { /* commodities 可能未定义 */ }

        // ---- ③ ETF 评分（风格感知 + 主线直出） ----
        const etfResults = computeETFScores(etfQuotes, themeScoreMap, commodityPcts, marketStyle, candidates.map(c => ({ board: c.mainline })));
        const topETFs = etfResults.slice(0, 4); // 多只 ETF 排序

        // 候选观察池（板块4-8名）
        const candidateThemes = themeResults.slice(3, 8).map(t => ({ board: t.board, total: t.total, tier: t.tier }));

        // ---- 先用规则分渲染作战卡（渐进式：先规则后LLM） ----
        setBattlePlan({ gate, candidates, llmRanked: null, marketStyle, etfs: topETFs, candidateThemes, classifyOverview });

        // ?debug=1 诊断模式（Fix4：可观测性）
        if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("debug") === "1") {
          console.log("=== 主线引擎（LLM 归类）===", { 情绪: sentiment, 涨停数: rawPool.length, 风格: marketStyle.label, 风险偏好: marketStyle.riskAppetite, 闸门: gate.factor, 归类概览: classifyOverview });
          console.table(candidates.slice(0, 8).map(c => ({ 主线: c.mainline, 涨停: c.ztCount, 高度: c.height, 资金: (c.mainNet / 1e8).toFixed(0) + "亿", 强度: c.score, 脉冲: c.isPulse ? "是" : "否", 龙一: c.leaders[0]?.name ?? "—", 龙二: c.leaders[1]?.name ?? "—" })));
          console.table(etfResults.map(e => ({ 代码: e.code, 名称: e.name, 总分: e.total, 置信: e.tier, 资金: e.factors.fundTrend, 联动: e.factors.boardLink, 风格: e.factors.styleFit, 主线: e.factors.mainlineLink, 宏观: e.factors.macro, 直出: e.fromMainline ? e.matchedMainline : "" })));
        }

        // 推荐落盘（每日首次，同日同code不重复）
        const recDate = localDateStr();
        const recGateFactor = gate.factor ?? 0;
        for (const c of candidates.slice(0, 5)) {
          recordRecommendation({ date: recDate, type: "theme", code: c.mainline, board: c.mainline, priceAtRec: 0, totalScore: c.score, gateFactor: recGateFactor });
          for (const l of c.leaders) {
            recordRecommendation({ date: recDate, type: "stock", code: l.code, board: c.mainline, priceAtRec: 0, totalScore: c.score, gateFactor: recGateFactor });
          }
        }
        for (const e of topETFs) {
          recordRecommendation({ date: recDate, type: "etf", code: e.code, board: e.matchedMainline ?? "", priceAtRec: 0, totalScore: e.total, gateFactor: recGateFactor });
        }

        // ---- LLM 主线精排（异步补位，不阻塞首次渲染） ----
        // 调用频率：规则渲染后 1 次 + 每 20-30 分钟（payload 变化时，由调用方节流）；
        // 失败自动降级回规则排序（rankMainlinesWithLLM 内部处理）
        // v9.25：聚合深度催化（业绩/收入指引/政策/中标）注入 LLM payload，
        //        让"医药生物 - 药明康德业绩大增"类强催化被识别到
        if (candidates.length > 0) {
          const { news: catNews, ann: catAnn } = getAllSince(localDateStrOffset(3));
          const catalystsMap = buildMainlineCatalysts(candidates.map(c => c.mainline), catNews, catAnn);
          (async () => {
            try {
              const seq = ++llmRankSeq.current; // v9.26.9：竞态护栏——只应用最新一轮结果
              const llmRanked = await rankMainlinesWithLLM(candidates.slice(0, 6), marketStyle, catalystsMap);
              if (seq === llmRankSeq.current) {
                setBattlePlan(prev => prev ? { ...prev, llmRanked } : prev);
              }
            } catch { /* LLM 精排失败 → 保持规则排序 */ }
          })();
        }

      } catch {
        setBattlePlan(null);
      }

      setLastUpdated(new Date().toISOString());
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }, []);

  // 同步当前 tab → URL hash + localStorage（便于分享/记忆）
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.location.hash = active;
    try { localStorage.setItem("stock:activeTab", active); } catch {}
  }, [active]);

  // 首次加载
  useEffect(() => { refreshAll(); }, [refreshAll]);
  // 每日构建板块映射表（数据驱动，零硬编码）
  useEffect(() => { ensureBoardMap().catch(e => console.warn("[boardMap] 首次构建失败:", e)); }, []);

  // ============ v9.28（P1-8）：盘中高频小通道 ============
  // 主刷新 60s 对"9:30:05 龙一直线封板"级爆发太慢；本通道独立 18s 一次，
  // 仅刷涨停池（轻量接口，走 fetchLimitPoolSummary），让"第一时间识别主线"更快。
  // 竞价段（auction）同样高频刷涨停池 —— 竞价涨停价锁定即出现，实现"竞价即封板"早期信号。
  // 不碰板块资金/新闻/公告等重接口（仍走主刷新 60s），避免全量轮询打爆东财限流。
  const refreshFast = useCallback(async () => {
    const phase = getCurrentSession().phase;
    if (phase !== "trading" && phase !== "auction") return;
    try {
      const limitPool = await fetchLimitPoolSummary();
      setOverview(prev => (prev ? { ...prev, limitPool } : prev));
      // v9.34（S1）：封单衰减检测（与上一轮 18s 快照对比）
      if (phase === "trading" && limitPool?.rawZTPool?.length) {
        const alerts = detectSealDecay(limitPool.rawZTPool);
        if (alerts.length > 0) setSealAlerts(alerts);
      }
    } catch { /* 静默：高频通道失败不影响主刷新 */ }
  }, []);
  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(() => { refreshFast(); }, 18000);
    return () => clearInterval(t);
  }, [autoRefresh, refreshFast]);

  // 交易时段状态机驱动刷新：盘中60s、集合竞价30s、盘后300s、休市不刷
  // v9.26 F-01 修复：倒计时只用于显示（ref 计数），interval 只依赖 autoRefresh/refreshAll，
  // 不再依赖 countdown state（旧版每 setCountdown 一次就销毁重建 interval，countdown 永远到不了 0）
  // v9.26.10：App 不再每秒 setCountdown（避免全树每秒重渲染）——只维护 nextRefreshAt 时间戳，
  //           TopNav 内部每秒本地计算剩余秒数。
  useEffect(() => {
    if (!autoRefresh) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let nextAt = 0;
    const computeIntervalMs = (): number => {
      const s = getCurrentSession();
      return s.refreshIntervalMs || 60000;
    };
    const arm = () => {
      nextAt = Date.now() + computeIntervalMs();
      setNextRefreshAt(nextAt);
    };
    arm();
    timer = setInterval(() => {
      if (cancelled) return;
      if (Date.now() >= nextAt) {
        arm(); // 先排下一次（防刷新耗时 > 周期时连刷）
        refreshAll();
      }
    }, 1000);
    return () => { cancelled = true; if (timer) clearInterval(timer); };
  }, [autoRefresh, refreshAll]);

  // 每分钟更新时段
  useEffect(() => {
    const t = setInterval(() => setCurrentPhase(getCurrentSession().phase), 60000);
    return () => clearInterval(t);
  }, []);

  // v9.33（缺口3）：LLM 盘后三剧本 + 竞价龙头预判 + 风险雷达（LLM 可用时自动触发一次）
  const llmBriefSeq = useRef(0); // 护栏：只触发一次（避免每轮 refreshAll 重复调用）
  useEffect(() => {
    let cancelled = false;
    const phase = getCurrentSession().phase;
    const bl = battlePlan;
    const ov = overview;
    if (!bl || !ov) return;
    // 已触发过同类型 → 跳过（盘后/竞价各一次）
    const want = phase === "post" ? "post" : phase === "auction" ? "auction" : null;
    if (!want) return;
    if (llmBriefSeq.current === (want === "post" ? 1 : 2)) return;

    // 盘后（15:00 后）：三剧本 + 风险雷达
    if (want === "post" && bl.candidates.length > 0) {
      llmBriefSeq.current = 1;
      const top3 = bl.candidates.slice(0, 3).map(c => `${c.mainline}(强度${c.strengthScore ?? c.score ?? 0}/涨停${c.ztCount})`).join("；");
      const prompt = `今日涨停${ov.limitPool?.limitUpCount ?? 0}只，炸板率${ov.limitPool?.blastedRate?.toFixed(1) ?? "?"}%，最高${ov.maxBoardHeight ?? "?"}板，情绪${ov.sentiment ?? "?"}分。\nTop3主线：${top3}\n昨日溢价均值：${ov.premiumAvg ?? "?"}%`;
      callAI("nextDayScenarios", { prompt }).then((r) => {
        if (cancelled) return;
        try {
          const arr = parseAIJSON<Array<{ scenario: string; probability: number; conditions: string[]; focus: string[] }>>(r.text);
          if (Array.isArray(arr) && arr.length > 0) setNextScenarios(arr.slice(0, 3));
        } catch { /* 解析失败静默 */ }
      }).catch(() => {});
      // 风险雷达（黑天鹅公告 + 跌停池由 overview 提供）
      const rPrompt = `涨停${ov.limitPool?.limitUpCount ?? 0}只，跌停${ov.limitPool?.limitDownCount ?? 0}只，炸板率${ov.limitPool?.blastedRate?.toFixed(1) ?? "?"}%，情绪${ov.sentiment ?? "?"}分。`;
      callAI("riskRadar", { prompt: rPrompt }).then((r) => {
        if (cancelled) return;
        try {
          const j = parseAIJSON<{ level: string; points: Array<{ item: string; desc: string }>; advice: string }>(r.text);
          if (j && j.level) setRiskRadarText(`风险雷达[${j.level}]：${(j.points ?? []).map(p => `${p.item}(${p.desc})`).join("；") || "无明显风险"}${j.advice ? `。建议：${j.advice}` : ""}`);
        } catch { /* 静默 */ }
      }).catch(() => {});
    }
    // 竞价段（9:15-9:25）：龙头预判
    if (want === "auction") {
      llmBriefSeq.current = 2;
      const yesterday = loadPrevZTSnapshot(ov.limitPool?.qdate ?? null) ?? [];
      const yt = yesterday.slice(0, 15).map(s => `${s.n ?? s.c}(${s.lbc ?? 1}板)`).join("，");
      const zt = (ov.limitPool?.rawZTPool ?? []).slice(0, 15).map((s: any) => `${s.n}(首封${String(s.fbt ?? 0)})`).join("，");
      callAI("leaderPredict", { prompt: `昨日涨停：${yt || "无"}\n今日已涨停：${zt || "无（竞价未出）"}` }).then((r) => {
        if (cancelled) return;
        try {
          const j = parseAIJSON<{ predictLeader: { code: string; name: string } | null; confidence: number; reason: string; watch: string }>(r.text);
          if (j) setLeaderPredict({ predictLeader: j.predictLeader ?? null, confidence: Number(j.confidence) || 0, reason: String(j.reason ?? ""), watch: String(j.watch ?? "") });
        } catch { /* 静默 */ }
      }).catch(() => {});
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPhase, battlePlan, overview]);

  // 自选股异动带：每次刷新后用 fetchStockBriefBatch 批量拉取
  useEffect(() => {
    if (!overview) return;
    let cancelled = false; // v9.26.9：慢响应不再覆盖新响应
    (async () => {
      try {
        const raw = localStorage.getItem("stock_watchlist");
        const codes: string[] = raw ? JSON.parse(raw) : [];
        if (codes.length === 0) { if (!cancelled) setWatchStocks([]); return; }
        // v9.26.17：自选股全量（fetchStockBriefBatch 已支持分批）
        const map = await fetchStockBriefBatch(codes);
        if (cancelled) return;
        const items: WatchStockBrief[] = [];
        for (const [code, b] of map) {
          const alert = Math.abs(b.pct) >= 5 || b.turnoverRate > 10;
          const alertTag = Math.abs(b.pct) >= 5 ? `${b.pct > 0 ? "↑" : "↓"}${Math.abs(b.pct).toFixed(1)}%` : b.turnoverRate > 10 ? `换手${b.turnoverRate.toFixed(0)}%` : "";
          // v9.24-P1-4：量比注入（异动分级 S/A/B 用）
          items.push({ code, name: b.name, price: b.price, pct: b.pct, turnoverRate: b.turnoverRate, alert, alertTag, volumeRatio: b.volumeRatio, limitPct: stockLimitPct(code) });
        }
        items.sort((a, b) => Number(b.alert) - Number(a.alert) || Math.abs(b.pct) - Math.abs(a.pct));
        if (!cancelled) setWatchStocks(items);
      } catch { if (!cancelled) setWatchStocks([]); }
    })();
    return () => { cancelled = true; };
  }, [overview]);

  // 将三级警报发送到 alertBus（跃迁护栏：只在 false→true 时报一次）
  useEffect(() => {
    if (!overview) return;

    // 重度背离：资金数据缺失/为0不报
    const st = fundStructure?.structure;
    const mn = st?.today.mainNet, sn = st?.today.smallNet;
    const ok = mn != null && sn != null && mn !== 0 && sn !== 0;
    const divergenceActive = !!ok && mn! < 0 && sn! > 0 && (st?.mainNet5d ?? 0) < 0 && (st?.mainNet10d ?? 0) < 0;
    if (divergenceActive) {
      if (!lastSignalActive["divergence"]) { lastSignalActive["divergence"] = true; emitAlert({ severity: "critical", id: "veto_main", message: "重度背离：主力持续流出+散户接盘" }); }
    } else lastSignalActive["divergence"] = false;

    // 极度贪婪
    const sent = overview.sentiment;
    if (sent != null && sent >= 80) {
      if (!lastSignalActive["overbought"]) { lastSignalActive["overbought"] = true; emitAlert({ severity: "warning", id: "sentiment_high", message: `情绪${sent}分（极度贪婪），历史统计中追高风险偏高` }); }
    } else lastSignalActive["overbought"] = false;

    // 极度恐慌：sentiment≤0 不报（数据异常），null 也不报
    if (sent == null || sent <= 0) lastSignalActive["oversold"] = false;
    else if (sent < 20) {
      if (!lastSignalActive["oversold"]) { lastSignalActive["oversold"] = true; emitAlert({ severity: "warning", id: "sentiment_low", message: `情绪${sent}分（极度恐慌），超跌机会` }); }
    } else lastSignalActive["oversold"] = false;

    // 量能偏离（成交额 vs 5日均 ±50%）
    if (overview.turnoverAvg5d && overview.turnoverAvg5d > 0) {
      const ratio = overview.turnoverAmount / overview.turnoverAvg5d;
      if (ratio > 1.5) {
        if (!lastSignalActive["vol_high"]) { lastSignalActive["vol_high"] = true; emitAlert({ severity: "info", id: "vol_high", message: `成交额放量${(ratio * 100).toFixed(0)}%于5日均量` }); }
      } else lastSignalActive["vol_high"] = false;
      if (ratio < 0.5) {
        if (!lastSignalActive["vol_low"]) { lastSignalActive["vol_low"] = true; emitAlert({ severity: "info", id: "vol_low", message: `成交额缩量至5日均量${(ratio * 100).toFixed(0)}%` }); }
      } else lastSignalActive["vol_low"] = false;
    }
  }, [overview, fundStructure]);

  // ============== P1 信号回填三保险 ==============
  // 1) 首载兜底：页面打开即尝试补全（之前只在 phase=post 且当天打开才触发）
  // 2) 定时兜底：每 30 分钟尝试一次（盘中也会补 T+1 的昨日信号）
  // 3) 手动按钮：SignalPanel 提供"补全回填"
  // 幂等：signalLedger 按天记录 isBackfilledToday / recTracker 按天 markAttributedToday
  useEffect(() => {
    const tryBackfill = async () => {
      // 信号账本回填（T+1/T+5）
      // F-09 修复：必须 await 成功后才标记完成（旧版未 await → 失败也标记，30 分钟重试被跳过）
      if (!isBackfilledToday()) {
        try {
          await runSignalBackfill();
          markBackfilledToday();
        } catch (e) {
          console.warn("[backfill] 信号回填失败，30 分钟后重试:", e);
          // 不标记 → 下轮定时重试
        }
      }
      // 推荐归因回填（T+1/T+3）
      runAttribution(localDateStr()).catch(() => { /* 回填失败不阻塞 */ });
    };
    tryBackfill();
    const t = setInterval(tryBackfill, 30 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  const vetoActive = fundStructure?.structure?.vetoTriggered;

  // ============== 高低切切换检测 ==============
  // 调试开关：URL ?simulate=1 时用构造数据演示两种警报样式（仅供验证，正常访问不触发）
  const isSimulateMode = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("simulate") === "1";

  // 加载昨日 ZTPool 快照（用"找最近历史快照"替代本地日期推算，天然兼容法定节假日）
  const yesterdayZTPool = loadPrevZTSnapshot(overview?.limitPool?.qdate ?? null);
  // v9.26.10：useMemo 缓存数组引用，避免每次渲染新数组 → AuctionBoard effect 每秒重建 → 每秒请求
  const yesterdayZtBrief = useMemo(
    () => yesterdayZTPool?.map(z => ({ code: String(z.c), name: String(z.n) })) ?? [],
    [yesterdayZTPool],
  );

  // 高低切检测：需要 mainline.boards 和 overview.limitPool.rawZTPool
  const hlSwitch = (() => {
    if (isSimulateMode) {
      // 构造模拟数据演示两种警报样式（注释标明仅供验证）
      return {
        stalledOld: ["AI概念", "半导体"],
        pulseNew: ["低空经济"],
        fullSwitch: true,
        noYesterdayData: false,
      };
    }
    const boards = mainline?.boards;
    const todayPool = overview?.limitPool?.rawZTPool as ZTPoolItem[] | undefined;
    if (!boards || !todayPool || todayPool.length === 0) return null;
    return detectHighLowSwitch(
      boards.filter(b => { const k = classifyBoard(b.name); return k === "theme" || k === "industry"; }).map(b => ({ name: b.name, pct: b.pct, mainNet5d: b.mainNet5d })),
      todayPool,
      yesterdayZTPool,
    );
  })();

  // 构建三级警报列表
  const alerts: AlertItem[] = [];
  // v9.34（S1）：封单衰减预警（龙一开板前兆，最高优先级）
  if (sealAlerts.length > 0) {
    const red = sealAlerts.filter(a => a.level === "red");
    const yellow = sealAlerts.filter(a => a.level === "yellow");
    if (red.length > 0) {
      alerts.push({ id: "seal_red", level: "critical", message: `💥 封单崩落：${red.slice(0, 3).map(a => `${a.name}(${a.boardCount}板)${a.changePct.toFixed(0)}%`).join("、")} 即将炸板！` });
    }
    if (yellow.length > 0) {
      alerts.push({ id: "seal_yellow", level: "warning", message: `⚠️ 封单衰减：${yellow.slice(0, 3).map(a => `${a.name}${a.changePct.toFixed(0)}%`).join("、")} 关注开板风险` });
    }
  }
  // v9.32.1（缺口1）：核按钮预警（昨高位涨停今日秒跌停）
  if (nuclearAlerts.length >= 2) {
    alerts.push({ id: "nuclear", level: "critical", message: `⚠️ 核按钮预警：${nuclearAlerts.slice(0, 3).join("、")}${nuclearAlerts.length > 3 ? ` 等${nuclearAlerts.length}只` : ""}，退潮信号` });
  } else if (nuclearAlerts.length === 1) {
    alerts.push({ id: "nuclear_1", level: "warning", message: `⚠️ 核按钮：${nuclearAlerts[0]}` });
  }
  // v9.32：系统性风险预警（最高优先级，置顶）
  if (overview) {
    const hs300 = overview.indices?.find(i => i.code === "000300");
    const sysRisk = checkSysRisk({
      hs300Pct: hs300?.pct ?? null,
      limitDownCount: overview.limitPool?.limitDownCount ?? 0,
      blastedRate: overview.limitPool?.blastedRate ?? 0,
      sentiment: overview.sentiment,
    });
    if (sysRisk.level === "red") alerts.push({ id: "sys_risk_red", level: "critical", message: sysRisk.text });
    else if (sysRisk.level === "yellow") alerts.push({ id: "sys_risk_yellow", level: "warning", message: sysRisk.text });
  }
  if (vetoActive) {
    alerts.push({ id: "veto_main", level: "critical", message: "重度背离：主力持续流出+散户接盘（历史统计风险偏高）" });
  }
  if (overview && overview.sentiment != null && overview.sentiment >= 80) {
    alerts.push({ id: "sentiment_high", level: "warning", message: `情绪温度计${overview.sentiment}分（极度贪婪），历史统计中后续风险偏高` });
  }
  if (overview && overview.sentiment != null && overview.sentiment <= 25) {
    alerts.push({ id: "sentiment_low", level: "warning", message: `情绪温度计${overview.sentiment}分（极度恐慌），关注超跌机会` });
  }
  // 高低切切换警报
  if (hlSwitch) {
    if (hlSwitch.fullSwitch) {
      // A+B 同日成立 → amber 级
      alerts.push({
        id: "hl_switch_full",
        level: "warning",
        message: `资金高低切：资金从[${hlSwitch.stalledOld.join("/")}]撤出迹象，[${hlSwitch.pulseNew.join("/")}]首板脉冲，关注换边`,
      });
    } else if (hlSwitch.pulseNew.length > 0) {
      // 仅B → info 提示
      alerts.push({
        id: "hl_switch_pulse",
        level: "info",
        message: `新题材首板脉冲：${hlSwitch.pulseNew.join("/")}`,
      });
    }
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#0d1424,_#05070d_60%)] pb-16">
      <TopNav
        active={active} onChange={setActive} lastUpdated={lastUpdated} loading={loading}
        autoRefresh={autoRefresh} onToggleAutoRefresh={() => setAutoRefresh(v => !v)} onRefreshNow={refreshAll}
        countdown={countdown} nextRefreshAt={nextRefreshAt || undefined}
      />

      {/* 常驻状态条（所有Tab可见） */}
      <StatusBar overview={overview} fund={fundStructure} />

      {/* 三级警报横幅 */}
      <AlertBanner alerts={alerts} />

      <main className="mx-auto max-w-[1500px] space-y-6 px-4 py-4">
        {/* ====== 驾驶舱 ====== */}
        {active === "dashboard" && (
          <Dashboard overview={overview} fund={fundStructure} globalData={globalData} mainline={mainline}
            battlePlan={battlePlan} loading={loading} phase={currentPhase} watchStocks={watchStocks}
            mainlines={battlePlan?.candidates.map(c => c.mainline) ?? []}
            onSwitchTab={(tab) => setActive(tab as TabKey)}
            ztPool={overview?.limitPool?.rawZTPool as Array<{ c: string; n: string; fbt: number; lbc: number }> ?? undefined}
            yesterdayZt={yesterdayZtBrief}
            nextScenarios={nextScenarios}
            leaderPredict={leaderPredict}
            riskRadarText={riskRadarText}
            sealAlerts={sealAlerts} />
        )}

        {/* ====== 资金主线（深潜：完整资金结构+明暗盘+全球信号+产业链） ====== */}
        {active === "fundline" && (
          <>
            {/* v9.24-P1-1：主线强度排行榜（PRD B1，页面首屏） */}
            <MainlineRanking battlePlan={battlePlan} loading={loading} />
            {/* v9.26.20：行业资金流向走势图（全部有数据的行业，组件按实际数量动态展示） */}
            {topIndustryFund.length > 0 && (
              <IndustryFundFlowChart boards={topIndustryFund} refreshSec={60} />
            )}
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <h3 className="mb-3 text-sm font-bold text-slate-200">资金结构详情</h3>
              <FundStructure data={fundStructure} loading={loading} />
            </div>
            <DarkPool data={darkPool} loading={loading} />
            <GlobalSignals data={globalData} loading={loading} />
            {/* 两融观察：全市场融资余额/净买入/历史趋势（独立拉取，T+1 数据） */}
            <MarginPanel />
            {/* 产业链价格：板块联动列复用 mainline.boards 已有数据，零新增请求 */}
            <CommodityChain boardPcts={(() => {
              const map: Record<string, number> = {};
              if (mainline?.boards) {
                for (const b of mainline.boards) map[b.name] = b.pct;
              }
              // 也从 darkPool topBoards 补充（覆盖更多板块名称）
              if (darkPool?.topBoards) {
                for (const b of darkPool.topBoards) {
                  if (!(b.name in map)) map[b.name] = b.pct;
                }
              }
              return map;
            })()} />
          </>
        )}

        {/* ====== 龙虎榜复盘（lazy） ====== */}
        {active === "dragon" && (
          <>
            {/* 题材梯队：复用 App 已拉取的 ZTPool 数据，不重复请求 */}
            <ThemeLadder rawZTPool={overview?.limitPool?.rawZTPool ?? null} />
            <Suspense fallback={<div className="text-slate-400 p-6">加载龙虎榜模块…</div>}>
              <DragonTiger />
              <LimitBoard />
            </Suspense>
          </>
        )}

        {/* ====== 个股雷达（lazy） ====== */}
        {active === "radar" && (
          <Suspense fallback={<div className="text-slate-400 p-6">加载个股雷达…</div>}>
            {/* v9.24-P1-2：传入今日主线名，供个股决策卡做主线归属判断 */}
            <StockWatchlist mainlines={battlePlan?.candidates.map(c => c.mainline) ?? []} />
          </Suspense>
        )}

        {/* ====== 消息面（lazy） ====== */}
        {active === "news" && (
          <Suspense fallback={<div className="text-slate-400 p-6">加载消息面…</div>}>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <h3 className="mb-3 text-sm font-bold text-slate-200">实时快讯（政策与市场动态）</h3>
              <NewsPanel autoRefresh={autoRefresh}
                strongBoards={
                  mainline?.boards.filter(b => b.mainNet > 0).slice(0, 5).map(b => b.name)
                  ?? fundStructure?.boardRank?.inflow.slice(0, 5).map(b => b.name)
                  ?? []
                }
                mainlines={battlePlan?.candidates.map(c => ({ name: c.mainline, ztCount: c.ztCount })) ?? []}
                marketSnapshot={overview ? {
                  // tsc-fix: OverviewData.sentiment 为 number|null，快照接口要求 number → 兜底 0
                  sentiment: overview.sentiment ?? 0,
                  indices: overview.indices.map(i => ({ name: i.name, pct: i.pct })),
                  mainNet: fundStructure?.structure?.today.mainNet ?? 0,
                  mainNet5d: fundStructure?.structure?.mainNet5d ?? 0,
                  mainNet10d: fundStructure?.structure?.mainNet10d ?? 0,
                } : null}
              />
            </div>
          </Suspense>
        )}
      </main>

      <footer className="mx-auto max-w-[1500px] px-4 py-4 text-center text-[11px] text-slate-600 space-y-1">
        <div>本终端仅用于实盘交易辅助监控，所有数据来自公开接口实时抓取，不构成投资建议</div>
        <div>资金结构 &gt; 涨跌幅 · 风险信号 &gt; 机会信号 · 阶段判断 &gt; 单一指标</div>
        <div className="text-slate-700">v9.38 · build 08-06 02:05 · 数据源：东方财富</div>
      </footer>
    </div>
  );
}
