import { useCallback, useEffect, useRef, useState } from "react";
import TopNav, { type TabKey } from "./components/TopNav";
import MarketOverview from "./components/MarketOverview";
import FundStructure from "./components/FundStructure";
import DarkPool from "./components/DarkPool";
import GlobalSignals from "./components/GlobalSignals";
import KeyIndicators from "./components/KeyIndicators";
import NewsPanel from "./components/NewsPanel";
import Mainline from "./components/Mainline";
import StockMonitor from "./components/StockMonitor";
import Pitfalls from "./components/Pitfalls";
import {
  fetchIndexOverview,
  fetchMarketBreadth,
  fetchMarketMainFund,
  fetchGlobalIndices,
  fetchMarketTurnover,
  fetchBoardFundFlow,
  fetchBoardConstituents,
  fetchMarketFundHistory,
  stockLimitPct,
  type IndexQuote,
  type MarketBreadth,
  type GlobalIndex,
  type BoardFlowItem,
  type BoardStock,
  type FundSnapshot,
} from "./lib/api";

export interface OverviewData {
  indices: IndexQuote[];
  breadth: MarketBreadth | null;
  sentiment: number;
  sentimentLabel: string;
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
}

export interface DarkPoolData {
  darkPoolToday: number;
  openPoolToday: number;
  darkPool5d: number;
  darkPool10d: number;
  marketFlowType: string;
  topBoards: Array<{
    code: string;
    name: string;
    pct: number;
    darkNet: number;
    openNet: number;
    flowType: string;
    boardType: string;
  }>;
  boardStocks: Record<string, BoardStock[]>;
}

export interface GlobalData {
  globalSignals: GlobalIndex[];
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
  const [active, setActive] = useState<TabKey>("market");
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [fundStructure, setFundStructure] = useState<FundStructureData | null>(null);
  const [darkPool, setDarkPool] = useState<DarkPoolData | null>(null);
  const [globalData, setGlobalData] = useState<GlobalData | null>(null);
  const [mainline, setMainline] = useState<MainlineData | null>(null);
  const inFlight = useRef(false);

  const refreshAll = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      // Parallel fetches
      const [indices, breadth, fundMain, globals, turnover, fundHistory] = await Promise.allSettled([
        fetchIndexOverview(),
        fetchMarketBreadth(),
        fetchMarketMainFund(),
        fetchGlobalIndices(),
        fetchMarketTurnover(),
        fetchMarketFundHistory(30),
      ]);

      // === Overview ===
      const idxData = indices.status === "fulfilled" ? indices.value : [];
      const brData = breadth.status === "fulfilled" ? breadth.value : null;
      
