import { Suspense, lazy } from "react";
import { APP_VERSION, BUILD_DATE } from "./lib/version";
import TopNav, { type TabKey } from "./components/TopNav";
import ErrorBoundary from "./components/ErrorBoundary";
import MainlineRanking from "./components/MainlineRanking";
import FundStructure from "./components/FundStructure";
import DarkPool from "./components/DarkPool";
import GlobalSignals from "./components/GlobalSignals";
const StockWatchlist = lazy(() => import("./components/StockWatchlist"));
const PriceWatchPanel = lazy(() => import("./components/PriceWatchPanel"));
const NewsPanel = lazy(() => import("./components/NewsPanel"));
const DragonTiger = lazy(() => import("./components/DragonTiger"));
const LimitBoard = lazy(() => import("./components/LimitBoard"));
import Dashboard from "./components/Dashboard";
import ThemeLadder from "./components/ThemeLadder";
import CommodityChain from "./components/CommodityChain";
import MarginPanel from "./components/MarginPanel";
import IndustryFundFlowChart from "./components/IndustryFundFlowChart";
import AlertBanner from "./components/AlertBanner";
import SpriteOverlay from "./components/SpriteOverlay";
import AIConsole from "./components/AIConsole";
import CognitionBanner from "./components/CognitionBanner";
import ReasoningPanel from "./components/ReasoningPanel";
import ScenarioPanel from "./components/ScenarioPanel";
import SwingWarRoomV2 from "./components/SwingWarRoomV2";
import DecisionCard from "./components/DecisionCard";
import ChainBriefingPanel from "./components/ChainBriefingPanel"; // v9.148.0（任务09）：产业链简报第一眼入口
import IntradaySkinStrip from "./components/IntradaySkinStrip"; // v9.149.0（B2）：盘中皮肤水平条
import BackToTop from "./components/BackToTop"; // v9.149.1：一键回到顶部
import { useMarketData } from "./hooks/useMarketData";
import { getBJDate } from "./lib/format";
export type { SentimentFactors, OverviewData, FundStructureData, DarkPoolData, GlobalData, MainlineData } from "./lib/marketTypes";

