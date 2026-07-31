import { useState, useEffect } from "react";
import MarketOverview from "./MarketOverview";
import DailySummary from "./DailySummary";
import SignalPanel from "./SignalPanel";
import InstitutionFund from "./InstitutionFund";
import Playbook from "./Playbook";
import PopularityRadar from "./PopularityRadar";
import LadderPulse from "./LadderPulse";
import WeeklyCoach from "./WeeklyCoach";
import BattlePlan, { type BattlePlanData } from "./BattlePlan";
import GlobalSignals from "./GlobalSignals";
import { fmtMoney, fmtPct, pctColor } from "../lib/format";
import { stockRealUrl } from "../lib/realLinks";
import { buildThemeLadder, type ZTPoolItem } from "../lib/themeLadder";
import { getFeed, type AlertEvent } from "../lib/alertBus";
import { getAllSince } from "../lib/dataStore";
import type { OverviewData, FundStructureData, GlobalData, MainlineData } from "../App";
import type { SessionPhase } from "../lib/tradingSession";
import type { GateResult } from "../lib/regimeGate";

// ============== 自选股异动项 ==============
export interface WatchStockBrief {
  code: string; name: string; price: number; pct: number;
  turnoverRate: number; alert: boolean; alertTag: string;
}

// ============== 指数光带（极薄通栏） ==============
function IndexStrip({ overview }: { overview: OverviewData | null }) {
  if (!overview) return null;
  const { indices, turnoverAmount, turnoverAvg5d } = overview;
  const volRatio = turnoverAvg5d && turnoverAvg5d > 0 ? turnoverAmount / turnoverAvg5d : null;
  return (
    <div className="flex items-center gap-3 rounded-lg bg-black/30 px-3 py-1 overflow-x-auto text-[11px]">
      {indices.slice(0, 4).map(idx => (
        <span key={idx.code} className="whitespace-nowrap">
          <span className="text-slate-500">{idx.name}</span>
          <span className={`ml-1 font-semibold ${pctColor(idx.pct)}`}>{fmtPct(idx.pct)}</span>
        </span>
      ))}
      <span className="text-slate-600">|</span>
      <span className="text-slate-400 whitespace-nowrap">成交{fmtMoney(turnoverAmount)}</span>
      {volRatio != null && (
        <span className={`whitespace-nowrap ${volRatio > 1.2 ? "text-rose-400" : volRatio < 0.8 ? "text-emerald-400" : "text-slate-500"}`}>
          vs均量{(volRatio * 100).toFixed(0)}%
        </span>
      )}
    </div>
  );
}

// ============== 涨停温度计横条 ==============
function LimitTempBar({ overview }: { overview: OverviewData | null }) {
  if (!overview?.limitPool) return null;
  const lp = overview.limitPool;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] overflow-x-auto">
      <span className="text-rose-400">涨停<b>{lp.limitUpCount}</b></span>
      <span className="text-emerald-400">跌停<b>{lp.limitDownCount}</b></span>
      <span className="text-amber-400">炸板率<b>{lp.blastedRate.toFixed(1)}%</b></span>
      {overview.promotionRate != null && (
        <span className="text-slate-300">晋级率<b>{(overview.promotionRate * 100).toFixed(1)}%</b></span>
      )}
      {overview.premiumAvg != null && (
        <span className={pctColor(overview.premiumAvg)}>溢价<b>{overview.premiumAvg >= 0 ? "+" : ""}{overview.premiumAvg.toFixed(2)}%</b></span>
      )}
      {overview.maxBoardHeight != null && (
        <span className="text-amber-300">最高<b>{overview.maxBoardHeight}板</b></span>
      )}
    </div>
  );
}

