import { useCallback, useEffect, useRef, useState, lazy, Suspense } from "react";
import { saveTodaySentiment, loadPrevTradingDaySentiment, recordIntradaySentiment } from "./lib/sentimentStore";
import TopNav, { type TabKey } from "./components/TopNav";
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
import { computeStockScores, type StockInput } from "./lib/stockScore";
import { computeETFScores, ETF_POOL, type ETFQuote } from "./lib/etfScore";
import { buildSeatProfiles } from "./lib/seatLedger";
import { scoreThemeNews, scoreStockNews, type StockNewsLLMResult } from "./lib/llmSignals";
import type { LLMCatalystOverride } from "./lib/themeScore";

import StatusBar from "./components/StatusBar";
import AlertBanner, { type AlertItem } from "./components/AlertBanner";
import { appendSignal } from "./lib/signalLedger";
import { runSignalBackfill, isBackfilledToday, markBackfilledToday } from "./lib/signalLedger";
import { recordRecommendation, runAttribution } from "./lib/recTracker";
import { getCurrentSession, type SessionPhase } from "./lib/tradingSession";
import { emit as emitAlert } from "./lib/alertBus";
import { localDateStr } from "./lib/format";

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

function judgeMainlineStage(b: { pct: number; mainNetPct: number; mainNet5dPct: number; mainNet10dPct: number }) {
  const { pct, mainNetPct, mainNet5dPct, mainNet10dPct } = b;
  if (mainNetPct < 0 && mainNet5dPct < 0)
    return { stage: "退潮期", reason: "今日与近5日主力净占比均为负，资金持续撤出" };
  if (pct >= 7 && (mainNetPct < mainNet5dPct - 1 || mainNetPct < 0))
    return { stage: "高潮期", reason: "涨幅已明显放大但今日主力净占比走弱甚至转负，量价背离" };
  if (mainNet5dPct > 3 && mainNet10dPct > 1 && mainNetPct > 0)
    return { stage: "发酵期", reason: "近5日、近10日主力净占比持续为正且在走强" };
  if (mainNetPct > 0 && Math.abs(mainNet5dPct) < 1.5)
    return { stage: "启动期", reason: "今日资金净流入转正，但近5日累计净占比尚小" };
  return { stage: "观察中", reason: "资金与涨幅信号不够一致，暂无法给出明确阶段判断" };
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
  const [countdown, setCountdown] = useState(60);
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [fundStructure, setFundStructure] = useState<FundStructureData | null>(null);
  const [darkPool, setDarkPool] = useState<DarkPoolData | null>(null);
  const [globalData, setGlobalData] = useState<GlobalData | null>(null);
  const [mainline, setMainline] = useState<MainlineData | null>(null);
  const [battlePlan, setBattlePlan] = useState<BattlePlanData | null>(null);
  const [watchStocks, setWatchStocks] = useState<WatchStockBrief[]>([]);
  const [currentPhase, setCurrentPhase] = useState<SessionPhase>(() => getCurrentSession().phase);
  const inFlight = useRef(false);

  const refreshAll = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    // 静默刷新：仅首次加载显示 loading 骨架，后续刷新数据原位更新不闪烁
    const isFirstLoad = overview === null;
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

      // 昨日快照 → 溢价 + 晋级率
      const prevZTPool = loadPrevZTSnapshot(limitPool?.qdate ?? null);
      if (prevZTPool && prevZTPool.length > 0) {
        // 取全部代码去重，超过100只取前100只（push2批量上限）
        const codes = [...new Set(prevZTPool.map(s => String(s.c)))].slice(0, 100);
        if (codes.length > 0) {
          try {
            const briefMap = await fetchStockBriefBatch(codes);
            if (briefMap.size > 0) {
              // 溢价：昨日涨停股今日涨幅的算术平均值
              let pctSum = 0, pctCount = 0;
              for (const code of codes) {
                const brief = briefMap.get(code);
                if (brief && Number.isFinite(brief.pct)) {
                  pctSum += brief.pct;
                  pctCount++;
                }
              }
              premiumAvg = pctCount > 0 ? Math.round(pctSum / pctCount * 100) / 100 : null;
            }
          } catch { /* 查询失败 → premiumAvg 保持 null */ }
        }

        // 晋级率：昨日 lbc===1（首板）的个股中，今日在涨停池且 lbc>=2（继续涨停）的比例
        // 这是真实"晋级率"：昨日首板今日继续封板的比例
        const yesterdayFirstBoard = prevZTPool.filter(s => (s.lbc ?? 1) === 1);
        if (yesterdayFirstBoard.length > 0 && limitPool && limitPool.rawZTPool) {
          const todayPoolCodes = new Map<string, number>();
          for (const s of limitPool.rawZTPool) {
            todayPoolCodes.set(String(s.c), s.lbc ?? 1);
          }
          let promoted = 0;
          for (const s of yesterdayFirstBoard) {
            const todayLbc = todayPoolCodes.get(String(s.c));
            if (todayLbc != null && todayLbc >= 2) promoted++;
          }
          promotionRate = Math.round(promoted / yesterdayFirstBoard.length * 1000) / 1000;
        }
        // 昨日没有首板个股→promotionRate保持null（无样本，不是0）
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
          actionHint = "当前结构不适合加仓，存量仓位应考虑控制风险。";
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
        if (!darkPool) setDarkPool(null);
      }

      // === Mainline ===
      let mainlineBoards: MainlineData["boards"] = []; // 作战引擎需要引用
      try {
        const [industryRes, conceptRes, regionRes] = await Promise.allSettled([
          fetchBoardFundFlow("industry", 10),
          fetchBoardFundFlow("concept", 10),
          fetchBoardFundFlow("region", 6),
        ]);
        const boards: MainlineData["boards"] = [];
        for (const r of [industryRes, conceptRes, regionRes]) {
          if (r.status !== "fulfilled") continue;
          for (const b of r.value) {
            const { stage, reason } = judgeMainlineStage({ pct: b.pct, mainNetPct: b.mainNetPct, mainNet5dPct: b.mainNet5dPct, mainNet10dPct: b.mainNet10dPct });
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

        // 双轨候选池：行业(t:2) + 题材(t:3)，地域移出
        const mlBoards = mainlineBoards;
        const rawPool = limitPool?.rawZTPool ?? [];
        const newsItems: ThemeNewsItem[] = [];
        const hlPulseNew: string[] = [];

        // 行业频道新增一次拉取（零浪费：30只足够覆盖Top行业）
        let industryBoards: typeof mlBoards = [];
        try {
          const indRaw = await fetchBoardFundFlow("industry", 30);
          industryBoards = indRaw.map(b => {
            const { stage } = judgeMainlineStage({ pct: b.pct, mainNetPct: b.mainNetPct, mainNet5dPct: b.mainNet5dPct, mainNet10dPct: b.mainNet10dPct });
            return { ...b, stage, stageReason: "", weight: "" };
          });
        } catch { /* 行业频道拉取失败不影响题材推荐 */ }

        // 合并：mlBoards(concept已过滤style) + industryBoards，带kind字段
        const allScoringBoards = [
          ...mlBoards
            .filter(b => { const k = classifyBoard(b.name, "concept"); return k === "theme"; })
            .map(b => ({ code: b.code, name: b.name, pct: b.pct, mainNetPct: b.mainNetPct, mainNet5dPct: b.mainNet5dPct, mainNet10dPct: b.mainNet10dPct, stage: b.stage, kind: "theme" as const })),
          ...industryBoards
            .filter(b => classifyBoard(b.name, "industry") === "industry")
            .map(b => ({ code: b.code, name: b.name, pct: b.pct, mainNetPct: b.mainNetPct, mainNet5dPct: b.mainNet5dPct, mainNet10dPct: b.mainNet10dPct, stage: b.stage, kind: "industry" as const })),
        ];

        const themeResults = rawPool.length > 0 && allScoringBoards.length > 0
          ? computeThemeScores(allScoringBoards, rawPool, newsItems, hlPulseNew)
          : [];

        // 排名制 Top N（闸门仅压缩数量，不乘入总分）
        const topThemeCount = gate.factor <= 0.5 ? 3 : 8;
        const topThemes = themeResults.slice(0, topThemeCount);

        // 个股分（factor≤0.3 时只出 ETF，跳过个股）
        let topStocks: import("./lib/stockScore").StockScoreResult[] = [];
        const allStockInputs: StockInput[] = []; // hoisted for candidate pool
        if (gate.factor > 0.3 && themeResults.length > 0) {
          // 对入选板块拉成分股（复用现有 JSONP 队列）
          const seatProfiles = buildSeatProfiles();
          const highPremiumSeats = new Set(seatProfiles.filter(p => p.premiumLevel === "high").map(p => p.deptName));

          for (const theme of topThemes.slice(0, 3)) {
            // 找板块代码（从 mlBoards 匹配）
            const boardInfo = [...mlBoards, ...industryBoards].find(b => b.name === theme.board);
            if (!boardInfo) continue;
            try {
              const constStocks = await fetchBoardConstituents(boardInfo.code, 15);
              for (const cs of constStocks) {
                if (allStockInputs.some(s => s.code === cs.code)) continue;
                allStockInputs.push({
                  code: cs.code, name: cs.name, price: cs.price, pct: cs.pct,
                  mainNet: cs.mainNet, mainNetPct: cs.mainNetPct, smallNet: cs.smallNet,
                  mainNet5d: (cs as any).mainNet5d ?? 0, mainNet5dPct: (cs as any).mainNet5dPct ?? 0,
                  extraLargeNet: cs.extraLargeNet ?? 0, largeNet: (cs as any).largeNet ?? 0,
                  mediumNet: cs.mediumNet ?? 0,
                  turnoverRate: cs.turnoverRate, volumeRatio: cs.volumeRatio,
                  limitPct: stockLimitPct(cs.code),
                  ladderRole: "跟风", // 简化：未做梯队角色精确匹配
                  inZTPool: rawPool.some((z: any) => String(z.c) === cs.code),
                  sealFundRatio: null,
                  seatPremiumHigh: highPremiumSeats.size > 0, // 简化
                  inPopularityTop10: false,
                });
              }
            } catch { /* 成分股获取失败跳过 */ }
          }

          const scored = computeStockScores(allStockInputs);
          topStocks = scored.filter(s => !s.vetoed).slice(0, 5);
        }

        // ETF 分：一次批量行情查询（fields 含 f164=5日主力净额）
        const etfQuotes = new Map<string, ETFQuote>();
        try {
          const etfSecids = ETF_POOL.map(s => `${/^(60|68|5)/.test(s.code) ? "1" : "0"}.${s.code}`).join(",");
          const etfUrl = `https://push2.eastmoney.com/api/qt/ulist.np/get?ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&fields=f12,f14,f62,f164&secids=${etfSecids}`;
          const etfJson = await (await import("./lib/jsonpQueue")).queuedJsonp<any>(etfUrl, 8000, "cb", 1);
          const etfDiffRaw = etfJson?.data?.diff;
          const etfDiff: any[] = Array.isArray(etfDiffRaw) ? etfDiffRaw : (etfDiffRaw && typeof etfDiffRaw === "object" ? Object.values(etfDiffRaw) : []);
          for (const d of etfDiff) {
            const code = String(d.f12 ?? "");
            if (code) {
              etfQuotes.set(code, { code, mainNet5d: Number(d.f164) || 0, valid: true });
            }
          }
        } catch {
          console.warn("[ETF批量行情] 请求失败，资金趋势维记50");
        }

        const themeScoreMap = new Map<string, number>();
        for (const t of themeResults) themeScoreMap.set(t.board, t.total);

        // 商品涨跌幅映射
        // 商品涨跌幅映射（复用 refreshAll 内已拉取的 commodities 局部变量）
        const commodityPcts: Record<string, number> = {};
        try {
          for (const c of commodities) {
            if (c.name.includes("黄金")) commodityPcts.gold = c.pct;
            if (c.name.includes("原油")) commodityPcts.oil = c.pct;
            if (c.name.includes("铜")) commodityPcts.copper = c.pct;
          }
        } catch { /* commodities 可能未定义 */ }

        const etfResults = computeETFScores(etfQuotes, themeScoreMap, commodityPcts);
        const topETFs = etfResults.slice(0, 2); // 排名制 Top2

        const ruleThemes = topThemes.slice(0, 3);
        const ruleStocks = gate.factor <= 0.3 ? [] : topStocks;
        // 候选观察池（板块4-8名、个股6-10名）
        const candidateThemes = themeResults.slice(3, 8);
        const candidateStocks = gate.factor <= 0.3 ? [] : (computeStockScores(allStockInputs).filter(s => !s.vetoed).slice(5, 10));

        // 先用规则分渲染作战卡（渐进式：先规则后LLM）
        setBattlePlan({ gate, themes: ruleThemes, stocks: ruleStocks, etfs: topETFs, candidateThemes, candidateStocks });

        // ?debug=1 诊断模式（Fix4：可观测性）
        if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("debug") === "1") {
          console.log("=== 闸门输入 ===", { 情绪: sentiment, 炸板率: limitPool?.blastedRate, 溢价: premiumAvg, 晋级率: promotionRate, 系数: gate.factor, 标签: gate.label, 熔断: gate.reason });
          console.table(themeResults.slice(0, 10).map(t => ({ 板块: t.board, 总分: t.total, 置信: t.tier, 资金: t.factors.fund, 梯队: t.factors.ladder, 阶段: t.factors.stage, 消息: t.factors.news, 来源: t.newsSource, 角色: t.role })));
          const allScored = topStocks;
          console.table(allScored.slice(0, 15).map(s => ({ 代码: s.code, 名称: s.name, 总分: s.total, 置信: s.tier, 否决: s.vetoed ? s.vetoReasons.join("/") : "否", 资金: s.factors.fund, 流动: s.factors.liquidity, 梯队: s.factors.ladder, 消息: s.factors.news, 席位: s.factors.seat })));
          console.table(etfResults.map(e => ({ 代码: e.code, 名称: e.name, 总分: e.total, 置信: e.tier, 资金趋势: e.factors.fundTrend, 板块联动: e.factors.boardLink, 宏观: e.factors.macro })));
        }

        // 推荐落盘（每日首次，同日同code不重复）
        const recDate = localDateStr();
        for (const t of ruleThemes) {
          recordRecommendation({ date: recDate, type: "theme", code: t.board, board: t.board, priceAtRec: 0, totalScore: t.total, gateFactor: gate.factor });
        }
        for (const s of ruleStocks) {
          recordRecommendation({ date: recDate, type: "stock", code: s.code, board: "", priceAtRec: s.price, totalScore: s.total, gateFactor: gate.factor });
        }
        for (const e of topETFs) {
          recordRecommendation({ date: recDate, type: "etf", code: e.code, board: "", priceAtRec: 0, totalScore: e.total, gateFactor: gate.factor });
        }

        // LLM 消息维度异步补位（不阻塞首次渲染）
        // 盘前1轮 + 盘中每30分钟(payload哈希变化) + 盘后1轮
        (async () => {
          try {
            // 题材消息 LLM
            const themeLLMInput = ruleThemes.map(t => ({
              board: t.board, stage: t.role,
              news: newsItems.map(n => n.title).slice(0, 6),
            }));
            const themeLLMResults = await scoreThemeNews(themeLLMInput);
            const llmOverrides: LLMCatalystOverride[] = themeLLMResults.map(r => ({
              board: r.board, catalyst: r.catalyst, fromLLM: r.fromLLM,
            }));

            // 用 LLM 结果重新计算板块分
            if (llmOverrides.some(o => o.fromLLM)) {
              const updatedThemes = computeThemeScores(
                allScoringBoards,
                rawPool, newsItems, hlPulseNew, llmOverrides,
              ).slice(0, topThemeCount).slice(0, 3);

              // 个股消息 LLM
              const stockLLMInput = ruleStocks.slice(0, 10).map(s => ({
                code: s.code, name: s.name, news: [] as string[],
              }));
              const stockLLMResults = await scoreStockNews(stockLLMInput);
              const stockLLMMap = new Map<string, StockNewsLLMResult>();
              for (const r of stockLLMResults) stockLLMMap.set(r.code, r);

              // 覆盖个股 newsSource 和 invalidation
              const updatedStocks = ruleStocks.map(s => {
                const llm = stockLLMMap.get(s.code);
                if (llm && llm.fromLLM) {
                  return { ...s, newsSource: "LLM" as const, invalidation: llm.invalidation };
                }
                return s;
              });

              setBattlePlan({ gate, themes: updatedThemes, stocks: gate.factor <= 0.3 ? [] : updatedStocks, etfs: topETFs });
            }
          } catch { /* LLM 补位失败 → 保持规则版 */ }
        })();

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
  // 交易时段状态机驱动刷新：盘中60s、集合竞价30s、盘后300s、休市不刷
  // 修复：把 refreshAll() 从 setState updater 内移到 setInterval 回调（updater 应该是纯函数，
  // 副作用在 StrictMode 下双调会绕过 inFlight 护栏）
  useEffect(() => {
    if (!autoRefresh) return;
    let cancelled = false;
    const computeIntervalSec = (): number => {
      const s = getCurrentSession();
      return Math.ceil((s.refreshIntervalMs || 60000) / 1000);
    };
    setCountdown(computeIntervalSec());
    const timer = setInterval(() => {
      if (cancelled) return;
      setCountdown(prev => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    // 单独的刷新 watchdog：等 countdown 归零后触发，再重置
    const refreshTimer = setInterval(() => {
      if (cancelled) return;
      if (countdown === 0) {
        refreshAll();
        setCountdown(computeIntervalSec());
      }
    }, 1000);
    return () => { cancelled = true; clearInterval(timer); clearInterval(refreshTimer); };
  }, [autoRefresh, refreshAll, countdown]);

  // 每分钟更新时段
  useEffect(() => {
    const t = setInterval(() => setCurrentPhase(getCurrentSession().phase), 60000);
    return () => clearInterval(t);
  }, []);

  // 自选股异动带：每次刷新后用 fetchStockBriefBatch 批量拉取
  useEffect(() => {
    if (!overview) return;
    (async () => {
      try {
        const raw = localStorage.getItem("stock_watchlist");
        const codes: string[] = raw ? JSON.parse(raw) : [];
        if (codes.length === 0) { setWatchStocks([]); return; }
        const map = await fetchStockBriefBatch(codes.slice(0, 30));
        const items: WatchStockBrief[] = [];
        for (const [code, b] of map) {
          const alert = Math.abs(b.pct) >= 5 || b.turnoverRate > 10;
          const alertTag = Math.abs(b.pct) >= 5 ? `${b.pct > 0 ? "↑" : "↓"}${Math.abs(b.pct).toFixed(1)}%` : b.turnoverRate > 10 ? `换手${b.turnoverRate.toFixed(0)}%` : "";
          items.push({ code, name: b.name, price: b.price, pct: b.pct, turnoverRate: b.turnoverRate, alert, alertTag });
        }
        items.sort((a, b) => Number(b.alert) - Number(a.alert) || Math.abs(b.pct) - Math.abs(a.pct));
        setWatchStocks(items);
      } catch { setWatchStocks([]); }
    })();
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
      if (!lastSignalActive["overbought"]) { lastSignalActive["overbought"] = true; emitAlert({ severity: "warning", id: "sentiment_high", message: `情绪${sent}分（极度贪婪），追高风险` }); }
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
    const tryBackfill = () => {
      // 信号账本回填（T+1/T+5）
      if (!isBackfilledToday()) {
        runSignalBackfill().catch(() => {});
        markBackfilledToday();
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
  if (vetoActive) {
    alerts.push({ id: "veto_main", level: "critical", message: "重度背离：主力持续流出+散户接盘，不建议加仓" });
  }
  if (overview && overview.sentiment != null && overview.sentiment >= 80) {
    alerts.push({ id: "sentiment_high", level: "warning", message: `情绪温度计${overview.sentiment}分（极度贪婪），注意追高风险` });
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
        countdown={countdown}
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
            onSwitchTab={(tab) => setActive(tab as TabKey)} />
        )}

        {/* ====== 资金主线（深潜：完整资金结构+明暗盘+全球信号+产业链） ====== */}
        {active === "fundline" && (
          <>
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
            <StockWatchlist />
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
                marketSnapshot={overview ? {
                  sentiment: overview.sentiment,
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
        <div className="text-slate-700">v9.11 · build 08-01 19:25 · 数据源：东方财富</div>
      </footer>
    </div>
  );
}