      let sentiment = 50;
      let sentimentLabel = "数据不足";
      if (brData && brData.total > 0) {
        const upRatio = brData.up / brData.total;
        const upDownScore = upRatio * 40;
        const limitDiff = brData.limitUp - brData.limitDown;
        const limitScore = Math.max(-15, Math.min(15, limitDiff * 0.3));
        const avgPctScore = Math.max(-15, Math.min(15, brData.avgPct * 3));
        let indexScore = 0;
        if (idxData.length > 0) {
          const avgIdxPct = idxData.reduce((s, idx) => s + (idx.pct ?? 0), 0) / idxData.length;
          indexScore = Math.max(-15, Math.min(15, avgIdxPct * 5));
        }
        sentiment = Math.round(upDownScore + limitScore + avgPctScore + indexScore + 15);
        sentiment = Math.max(0, Math.min(100, sentiment));
        if (sentiment >= 75) sentimentLabel = "极度亢奋（注意追高风险）";
        else if (sentiment >= 60) sentimentLabel = "偏热（注意控制仓位）";
        else if (sentiment >= 50) sentimentLabel = "偏暖";
        else if (sentiment >= 40) sentimentLabel = "中性";
        else if (sentiment >= 30) sentimentLabel = "偏冷";
        else if (sentiment >= 20) sentimentLabel = "恐慌（关注超跌机会）";
        else sentimentLabel = "极度悲观（警惕恐慌踩踏）";
      }
      setOverview({ indices: idxData, breadth: brData, sentiment, sentimentLabel });

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
        setFundStructure({
          structure: {
            today: { mainNet: fm.mainNet, extraLargeNet: fm.extraLargeNet, largeNet: fm.largeNet, mediumNet: fm.mediumNet, smallNet: fm.smallNet },
            mainNet5d: fm.mainNet5d, mainNet10d: fm.mainNet10d,
            north: { available: false, net: 0, note: "东方财富北向资金接口自2024年8月起间歇性断供" },
            verdict, vetoTriggered, reasons, actionHint,
          },
          history,
        });
      }

      // === Global ===
      setGlobalData({
        globalSignals: globals.status === "fulfilled" ? globals.value : [],
        turnover: turnover.status === "fulfilled" ? turnover.value : { amount: 0, available: false },
      });

      // === Dark Pool (concept boards) ===
      // 注意：顶部4张汇总卡片（今日暗盘/明盘净流入、近5日/近10日主力净流入）改用全市场真实资金数据
      // 而非对30个概念板块做加总——因为A股个股通常同时归属多个概念板块，直接加总会造成
      // 同一笔资金被重复计算数倍，产生远超真实市场规模的失真数字（曾出现"近10日-1.7万亿"这类
      // 明显脱离实际的错误结果），且会与"资金结构速览"模块展示的同名指标数字自相矛盾。
      // 板块级别的darkNet/openNet仅用于TOP10板块之间的横向排序对比，这个用途是合理的，予以保留。
      try {
        const conceptBoards = await fetchBoardFundFlow("concept", 30);
        const topBoards: DarkPoolData["topBoards"] = [];
        for (const d of conceptBoards) {
          const darkNet = d.extraLargeNet + d.largeNet;
          const openNet = d.mediumNet + d.smallNet;
          let flowType: string;
          if (darkNet > 0 && openNet < 0 && Math.abs(darkNet) > Math.abs(openNet) * 0.5) {
            flowType = "洗盘（暗盘流入+明盘流出）";
          } else if (darkNet < 0 && openNet > 0 && Math.abs(darkNet) > Math.abs(openNet) * 0.5) {
            flowType = "出货（暗盘流出+明盘流入）";
          } else if (darkNet > 0 && openNet > 0) {
            flowType = "共振做多";
          } else if (darkNet < 0 && openNet < 0) {
            flowType = "共振做空";
          } else {
            flowType = "方向分歧";
          }
          topBoards.push({ code: d.code, name: d.name, pct: d.pct, darkNet, openNet, flowType, boardType: "concept" });
        }
        topBoards.sort((a, b) => b.darkNet - a.darkNet);
        const top10 = topBoards.slice(0, 10);

        // 全市场级别的暗盘/明盘净流入与近5/10日主力净流入，直接复用全市场资金结构数据（与资金结构速览同源，避免重复计算与数字矛盾）
        const fm = fundMain.status === "fulfilled" ? fundMain.value : null;
        const marketDarkNet = fm ? fm.extraLargeNet + fm.largeNet : 0;
        const marketOpenNet = fm ? fm.mediumNet + fm.smallNet : 0;
        const marketMainNet5d = fm ? fm.mainNet5d : 0;
        const marketMainNet10d = fm ? fm.mainNet10d : 0;

        let marketFlowType = "数据不足";
        if (fm) {
          if (marketDarkNet > 0 && marketOpenNet < 0) marketFlowType = "全市场暗盘流入、明盘流出 — 可能为洗盘阶段（主力悄悄吸筹）";
          else if (marketDarkNet < 0 && marketOpenNet > 0) marketFlowType = "全市场暗盘流出、明盘流入 — 可能为出货阶段（主力撤退）";
          else if (marketDarkNet > 0 && marketOpenNet > 0) marketFlowType = "全市场明暗盘共振做多 — 多方合力";
          else if (marketDarkNet < 0 && marketOpenNet < 0) marketFlowType = "全市场明暗盘共振做空 — 空方主导";
          else marketFlowType = "全市场明暗盘方向分歧 — 多空胶着";
        }

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
          darkPoolToday: marketDarkNet, openPoolToday: marketOpenNet,
          darkPool5d: marketMainNet5d, darkPool10d: marketMainNet10d,
          marketFlowType, topBoards: top10, boardStocks,
        });
      } catch {
        setDarkPool(null);
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

  useEffect(() => { refreshAll(); }, [refreshAll]);
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(refreshAll, 60000);
    return () => clearInterval(timer);
  }, [autoRefresh, refreshAll]);

  const vetoActive = fundStructure?.structure?.vetoTriggered;

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#0d1424,_#05070d_60%)] pb-16">
      <TopNav
        active={active} onChange={setActive} lastUpdated={lastUpdated} loading={loading}
        autoRefresh={autoRefresh} onToggleAutoRefresh={() => setAutoRefresh(v => !v)} onRefreshNow={refreshAll}
      />

      {vetoActive && (
        <div className="border-b border-rose-500/40 bg-rose-600/20 px-4 py-2 text-center text-sm font-bold text-rose-200">
          🚨 一票否决警报：当前市场资金结构呈现「主力持续流出 + 散户接盘」，不建议加仓
        </div>
      )}

      <main className="mx-auto max-w-[1500px] space-y-6 px-4 py-6">
        {active === "market" && (
          <>
            <MarketOverview data={overview} loading={loading} />
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <h3 className="mb-3 text-sm font-bold text-slate-200">资金结构速览</h3>
              <FundStructure data={fundStructure} loading={loading} />
            </div>
            <DarkPool data={darkPool} loading={loading} />
            <GlobalSignals data={globalData} loading={loading} />
            <KeyIndicators data={{ breadth: overview?.breadth, fundStructure }} loading={loading} />
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <h3 className="mb-3 text-sm font-bold text-slate-200">📰 实时快讯（政策与市场动态）</h3>
              <NewsPanel autoRefresh={autoRefresh} />
            </div>
          </>
        )}
        {active === "fund" && <FundStructure data={fundStructure} loading={loading} />}
        {active === "mainline" && <Mainline data={mainline} loading={loading} />}
        {active === "stock" && <StockMonitor />}
        {active === "pitfalls" && <Pitfalls />}
      </main>

      <footer className="mx-auto max-w-[1500px] px-4 text-center text-[11px] text-slate-600">
        本终端仅用于实盘交易辅助监控，所有数据来自公开接口实时抓取，不构成投资建议 · 资金结构 &gt; 涨跌幅 · 风险信号 &gt; 机会信号 · 阶段判断 &gt; 单一指标
      </footer>
    </div>
  );
}