// ============== 自选股异动带 ==============
function WatchlistStrip({ stocks }: { stocks: WatchStockBrief[] }) {
  if (stocks.length === 0) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-2">
      <div className="text-[11px] text-slate-500 mb-1">自选异动</div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {stocks.map(s => (
          <a key={s.code} href={stockRealUrl(s.code)} target="_blank" rel="noopener noreferrer"
            className={`shrink-0 rounded-lg px-2 py-1 text-[11px] border ${s.alert ? "border-amber-500/30 bg-amber-500/5" : "border-white/10 bg-black/20"} hover:bg-white/5`}>
            <div className="font-bold text-slate-200">{s.name}</div>
            <div className="flex gap-1">
              <span className={`font-semibold ${pctColor(s.pct)}`}>{fmtPct(s.pct)}</span>
              {s.alert && <span className="text-amber-400 text-[9px]">{s.alertTag}</span>}
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

// ============== 闸门+温度计超大号卡 ==============
function GateGauge({ overview, gate }: { overview: OverviewData | null; gate: GateResult | null }) {
  if (!overview) return null;
  const s = overview.sentiment;
  const color = s >= 80 ? "#ef4444" : s >= 65 ? "#f59e0b" : s >= 45 ? "#eab308" : s >= 25 ? "#3b82f6" : "#8b5cf6";
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-center space-y-2">
      <div className="text-[11px] text-slate-500">情绪 × 闸门</div>
      <div className="text-3xl font-black" style={{ color }}>{s}</div>
      <div className="text-xs text-slate-400">{overview.sentimentLabel}</div>
      {gate && (
        <div className={`text-2xl font-black ${gate.factor >= 0.8 ? "text-emerald-400" : gate.factor >= 0.5 ? "text-amber-300" : "text-rose-400"}`}>
          ×{gate.factor.toFixed(1)}
        </div>
      )}
      {gate && <div className="text-[11px] text-slate-500">{gate.label}</div>}
      {gate && gate.reason.length > 0 && (
        <div className="space-y-0.5">
          {gate.reason.map((r, i) => (
            <div key={i} className="text-[10px] text-rose-400">🔥 {r}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============== 重要信息摘录（真实新闻+公告） ==============
function ImportantFeed() {
  const [items, setItems] = useState<Array<{ title: string; summary: string; url: string; time: string; tag: string }>>([]);
  useEffect(() => {
    const d = new Date(); d.setDate(d.getDate() - 2);
    const cutoff = d.toISOString().slice(0, 10);
    const { news, ann } = getAllSince(cutoff);
    const picks = [
      ...news.filter(n => n.stars >= 2 || n.sentiment !== "neutral").map(n => ({
        title: n.title, summary: (n.summary || "").slice(0, 40),
        url: n.url, time: n.time, tag: `${n.sentiment === "positive" ? "利好" : n.sentiment === "negative" ? "利空" : "★"}快讯`,
      })),
      ...ann.filter(a => a.score == null || a.score >= 4).map(a => ({
        title: `${a.stockName}：${a.title}`, summary: `[${a.columnName || "公告"}]`,
        url: a.url, time: a.time, tag: "公告",
      })),
    ].filter(x => x.title && x.url);
    picks.sort((a, b) => b.time.localeCompare(a.time));
    setItems(picks.slice(0, 10));
  }, []);
  const tagColor = (t: string) => t.includes("利好") ? "text-emerald-300" : t.includes("利空") ? "text-rose-300" : t === "公告" ? "text-amber-300" : "text-sky-300";
  if (items.length === 0) return null;
  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-2 max-h-[220px] overflow-y-auto [scrollbar-width:thin]">
      <div className="text-[11px] font-bold text-amber-300 mb-1">⭐ 重要信息摘录（新闻+公告）</div>
      {items.map((x, i) => (
        <a key={i} href={x.url} target="_blank" rel="noopener noreferrer" className="block py-0.5 hover:bg-white/5 rounded">
          <span className={`text-[10px] font-bold mr-1 ${tagColor(x.tag)}`}>[{x.tag}]</span>
          <span className="text-[11px] text-slate-200">{x.title}</span>
          {x.summary && <span className="text-[10px] text-slate-500 ml-1">{x.summary}</span>}
          <span className="text-[10px] text-slate-600 ml-1">{x.time.slice(5, 16)}</span>
        </a>
      ))}
    </div>
  );
}

// ============== 预警流水 ==============
function AlertFeed() {
  const [items, setItems] = useState<AlertEvent[]>(() => getFeed());
  useEffect(() => {
    const t = setInterval(() => setItems(getFeed()), 5000);
    return () => clearInterval(t);
  }, []);
  if (items.length === 0) return <div className="text-[11px] text-slate-600">暂无预警</div>;
  const sevColor = (s: string) => s === "critical" ? "text-rose-400" : s === "warning" ? "text-amber-300" : "text-slate-400";
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-2 max-h-[200px] overflow-y-auto [scrollbar-width:thin]">
      <div className="text-[11px] font-bold text-slate-400 mb-1">预警流水</div>
      {items.slice(0, 20).map((e, i) => (
        <div key={i} className={`text-[11px] py-0.5 ${sevColor(e.severity)}`}>
          <span className="text-slate-600 mr-1">{new Date(e.ts).toTimeString().slice(0, 5)}</span>
          {e.message}
        </div>
      ))}
    </div>
  );
}

// ============== 梯队缩略卡 ==============
function LadderMini({ overview, onSwitchTab }: { overview: OverviewData | null; onSwitchTab?: () => void }) {
  if (!overview?.limitPool?.rawZTPool) return null;
  const groups = buildThemeLadder(overview.limitPool.rawZTPool as ZTPoolItem[]);
  const top3 = groups.slice(0, 3);
  if (top3.length === 0) return null;
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-2 cursor-pointer hover:bg-white/10" onClick={onSwitchTab}>
      <div className="text-[11px] font-bold text-amber-300 mb-1">🏔️ 梯队Top3 <span className="text-slate-600 font-normal">→点击详情</span></div>
      {top3.map(g => (
        <div key={g.theme} className="flex items-center justify-between text-[11px] py-0.5">
          <span className="text-slate-200">{g.theme}</span>
          <span className={g.height >= 3 ? "text-amber-300 font-bold" : "text-slate-400"}>{g.height}板 {g.count}只</span>
          {g.gapTiers.length > 0 && <span className="text-[9px] text-slate-500 line-through ml-1">断档</span>}
        </div>
      ))}
    </div>
  );
}

// ============== Props ==============
interface DashboardProps {
  overview: OverviewData | null;
  fund: FundStructureData | null;
  globalData?: GlobalData | null;
  mainline?: MainlineData | null;
  battlePlan?: BattlePlanData | null;
  loading: boolean;
  phase?: SessionPhase;
  watchStocks?: WatchStockBrief[];
  onSwitchTab?: (tab: string) => void;
}

export default function Dashboard({
  overview, fund, globalData, mainline, battlePlan, loading,
  phase = "post", watchStocks = [], onSwitchTab,
}: DashboardProps) {
  const [showAI, setShowAI] = useState(phase === "post");
  const [showSignal, setShowSignal] = useState(false);

  const isTrading = phase === "trading";
  const isPost = phase === "post";
  const isPre = phase === "pre" || phase === "auction";
  const gate = battlePlan?.gate ?? null;

  return (
    <div className="space-y-2">
      {/* 指数光带（极薄通栏） */}
      <IndexStrip overview={overview} />

      {/* ============== 盘中布局 ============== */}
      {isTrading && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_300px]">
          {/* 左 2/3 */}
          <div className="space-y-2">
            <BattlePlan data={battlePlan ?? null} />
            <WatchlistStrip stocks={watchStocks} />
            <LimitTempBar overview={overview} />
            <MarketOverview data={overview} loading={loading} />
            <PopularityRadar />
          </div>
          {/* 右 1/3 */}
          <div className="space-y-2">
            <GateGauge overview={overview} gate={gate} />
            <ImportantFeed />
            <AlertFeed />
            <LadderMini overview={overview} onSwitchTab={() => onSwitchTab?.("dragon")} />
          </div>
        </div>
      )}

      {/* ============== 盘前/竞价布局 ============== */}
      {isPre && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_340px]">
          <div className="space-y-2">
            <Playbook sentiment={overview?.sentiment} limitUpCount={overview?.limitPool?.limitUpCount}
              blastedRate={overview?.limitPool?.blastedRate} overview={overview} globalData={globalData} mainline={mainline} />
            {globalData && <GlobalSignals data={globalData} loading={loading} />}
            <BattlePlan data={battlePlan ?? null} />
          </div>
          <div className="space-y-2">
            <GateGauge overview={overview} gate={gate} />
            <LadderMini overview={overview} onSwitchTab={() => onSwitchTab?.("dragon")} />
            <PopularityRadar />
          </div>
        </div>
      )}

      {/* ============== 盘后/午休布局 ============== */}
      {(isPost || phase === "lunch") && (
        <>
          {/* AI复盘和信号面板 */}
          <div className="flex gap-2">
            <button onClick={() => setShowAI(v => !v)}
              className="rounded px-3 py-1 text-xs bg-violet-500/10 text-violet-300 hover:bg-violet-500/20 border border-violet-500/20">
              {showAI ? "收起AI复盘" : "AI复盘总结"}
            </button>
            <button onClick={() => setShowSignal(v => !v)}
              className="rounded px-3 py-1 text-xs bg-white/5 text-slate-300 hover:bg-white/10 border border-white/10">
              {showSignal ? "收起信号/日记" : "信号账本/日记"}
            </button>
          </div>
          {showAI && <DailySummary overview={overview} fund={fund} />}
          {showSignal && <SignalPanel />}

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_340px]">
            <div className="space-y-2">
              <BattlePlan data={battlePlan ?? null} />
              <MarketOverview data={overview} loading={loading} />
              <PopularityRadar />
            </div>
            <div className="space-y-2">
              <GateGauge overview={overview} gate={gate} />
              <Playbook sentiment={overview?.sentiment} limitUpCount={overview?.limitPool?.limitUpCount}
                blastedRate={overview?.limitPool?.blastedRate} overview={overview} globalData={globalData} mainline={mainline} />
              <InstitutionFund />
              <LadderPulse overview={overview} />
              <WeeklyCoach />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
