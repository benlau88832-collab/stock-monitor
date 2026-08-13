import { Suspense, lazy } from "react";
// v9.47（L3）：footer 版本号从常量读（去硬编码 v9.41）
import { APP_VERSION, BUILD_DATE } from "./lib/version";
import TopNav, { type TabKey } from "./components/TopNav";
// v9.79（韧性）：ErrorBoundary 包裹主内容 —— 单数据模块崩溃不再整树白屏（原组件存在但从未使用）
import ErrorBoundary from "./components/ErrorBoundary";
import MainlineRanking from "./components/MainlineRanking";
import FundStructure from "./components/FundStructure";
import DarkPool from "./components/DarkPool";
import GlobalSignals from "./components/GlobalSignals";
// 深潜组件 lazy 分包：龙虎榜/个股雷达/消息面不在首屏，按需加载
const StockWatchlist = lazy(() => import("./components/StockWatchlist"));
// v9.66：盯价监控面板（个股雷达 Tab）
const PriceWatchPanel = lazy(() => import("./components/PriceWatchPanel"));
const NewsPanel = lazy(() => import("./components/NewsPanel"));
const DragonTiger = lazy(() => import("./components/DragonTiger"));
const LimitBoard = lazy(() => import("./components/LimitBoard"));
import Dashboard from "./components/Dashboard";
import ThemeLadder from "./components/ThemeLadder";
import CommodityChain from "./components/CommodityChain";
import MarginPanel from "./components/MarginPanel";
// v9.138.0（波段重构·阶段一，Q5 降噪）：竞价台/强度榜组件不再挂载（超短件移除，代码保留）
import IndustryFundFlowChart from "./components/IndustryFundFlowChart";
import AlertBanner from "./components/AlertBanner";
// v9.58（V8-8）：全局 AI 助手（右下角悬浮，所有 Tab 可见）
import AIConsole from "./components/AIConsole";
// v9.115.0（S1-4）：单一 AI 认知层横幅（全站唯一市场理解可视化）
import CognitionBanner from "./components/CognitionBanner";
// v9.120.0（卓越 S1-1c）：认知推理面板（共振/因果/变化率/预判，认知横幅下方）
import ReasoningPanel from "./components/ReasoningPanel";
// v9.118.0（S4-2）：操作习惯场景融合（竞价/异动/尾盘/情绪周期四场景）
import ScenarioPanel from "./components/ScenarioPanel";
// v9.138.0（波段重构·阶段一）：波段作战室（波段游资主屏：方向榜/持仓逻辑/波段决策/业绩日历）
import SwingWarRoom from "./components/SwingWarRoom";
import DecisionCard from "./components/DecisionCard"; // v9.113.0（T4-2）：决策直达卡（纯函数直调，不依赖 AI）
// v9.138.0（阶段二：#14 拆 God Component）—— 数据层 hook（原 App 237-1578 行整块搬移）
import { useMarketData } from "./hooks/useMarketData";
import { getBJDate } from "./lib/format";
// v9.138.0（阶段二：#17 API 契约单源化）：6 个市场数据契约类型迁至 lib/marketTypes.ts，
// 此处 re-export 保持既有 17 处组件导入兼容（TopNav/Dashboard/DarkPool/Playbook 等）；
// 新代码请直接从 lib/marketTypes 导入，禁止再引 "../App"。
export type { SentimentFactors, OverviewData, FundStructureData, DarkPoolData, GlobalData, MainlineData } from "./lib/marketTypes";