export default function App() {
  const {
    active, setActive, loading, lastUpdated, autoRefresh, setAutoRefresh, countdown, nextRefreshAt,
    overview, fundStructure, globalData, darkPool, mainline, battlePlan, cognMainline,
    currentPhase, watchStocks, nextScenarios, riskRadarText, nextGatePredict,
    llmBriefDegraded, sealAlerts, topIndustryFund, alerts, yesterdayZtBrief, refreshAll,
  } = useMarketData();

  const switchTab = (t: TabKey | string) => {
    setActive(t as TabKey);
    import("./lib/uiContext").then((m) => m.setActiveTab(t)).catch(() => {});
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#0d1424,_#05070d_60%)] pb-16">
      <TopNav
        active={active}
        onChange={switchTab}
        lastUpdated={lastUpdated}
        loading={loading}
        autoRefresh={autoRefresh}
        onToggleAutoRefresh={() => setAutoRefresh((v) => !v)}
        onRefreshNow={refreshAll}
        countdown={countdown}
        nextRefreshAt={nextRefreshAt || undefined}
        overview={overview}
        fund={fundStructure}
      />

      <AlertBanner alerts={alerts} />

      {/* v9.147.0（阶段二C）：盘中精灵浮层（通达信"盘中精灵"效果，右下角常驻；改接活跃源 anomaly:今日） */}
      <SpriteOverlay />

      {/* v9.149.1：一键回到顶部（滚动超 400px 出现，所有 Tab 生效） */}
      <BackToTop />

      <ErrorBoundary>
        <main className="mx-auto max-w-[1500px] space-y-6 px-4 py-4">
          {active === "dashboard" && (
            <>
              {/* v9.148.0（任务09）：产业链简报置顶 —— 每天第一眼：6 链走到哪个阶段/谁受益/逻辑变没变 */}
              <ChainBriefingPanel compact />
              <SwingWarRoomV2 />
              <CognitionBanner />
              {/* v9.149.0（B2）：盘中皮肤一条水平条（原埋在完整驾驶舱折叠里） */}
              <IntradaySkinStrip overview={overview} watchStocks={watchStocks} mainlines={battlePlan?.candidates.map((c: any) => c.mainline ?? "") ?? []} />
              {/* v9.149.0（B2）：DecisionCard 上提 —— 决策是核心动作，从两层折叠的"坟墓"里提到第一层 */}
              <DecisionCard
                mainlines={(battlePlan?.candidates ?? []).slice(0, 2).map((c: any) => ({
                  mainline: c.mainline ?? "",
                  leaders: (c.leaders ?? []).map((l: any) => ({ code: l.code ?? "", name: l.name ?? "" })),
                }))}
              />
              <details className="rounded-xl border border-white/10 bg-white/5">
                <summary className="cursor-pointer select-none px-4 py-1.5 text-xs font-bold text-slate-300 hover:text-slate-100">
                  认知推理 / 场景融合 / 深度研究台（默认收起）
                </summary>
                <div className="space-y-3 px-3 py-3">
                  <ReasoningPanel />
                  <ScenarioPanel />
                  <details className="rounded-xl border border-white/10 bg-white/5" open={currentPhase === "post"}>
                    <summary className="cursor-pointer select-none px-3 py-2 text-xs font-bold text-slate-300">完整驾驶舱与研究工具</summary>
                    <div className="px-3 pb-3 pt-1">
                      <Dashboard
                        overview={overview}
                        fund={fundStructure}
                        globalData={globalData}
                        mainline={mainline}
                        cognMainline={cognMainline}
                        battlePlan={battlePlan}
                        loading={loading}
                        phase={currentPhase}
                        watchStocks={watchStocks}
                        mainlines={battlePlan?.candidates.map((c) => c.mainline) ?? []}
                        onSwitchTab={switchTab}
                        yesterdayZt={yesterdayZtBrief}
                        nextScenarios={nextScenarios}
                        riskRadarText={riskRadarText}
                        nextGatePredict={nextGatePredict}
                        llmBriefDegraded={llmBriefDegraded}
                        sealAlerts={sealAlerts}
                      />
                    </div>
                  </details>
                </div>
              </details>
            </>
          )}

          {active === "briefing" && (
            // v9.148.0（任务09）：简报独立视图（手机扫码 #briefing 直达，纯简报轻量页）
            <ChainBriefingPanel />
          )}

          {active === "fundline" && (
            <>
              <MainlineRanking battlePlan={battlePlan} loading={loading} />
              <ThemeLadder rawZTPool={overview?.limitPool?.rawZTPool ?? null} />
              <details className="rounded-xl border border-white/10 bg-white/5" open>
                <summary className="cursor-pointer select-none px-4 py-2 text-sm font-bold text-slate-200 hover:text-slate-100">资金面（资金结构 · 明暗盘 · 涨停盘）</summary>
                <div className="space-y-3 px-4 pb-4">
                  {topIndustryFund.length > 0 && (
                    <IndustryFundFlowChart
                      boards={topIndustryFund}
                      refreshSec={60}
                      asOfMinutes={(() => {
                        const bj = getBJDate();
                        const mins = (bj.getHours() * 60 + bj.getMinutes()) - (9 * 60 + 30);
                        if (mins >= 330) return 330;
                        return Math.max(0, Math.min(330, mins));
                      })()}
                    />
                  )}
                  <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <h3 className="mb-3 text-sm font-bold text-slate-200">资金结构详情</h3>
                    <FundStructure data={fundStructure} loading={loading} />
                  </div>
                  <DarkPool data={darkPool} loading={loading} />
                  <Suspense fallback={<div className="text-slate-400 p-4">加载涨停盘...</div>}>
                    <LimitBoard />
                  </Suspense>
                </div>
              </details>
              <details className="rounded-xl border border-white/10 bg-white/5">
                <summary className="cursor-pointer select-none px-4 py-2 text-sm font-bold text-slate-200 hover:text-slate-100">盘前准备（全球 · 两融 · 产业链）</summary>
                <div className="space-y-3 px-4 pb-4">
                  <GlobalSignals data={globalData} loading={loading} />
                  <MarginPanel />
                  <CommodityChain
                    boardPcts={(() => {
                      const map: Record<string, number> = {};
                      if (mainline?.boards) for (const b of mainline.boards) map[b.name] = b.pct;
                      if (darkPool?.topBoards) for (const b of darkPool.topBoards) if (!(b.name in map)) map[b.name] = b.pct;
                      return map;
                    })()}
                  />
                </div>
              </details>
            </>
          )}

          {active === "dragon" && (
            <Suspense fallback={<div className="text-slate-400 p-6">加载龙虎榜...</div>}>
              <DragonTiger />
            </Suspense>
          )}

          {active === "radar" && (
            <Suspense fallback={<div className="text-slate-400 p-6">加载个股雷达...</div>}>
              <StockWatchlist mainlines={battlePlan?.candidates.map((c) => c.mainline) ?? []} />
              <PriceWatchPanel />
            </Suspense>
          )}

          {active === "news" && (
            <Suspense fallback={<div className="text-slate-400 p-6">加载消息面...</div>}>
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <h3 className="mb-3 text-sm font-bold text-slate-200">实时快讯（政策与市场动态）</h3>
                <NewsPanel
                  autoRefresh={autoRefresh}
                  strongBoards={
                    mainline?.boards.filter((b) => b.mainNet > 0).slice(0, 5).map((b) => b.name)
                    ?? fundStructure?.boardRank?.inflow.slice(0, 5).map((b) => b.name)
                    ?? []
                  }
                  mainlines={battlePlan?.candidates.map((c) => ({ name: c.mainline, ztCount: c.ztCount })) ?? []}
                  marketSnapshot={overview ? {
                    sentiment: overview.sentiment ?? 0,
                    indices: overview.indices.map((i) => ({ name: i.name, pct: i.pct })),
                    mainNet: fundStructure?.structure?.today.mainNet ?? 0,
                    mainNet5d: fundStructure?.structure?.mainNet5d ?? 0,
                    mainNet10d: fundStructure?.structure?.mainNet10d ?? 0,
                  } : null}
                />
              </div>
            </Suspense>
          )}
        </main>
      </ErrorBoundary>

      <AIConsole
        siteContext={{
          topMainline: battlePlan?.candidates?.[0]?.mainline ?? undefined,
          topMainlineScore: battlePlan?.candidates?.[0]?.strengthScore ?? null,
          topMainlineZtCount: battlePlan?.candidates?.[0]?.ztCount ?? 0,
          topMainlineHeight: battlePlan?.candidates?.[0]?.height ?? 0,
          sentiment: overview?.sentiment ?? null,
          sentimentLabel: overview?.sentimentLabel ?? undefined,
          marketNet: fundStructure?.structure?.today?.mainNet ?? 0,
          watchStocks: watchStocks.map((s) => s.name).slice(0, 20).join("、") || undefined,
        }}
      />

      <footer className="mx-auto max-w-[1500px] px-4 py-4 text-center text-[11px] text-slate-600 space-y-1">
        <div>本终端仅用于实盘交易辅助监控，所有数据来自公开接口实时抓取，不构成投资建议</div>
        <div>资金结构 &gt; 涨跌幅 · 风险信号 &gt; 机会信号 · 阶段判断 &gt; 单一指标</div>
        <div className="text-slate-700">{APP_VERSION} · build {BUILD_DATE} · 数据源：东方财富</div>
      </footer>
    </div>
  );
}
