import { useCallback, useEffect, useRef, useState, lazy, Suspense } from "react";
import TopNav, { type TabKey } from "./components/TopNav";
import MarketOverview from "./components/MarketOverview";
import FundStructure from "./components/FundStructure";
import DarkPool from "./components/DarkPool";
import GlobalSignals from "./components/GlobalSignals";
// 深潜组件 lazy 分包：龙虎榜/个股雷达/消息面不在首屏，按需加载
const StockWatchlist = lazy(() => import("./components/StockWatchlist"));
const NewsPanel = lazy(() => import("./components/NewsPanel"));
const DragonTiger = lazy(() => import("./components/DragonTiger"));
const LimitBoard = lazy(() => import("./components/LimitBoard"));
import Dashboard from "./components/Dashboard";

import StatusBar from "./components/StatusBar";
import AlertBanner, { type AlertItem } from "./components/AlertBanner";
import { appendSignal } from "./lib/signalLedger";
import { getCurrentSession } from "./lib/tradingSession";
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
  isRealConceptBoard,
  stockLimitPct,
  type IndexQuote,
  type MarketBreadth,
  type GlobalIndex,
  type BoardFlowItem,
  type BoardStock,
  type BoardRankItem,
  type FundSnapshot,
  type LimitPoolSummary,
} from "./lib/api";

export interface SentimentFactors {
  upDownScore: number;
  limitScore: number;
  avgPctScore: number;
  indexScore: number;
  limitUpBonus: number;
  blastedPenalty: number;
  fundFlowScore: number;
}

export interface OverviewData {
  indices: IndexQuote[];
  breadth: MarketBreadth | null;
  sentiment: number;
  sentimentLabel: string;
  sentimentFactors: SentimentFactors | null;
  sentimentYesterday: number | null;
  limitPool: LimitPoolSummary | null;
  turnoverAmount: number;
  turnoverYesterday: number | null;
  turnoverAvg5d: number | null;
}