// ============================================================
// v9.138.0（阶段二）：页面容器 —— 仅渲染层。
// 状态/抓取/效果全部在 useMarketData（数据层 hook）；本文件只做 Tab 分派与 JSX 渲染。
// ============================================================
export default function App() {
  const {
    active, setActive, loading, lastUpdated, autoRefresh, setAutoRefresh, countdown, nextRefreshAt,
    overview, fundStructure, globalData, darkPool, mainline, battlePlan, cognMainline,
    currentPhase, watchStocks, nextScenarios, riskRadarText, nextGatePredict,
    llmBriefDegraded, sealAlerts, topIndustryFund, alerts, yesterdayZtBrief, refreshAll,
  } = useMarketData();
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#0d1424,_#05070d_60%)] pb-16">
      <TopNav
        active={active} onChange={(t) => { setActive(t); try { import('./lib/uiContext').then(m => m.setActiveTab(t)); } catch { /* 静默 */ } }} lastUpdated={lastUpdated} loading={loading}
        autoRefresh={autoRefresh} onToggleAutoRefresh={() => setAutoRefresh(v => !v)} onRefreshNow={refreshAll}
        countdown={countdown} nextRefreshAt={nextRefreshAt || undefined}
        overview={overview} fund={fundStructure}
      />

      {/* 三级警报横幅 */}
      <AlertBanner alerts={alerts} />

      {/* v9.138.0（波段重构·阶段一，Q5 降噪）：盘中精灵浮层移除（超短件；服务端精灵 cron 已停用） */}

      {/* v9.79（韧性）：ErrorBoundary 包裹主内容 —— 单个数据模块抛错时显示兜底而非整树白屏，
          TopNav/AIConsole/footer 保持存活，用户仍可切换 Tab/刷新 */}
      <ErrorBoundary>
        <main className="mx-auto max-w-[1500px] space-y-6 px-4 py-4">
        {/* ====== 驾驶舱（v9.138.0 波段重构：波段作战室置顶，替代竞价作战区） ====== */}
        {active === "dashboard" && (
          <>
          {/* v9.138.0（波段重构·阶段一，Q5 降噪）：竞价作战区移除 —— 波段游资主屏换为波段作战室
             （方向榜/持仓逻辑台账/波段决策卡/业绩日历）；竞价台/强度榜/AI预判龙一 不再渲染（保留代码不挂载） */}
          <SwingWarRoom />
          {/* v9.115.0（S1-4）：单一 AI 认知层横幅（全站唯一市场理解，5 维 + version/hash/asOf 溯源）——
              不增面板：横幅形态置于驾驶舱顶部，作战卡/决策卡/精灵/问答均消费同一认知 */}
          <CognitionBanner />
          {/* v9.120.0（卓越 S1-1c）：认知推理面板 —— v9.133.0（游资改造）盘中折叠（盘后研究工具） */}
          <details className="rounded-xl border border-white/10 bg-white/5">
            <summary className="cursor-pointer select-none px-4 py-1.5 text-xs font-bold text-slate-300 hover:text-slate-100">
              🧭 认知推理（共振/因果/预判 —— 盘后展开）
            </summary>
            <div className="px-3 pb-3">
              <ReasoningPanel />
            </div>
          </details>
          {/* v9.113.0（T4-2）：决策直达卡（纯函数直调，不依赖 AI，秒级） */}
          <DecisionCard mainlines={(battlePlan?.candidates ?? []).slice(0, 2).map((c: any) => ({
            mainline: c.mainline ?? "",
            leaders: (c.leaders ?? []).map((l: any) => ({ code: l.code ?? "", name: l.name ?? "" })),
          }))} />
          {/* v9.118.0（S4-2）：操作习惯场景融合 —— v9.133.0（游资改造）默认折叠（决策区一行化） */}
          <details className="rounded-xl border border-violet-500/20 bg-violet-500/5">
            <summary className="cursor-pointer select-none px-4 py-1.5 text-xs font-bold text-violet-300 hover:text-violet-200">
              🧩 操作习惯场景融合（竞价/异动/尾盘/情绪周期 —— 展开）
            </summary>
            <div className="px-3 pb-3">
              <ScenarioPanel />
            </div>
          </details>
      <Dashboard overview={overview} fund={fundStructure} globalData={globalData} mainline={mainline}
            cognMainline={cognMainline}
            battlePlan={battlePlan} loading={loading} phase={currentPhase} watchStocks={watchStocks}
            mainlines={battlePlan?.candidates.map(c => c.mainline) ?? []}
            onSwitchTab={(tab) => { setActive(tab as TabKey); try { import('./lib/uiContext').then(m => m.setActiveTab(tab)); } catch { /* 静默 */ } }}
            yesterdayZt={yesterdayZtBrief}
            nextScenarios={nextScenarios}
            riskRadarText={riskRadarText}
            nextGatePredict={nextGatePredict}
            llmBriefDegraded={llmBriefDegraded} // v9.99.2（B3）：盘后四任务 LLM 降级标记
            sealAlerts={sealAlerts} />
          </>
        )}

        {/* ====== 资金主线（v9.49 F1 分组：强度榜首屏 → 资金结构组 → 外围组） ====== */}
        {/* v9.114.0（T6 D-09 面板收敛）：分区语义对齐 —— 主线（首屏）/ 资金面（默认展开）/ 盘前准备（默认折叠） */}
        {active === "fundline" && (
          <>
            {/* 首屏独占：主线强度榜（PRD B1）+ 题材梯队（v9.49 R1：主线数据归主线 Tab） */}
            <MainlineRanking battlePlan={battlePlan} loading={loading} />
            <ThemeLadder rawZTPool={overview?.limitPool?.rawZTPool ?? null} />
            {/* 资金面组（默认展开，可折叠）—— DarkPool+FundStructure 收敛于此（D-09） */}
            <details className="rounded-xl border border-white/10 bg-white/5" open>
              <summary className="cursor-pointer select-none px-4 py-2 text-sm font-bold text-slate-200 hover:text-slate-100">
                💧 资金面（资金结构 · 明暗盘 · 涨停盘）
              </summary>
              <div className="space-y-3 px-4 pb-4">
                {/* v9.26.20：行业资金流向走势图（全部有数据的行业，组件按实际数量动态展示） */}
                {topIndustryFund.length > 0 && (
                  // v9.100.0（P2-11）：传实际时刻 asOfMinutes —— 原固定 270（=15:00），盘中永远显示"截至 15:00"（审查疑点）
                  // v9.101.0（P2-11 返工）：上限 270→330（09:30+270min=14:00 错误，15:00 应为 330）；
                  //   盘后（≥15:00）固定 330 显示"15:00"（验收实测 21:59 仍显示 14:00）
                  <IndustryFundFlowChart boards={topIndustryFund} refreshSec={60}
                    asOfMinutes={(() => {
                      const bj = getBJDate();
                      const mins = (bj.getHours() * 60 + bj.getMinutes()) - (9 * 60 + 30);
                      if (mins >= 330) return 330; // 盘后固定 15:00
                      return Math.max(0, Math.min(330, mins));
                    })()} />
                )}
                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <h3 className="mb-3 text-sm font-bold text-slate-200">资金结构详情</h3>
                  <FundStructure data={fundStructure} loading={loading} />
                </div>
                <DarkPool data={darkPool} loading={loading} />
                {/* v9.49 R2：涨停盘从龙虎榜 Tab 移入（盘中主线数据归资金主线） */}
                <Suspense fallback={<div className="text-slate-400 p-4">加载涨停盘…</div>}>
                  <LimitBoard />
                </Suspense>
              </div>
            </details>
            {/* 盘前准备组（默认折叠）—— GlobalSignals/CommodityChain 收敛于此（D-09），盘中决策非核心不占主屏 */}
            {/* v9.117.0（S3-3）：主动智能流 v9.133.0 已并入驾驶舱竞价作战区（盘前同屏），此处不再重复 */}
            <details className="rounded-xl border border-white/10 bg-white/5">
              <summary className="cursor-pointer select-none px-4 py-2 text-sm font-bold text-slate-200 hover:text-slate-100">
                ⏰ 盘前准备（全球 · 两融 · 产业链）
              </summary>
              <div className="space-y-3 px-4 pb-4">
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
              </div>
            </details>
          </>
        )}

        {/* ====== 龙虎榜复盘（v9.49 R1/R2：只留席位画像，名副其实） ====== */}
        {active === "dragon" && (
          <Suspense fallback={<div className="text-slate-400 p-6">加载龙虎榜…</div>}>
            <DragonTiger />
          </Suspense>
        )}

        {/* ====== 个股雷达（lazy） ====== */}
        {active === "radar" && (
          <Suspense fallback={<div className="text-slate-400 p-6">加载个股雷达…</div>}>
            {/* v9.24-P1-2：传入今日主线名，供个股决策卡做主线归属判断 */}
            <StockWatchlist mainlines={battlePlan?.candidates.map(c => c.mainline) ?? []} />
            {/* v9.66：盯价监控面板（深度调研结论录入 → 跌入买入区 ±5% 强提示） */}
            <PriceWatchPanel />
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
            {/* v9.49（N1）：事件三级研判 —— v11-5（P1）已移回驾驶舱决策区下方（Dashboard 内渲染） */}
          </Suspense>
        )}
      </main>
      </ErrorBoundary>

      {/* v9.58（V8-8）：全局 AI 助手 —— 根层挂载，所有 Tab 可见；siteContext 打包当前页面状态 */}
      <AIConsole siteContext={{
        topMainline: battlePlan?.candidates?.[0]?.mainline ?? undefined,
        topMainlineScore: battlePlan?.candidates?.[0]?.strengthScore ?? null,
        topMainlineZtCount: battlePlan?.candidates?.[0]?.ztCount ?? 0,
        topMainlineHeight: battlePlan?.candidates?.[0]?.height ?? 0,
        sentiment: overview?.sentiment ?? null,
        sentimentLabel: overview?.sentimentLabel ?? undefined,
        marketNet: fundStructure?.structure?.today?.mainNet ?? 0,
        watchStocks: watchStocks.map(s => s.name).slice(0, 20).join("、") || undefined,
      }} />

      <footer className="mx-auto max-w-[1500px] px-4 py-4 text-center text-[11px] text-slate-600 space-y-1">
        <div>本终端仅用于实盘交易辅助监控，所有数据来自公开接口实时抓取，不构成投资建议</div>
        <div>资金结构 &gt; 涨跌幅 · 风险信号 &gt; 机会信号 · 阶段判断 &gt; 单一指标</div>
        <div className="text-slate-700">{APP_VERSION} · build {BUILD_DATE} · 数据源：东方财富</div>
      </footer>
    </div>
  );
}