export interface FundStructureData {
  structure: {
    today: { mainNet: number; extraLargeNet: number; largeNet: number; mediumNet: number; smallNet: number };
    mainNet5d: number;
    mainNet10d: number;
    north: { available: boolean; net: number; note: string };
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
  const [active, setActive] = useState<TabKey>("dashboard");
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [countdown, setCountdown] = useState(60);
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [fundStructure, setFundStructure] = useState<FundStructureData | null>(null);
  const [darkPool, setDarkPool] = useState<DarkPoolData | null>(null);
  const [globalData, setGlobalData] = useState<GlobalData | null>(null);
  const [mainline, setMainline] = useState<MainlineData | null>(null);
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
      
      let sentiment = 50;
      let sentimentLabel = "数据不足";
      let sentimentFactors: SentimentFactors | null = null;
      if (brData && brData.total > 0) {
        const upRatio = brData.up / brData.total;
        const upDownScore = Math.round(upRatio * 40 * 10) / 10;
        const limitDiff = brData.limitUp - brData.limitDown;
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

        sentimentFactors = { upDownScore, limitScore, avgPctScore, indexScore, limitUpBonus, blastedPenalty, fundFlowScore };
        sentiment = Math.round(upDownScore + limitScore + avgPctScore + indexScore + limitUpBonus - blastedPenalty + fundFlowScore + 15);
        sentiment = Math.max(0, Math.min(100, sentiment));

        if (sentiment >= 80) sentimentLabel = "极度贪婪";
        else if (sentiment >= 65) sentimentLabel = "贪婪";
        else if (sentiment >= 45) sentimentLabel = "中性";
        else if (sentiment >= 25) sentimentLabel = "恐慌";
        else sentimentLabel = "极度恐慌";
        // 信号账本：情绪分穿越关键阈值时记录
        if (sentiment >= 80 || sentiment <= 25) {
          const today = new Date().toISOString().slice(0, 10);
          appendSignal({
            date: today, type: "sentiment_cross", typeLabel: sentiment >= 80 ? "极度贪婪" : "极度恐慌",
            code: "MARKET", name: "全市场", priceAtSignal: idxData[0]?.price ?? 0,
            description: `情绪温度计${sentiment}分(${sentimentLabel})`,
          });
        }
      }
      // 昨日情绪分（从localStorage简单缓存）
      const prevSentiment = Number(localStorage.getItem("prev_sentiment")) || null;
      if (sentiment !== 50) localStorage.setItem("prev_sentiment", String(sentiment));

      // 计算昨日成交额和近5日均值
      const turnoverHist = turnoverHistRes.status === "fulfilled" ? turnoverHistRes.value : [];
      // turnoverHist[0] 是最新日（可能是今天），[1] 是昨天
      const yesterdayAmount = turnoverHist.length >= 2 ? turnoverHist[1].amount : null;
      const avg5dArr = turnoverHist.slice(1, 6); // 排除今天，取前5天
      const turnoverAvg5d = avg5dArr.length > 0 ? avg5dArr.reduce((s, t) => s + t.amount, 0) / avg5dArr.length : null;

      setOverview({
        indices: idxData, breadth: brData, sentiment, sentimentLabel,
        sentimentFactors, sentimentYesterday: prevSentiment,
        limitPool,
        turnoverAmount: turnoverData.amount,
        turnoverYesterday: yesterdayAmount,
        turnoverAvg5d,
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
            north: { available: false, net: 0, note: "东方财富北向资金接口自2024年8月起间歇性断供" },
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
      // 资金总体 = 主力净流入（f62 = 超大单+大单净额）
      //
      // 同花顺6种组合判断：
      // 1. 总体流入 + 明盘流入 + 暗盘流入 → 主力看多
      // 2. 总体流入 + 明盘流入更多 + 暗盘流出 → 主力可能拉升做T
      // 3. 总体流入 + 明盘流出 + 暗盘流入更多 → 主力可能洗盘低吸
      // 4. 总体流出 + 明盘流出 + 暗盘流出 → 主力看空
      // 5. 总体流出 + 明盘流出更多 + 暗盘流入 → 主力可能吸筹
      // 6. 总体流出 + 明盘流入 + 暗盘流出更多 → 主力可能诱多出货
      // 明暗盘判断（同花顺6种组合，需要同时考虑totalFlow方向+明盘暗盘对比）
      // totalFlow = 主力净流入(f62)，openNet = 超大单+大单，darkNet = 中单+小单
      function judgeFlowType(totalFlow: number, openNet: number, darkNet: number): string {
        const totalIn = totalFlow >= 0;
        const openIn = openNet >= 0;
        const darkIn = darkNet >= 0;
        if (totalIn && openIn && darkIn) return "主力看多（明暗共振流入）";
        if (totalIn && openIn && !darkIn) return "拉升做T（明盘主导，暗盘分歧）";
        if (totalIn && !openIn && darkIn) return "洗盘低吸（暗盘流入，明盘承压）";
        if (!totalIn && !openIn && !darkIn) return "主力看空（明暗共振流出）";
        if (!totalIn && !openIn && darkIn) return "主力出货（大单撤退，散户接盘）";
        if (!totalIn && openIn && !darkIn) return "诱多出货（明盘托底，暗盘出逃）";
        return totalIn ? "方向分歧（偏多）" : "方向分歧（偏空）";
      }

      try {
        const conceptBoards = await fetchBoardFundFlow("concept", 60);
        const topBoards: DarkPoolData["topBoards"] = [];
        for (const d of conceptBoards) {
          // 过滤掉非真正概念板块（指数成分/风格标签等）
          if (!isRealConceptBoard(d.name)) continue;
          const openNet = d.extraLargeNet + d.largeNet;  // 明盘 = 超大单+大单
          const darkNet = d.mediumNet + d.smallNet;       // 暗盘 = 中单+小单
          const totalFlow = d.mainNet;                    // 资金总体 = 主力净流入
          const flowType = judgeFlowType(totalFlow, openNet, darkNet);
          topBoards.push({ code: d.code, name: d.name, pct: d.pct, openNet, darkNet, flowType, boardType: "concept" });
        }
        // 按主力净流入（mainNet = openNet）排序
        topBoards.sort((a, b) => b.openNet - a.openNet);
        const top10 = topBoards.slice(0, 10);

        // 全市场级别
        const fm = fundMain.status === "fulfilled" ? fundMain.value : null;
        const marketTotalFlow = fm ? fm.mainNet : 0;
        const marketOpenNet = fm ? fm.extraLargeNet + fm.largeNet : 0;  // 明盘
        const marketDarkNet = fm ? fm.mediumNet + fm.smallNet : 0;       // 暗盘
        const marketMainNet5d = fm ? fm.mainNet5d : 0;
        const marketMainNet10d = fm ? fm.mainNet10d : 0;

        const marketFlowType = fm ? judgeFlowType(marketTotalFlow, marketOpenNet, marketDarkNet) : "数据不足";

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
        setMainline({ boards: topBoards, potential: dedupedPotential.slice(0, 15) });
      } catch {
        setMainline(null);
      }

      setLastUpdated(new Date().toISOString());
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }, []);

  // 首次加载
  useEffect(() => { refreshAll(); }, [refreshAll]);
  // 交易时段状态机驱动刷新：盘中60s、集合竞价30s、盘后300s、休市不刷
  useEffect(() => {
    if (!autoRefresh) return;
    const session = getCurrentSession();
    const intervalMs = session.refreshIntervalMs || 60000; // 默认60s兜底
    const countdownSec = Math.ceil(intervalMs / 1000);
    setCountdown(countdownSec);
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          // 静默刷新：后台刷新不触发全屏 loading（setLoading 只在首次用）
          refreshAll();
          // 刷新时重新检测时段（可能跨越了时段边界）
          const newSession = getCurrentSession();
          return Math.ceil((newSession.refreshIntervalMs || 60000) / 1000);
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [autoRefresh, refreshAll]);

  const vetoActive = fundStructure?.structure?.vetoTriggered;

  // 构建三级警报列表
  const alerts: AlertItem[] = [];
  if (vetoActive) {
    alerts.push({ id: "veto_main", level: "critical", message: "重度背离：主力持续流出+散户接盘，不建议加仓" });
  }
  if (overview && overview.sentiment >= 80) {
    alerts.push({ id: "sentiment_high", level: "warning", message: `情绪温度计${overview.sentiment}分（极度贪婪），注意追高风险` });
  }
  if (overview && overview.sentiment <= 25) {
    alerts.push({ id: "sentiment_low", level: "warning", message: `情绪温度计${overview.sentiment}分（极度恐慌），关注超跌机会` });
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
          <Dashboard overview={overview} fund={fundStructure} loading={loading} />
        )}

        {/* ====== 资金主线（深潜：完整资金结构+明暗盘+全球信号） ====== */}
        {active === "fundline" && (
          <>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <h3 className="mb-3 text-sm font-bold text-slate-200">资金结构详情</h3>
              <FundStructure data={fundStructure} loading={loading} />
            </div>
            <DarkPool data={darkPool} loading={loading} />
            <GlobalSignals data={globalData} loading={loading} />
          </>
        )}

        {/* ====== 龙虎榜复盘（lazy） ====== */}
        {active === "dragon" && (
          <Suspense fallback={<div className="text-slate-400 p-6">加载龙虎榜模块…</div>}>
            <DragonTiger />
            <LimitBoard />
          </Suspense>
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
              <NewsPanel autoRefresh={autoRefresh} />
            </div>
          </Suspense>
        )}
      </main>

      <footer className="mx-auto max-w-[1500px] px-4 py-4 text-center text-[11px] text-slate-600 space-y-1">
        <div>本终端仅用于实盘交易辅助监控，所有数据来自公开接口实时抓取，不构成投资建议</div>
        <div>资金结构 &gt; 涨跌幅 · 风险信号 &gt; 机会信号 · 阶段判断 &gt; 单一指标</div>
        <div className="text-slate-700">v6.2 · 最后更新 2026-07-28 · 数据源：东方财富</div>
      </footer>
    </div>
  );
}
