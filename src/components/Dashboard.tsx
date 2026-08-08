import { useState, useEffect, useMemo } from "react";
import MarketOverview from "./MarketOverview";
// v9.48（D2）：EmotionCycleCard 移除 —— 情绪/涨停/炸板/溢价/晋级率已在温度条+总览+闸门多处展示，去冗余
import DisciplinePanel from "./DisciplinePanel";
import ReviewPanel from "./ReviewPanel";
import AuctionBoard from "./AuctionBoard";
import FiveQBar from "./FiveQBar";
import DailySummary from "./DailySummary";
import SignalPanel from "./SignalPanel";
// v9.35（S3）：信号有效性回测面板
import SignalEffectivenessPanel from "./SignalEffectivenessPanel";
// v9.42：因子健康度面板（幻方"因子失效"IC 曲线可视化）
import FactorHealthPanel from "./FactorHealthPanel";
// v9.65（V2-P2）：运维可观测面板
import OpsPanel from "./OpsPanel";
// v9.44（②/④）：决策审计时间线 + 信号净值曲线
import DecisionAuditPanel from "./DecisionAuditPanel";
import SignalEquityPanel from "./SignalEquityPanel";
// v9.36（A2）：竞价强度榜
import AuctionStrengthPanel from "./AuctionStrengthPanel";
// v9.36（A3）：龙虎榜×涨停池交叉
import LhbCrossPanel from "./LhbCrossPanel";
// P1-3：极简盯盘皮肤（盘中 3 秒扫一眼）
import SimpleWatchSkin, { type TopMainlineBrief, type WatchAlertBrief } from "./SimpleWatchSkin";
// v9.49（N1）：EventClassifyPanel 已移到"消息面"Tab（事件研判归消息面），Dashboard 不再引用
// v9.38.1（V3-12）：读 kv 事件分级数据（决策消息面证据源）
import { isLocalServer, kvGet, kvSet } from "../lib/cloudStore";
// v9.37（V3-4/7）：AI 终裁决（多源共识）
import DecisionVerdictCard from "./DecisionVerdictCard";
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

// v9.26.11：建议动作颜色（轻仓/重仓参与=积极红；观察=黄；禁止/无需=灰）
function actionColor(action: string): string {
  if (action.includes("重仓参与")) return "text-rose-300 font-bold";
  if (action.includes("轻仓参与")) return "text-amber-300 font-semibold";
  if (action.includes("观察")) return "text-sky-300";
  return "text-slate-500";
}

import LadderPulse from "./LadderPulse";
import WeeklyCoach from "./WeeklyCoach";
import BattlePlan, { type BattlePlanData } from "./BattlePlan";
// v9.52（V7-3）：今日上车标的清单（决策区下方、BattlePlan 之后）
import StockPickList from "./StockPickList";
// v11-4（P1）：GlobalSignals 移出驾驶舱 → fundline Tab"🌐外围信号"（App.tsx 已渲染，此处不再 import）
// v11-5（P1）：事件三级研判回驾驶舱
import EventClassifyPanel from "./EventClassifyPanel";
import { fmtMoney, fmtPct, pctColor, localDateStrOffset, localDateStr } from "../lib/format";
import { loadIntradaySeries, computeMomentum, suggestPosition } from "../lib/sentimentStore";
import { buildThemeLadder, type ZTPoolItem } from "../lib/themeLadder";
import { getFeed, type AlertEvent } from "../lib/alertBus";
import { getAllSince } from "../lib/dataStore";
import { matchStocksToMainline, summarizeMatches } from "../lib/positionMatch";
import type { OverviewData, FundStructureData, GlobalData, MainlineData } from "../App";
import type { SessionPhase } from "../lib/tradingSession";
// v9.55-fix（V7-19）：北京时间交易日历（loadFactorRows 回看日期）
import { isTradingDay, bjDateStr } from "../lib/tradeCalendar";
import type { GateResult } from "../lib/regimeGate";
// v9.24-P1-4：异动捕捉引擎（S/A/B 分级 + 事件流）
import { useRef } from "react";
import { classifyAnomaly, emitAnomaly, subscribeAnomaly, getAnomalies, updateAnomaly, type AnomalyEvent } from "../lib/anomalyTier";

// ============== 自选股异动项 ==============
export interface WatchStockBrief {
  code: string; name: string; price: number; pct: number;
  turnoverRate: number; alert: boolean; alertTag: string;
  /** v9.24-P1-4：量比（异动分级用） */
  volumeRatio?: number;
  /** v9.26.10：涨跌幅限制（10/20），异动分级按板块区分 */
  limitPct?: number;
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
// 核心进阶温度条（v9.48 G1：涨停/跌停/炸板率已在 StatusBar 全局常驻，此处只留进阶指标：
// 晋级率/溢价/最高板 —— 不再三处重复同一组数）
function LimitTempBar({ overview }: { overview: OverviewData | null }) {
  if (!overview?.limitPool) return null;
  const lp = overview.limitPool;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-3 py-1.5 text-[11px] overflow-x-auto">
      <span className="text-slate-500 font-bold">📊 进阶指标</span>
      {overview.promotionRate != null && (
        <span className="text-slate-300">晋级率<b className="text-amber-300">{(overview.promotionRate * 100).toFixed(1)}%</b></span>
      )}
      {overview.premiumAvg != null && (
        <span className={pctColor(overview.premiumAvg)}>溢价<b>{overview.premiumAvg >= 0 ? "+" : ""}{overview.premiumAvg.toFixed(2)}%</b></span>
      )}
      {overview.maxBoardHeight != null && (
        <span className="text-amber-300">最高<b>{overview.maxBoardHeight}板</b></span>
      )}
      {lp.boardCounts && Object.keys(lp.boardCounts).length > 0 && (
        <span className="text-slate-400">梯队<b className="text-amber-300">{Object.entries(lp.boardCounts).sort((a, b) => Number(b[0]) - Number(a[0])).slice(0, 3).map(([h, n]) => `${h}板×${n}`).join(" ")}</b></span>
      )}
      <span className="ml-auto text-xs text-slate-600">涨停{lp.limitUpCount} · 炸板{lp.blastedRate.toFixed(1)}%（见顶部状态栏）</span>
    </div>
  );
}

// ============== P3 持仓-主线匹配（自选股 vs 当日主线） ==============
// 十年机构视角：交易员每天第一问是"我的票还在主线上吗？"
// 顺风=在主线上 / 概念异动=强势但偏离主线（涨停/大幅上涨） / 逆风=所在板块退潮 / 孤立/弱势孤立
function PositionMatchStrip({ stocks, boards }: {
  stocks: WatchStockBrief[];
  boards: MainlineData["boards"] | undefined;
}) {
  const matches = useMemo(() => matchStocksToMainline(
    stocks.map(s => ({ code: s.code, name: s.name, pct: s.pct })),
    (boards ?? []).map(b => ({ name: b.name, pct: b.pct, stage: b.stage })),
  ), [stocks, boards]);
  if (matches.length === 0) return null;
  const sum = summarizeMatches(matches);
  // 五种状态色
  const statusColor = (st: string) => st === "tailwind" ? "border-emerald-500/30 bg-emerald-500/5" :
    st === "headwind" ? "border-rose-500/30 bg-rose-500/5" :
    st === "concept_breakout" ? "border-amber-500/30 bg-amber-500/5" :
    st === "isolated_bear" ? "border-rose-500/30 bg-rose-500/5" :
    "border-white/10 bg-black/20";
  const badge = (st: string) => st === "tailwind" ? "text-emerald-300 bg-emerald-500/20" :
    st === "headwind" ? "text-rose-300 bg-rose-500/20" :
    st === "concept_breakout" ? "text-amber-300 bg-amber-500/20" :
    st === "isolated_bear" ? "text-rose-300 bg-rose-500/20" :
    "text-slate-400 bg-slate-500/20";
  const label = (st: string) => st === "tailwind" ? "顺风" :
    st === "headwind" ? "逆风" :
    st === "concept_breakout" ? "🔥概念异动" :
    st === "isolated_bear" ? "⚠弱势" :
    "孤立";
  // 警示条：有异动/逆风/弱势时显示
  const warnings: string[] = [];
  if (sum.concept_breakout > 0) warnings.push(`🔥 ${sum.concept_breakout}只强势异动（不在主线，谨慎追高）`);
  if (sum.headwind > 0) warnings.push(`⚠ ${sum.headwind}只逆风（所在板块退潮，历史统计偏弱）`);
  if (sum.isolated_bear > 0) warnings.push(`⚠ ${sum.isolated_bear}只弱势孤立`);
  return (
    <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-3 space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-bold text-violet-300">🎯 持仓 × 主线匹配</div>
        <div className="flex gap-1.5 text-xs">
          <span className="text-emerald-300">顺风{sum.tailwind}</span>
          {sum.concept_breakout > 0 && <span className="text-amber-300 font-bold">🔥异动{sum.concept_breakout}</span>}
          <span className="text-slate-400">孤立{sum.isolated}</span>
          {sum.headwind > 0 && <span className="text-rose-300 font-bold">逆风{sum.headwind}</span>}
        </div>
      </div>
      {warnings.length > 0 && (
        <div className="space-y-0.5">
          {warnings.map((w, i) => <div key={i} className="text-[11px] text-amber-300">{w}</div>)}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {matches.map(m => (
          <span key={m.code} className={`rounded-lg border px-2 py-1 text-xs ${statusColor(m.status)}`} title={m.hint}>
            <span className="text-slate-200 font-semibold">{m.name}</span>
            <span className="ml-1 text-slate-500">{m.code}</span>
            <span className={`ml-1 rounded px-1 py-0.5 text-xs font-bold ${badge(m.status)}`}>{label(m.status)}</span>
            {m.matchedBoard && <span className="ml-1 text-slate-400">{m.matchedBoard.name}({m.matchedBoard.pct >= 0 ? "+" : ""}{m.matchedBoard.pct.toFixed(2)}%)</span>}
            {m.matchFrom === "concept" && <span className="ml-1 text-amber-400/80 text-xs">概念</span>}
          </span>
        ))}
      </div>
      <div className="text-xs text-slate-600">顺风=主线行业/概念共振 / 🔥异动=涨幅 ≥5% 但偏离主线（历史统计追高风险高）/ 逆风=主线退潮 / 孤立=与今日主线无关</div>
    </div>
  );
}

// ============== 自选股异动带（v9.24-P1-4 升级为异动捕捉引擎 S/A/B 分级） ==============
// PRD 5.6/A5：自选异动模块升级——分级色条 + 触发原因 + 呼应主线 + AI研判 + 建议动作
const LEVEL_META: Record<string, { label: string; bar: string; badge: string; ring: string }> = {
  S: { label: "S", bar: "bg-rose-500", badge: "bg-rose-500 text-white", ring: "ring-rose-500/40" },
  A: { label: "A", bar: "bg-amber-500", badge: "bg-amber-500/20 text-amber-300", ring: "ring-amber-500/30" },
  B: { label: "B", bar: "bg-slate-500", badge: "bg-slate-500/20 text-slate-300", ring: "" },
};

function minsAgo(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m <= 0) return "刚刚";
  return `${m}分钟前`;
}

function AnomalyStrip({ stocks, mainlines = [] }: { stocks: WatchStockBrief[]; mainlines?: string[] }) {
  const [events, setEvents] = useState<AnomalyEvent[]>(() => getAnomalies());
  const tickRef = useRef(0);
  // 订阅事件流（S 级提醒触发时刷新）
  useEffect(() => {
    const refresh = () => setEvents([...getAnomalies()]);
    refresh();
    return subscribeAnomaly(refresh);
  }, []);
  // 每 30s 刷新"距首次触发"时间显示
  useEffect(() => {
    const t = setInterval(() => { tickRef.current++; setEvents([...getAnomalies()]); }, 30000);
    return () => clearInterval(t);
  }, []);

  // 实时计算每只自选股的分级（S/A/B），S/A 级 emit 到事件流（冷却去重防刷屏）
  // 注意：verdicts 是普通计算，不调用 hook，可放在 conditional return 之前
  const verdicts = stocks.length === 0 ? [] : stocks.map(s => ({
    stock: s,
    verdict: classifyAnomaly({ code: s.code, name: s.name, pct: s.pct, volumeRatio: s.volumeRatio ?? null, turnoverRate: s.turnoverRate, limitPct: s.limitPct ?? 10 }, mainlines),
  })).filter((x): x is { stock: WatchStockBrief; verdict: NonNullable<ReturnType<typeof classifyAnomaly>> } => x.verdict != null);

  useEffect(() => {
    for (const { stock, verdict } of verdicts) {
      if (verdict.level === "S" || verdict.level === "A") {
        emitAnomaly(verdict, { code: stock.code, name: stock.name, pct: stock.pct, volumeRatio: stock.volumeRatio ?? null, turnoverRate: stock.turnoverRate });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stocks]);

  // v9.26 A.6：事件驱动 LLM 解释 —— 只对 S/A 级且未解释过的事件异步补一句归因（每 eventId 一次）
  useEffect(() => {
    const pending = getAnomalies().filter(e =>
      (e.level === "S" || e.level === "A") && !e.aiCommentLLM && !e.aiLLMDegraded,
    );
    if (pending.length === 0) return;
    for (const e of pending.slice(0, 3)) {
      (async () => {
        try {
          const prompt = `股票${e.name}(${e.code}) 触发${e.level}级异动：${e.reason}${e.mainlineHit ? `，呼应当前主线(${e.mainlineName})` : "，未在今日主线"}。
真实数据：涨幅${e.pct?.toFixed?.(2) ?? "?"}% · 量比${e.volumeRatio?.toFixed?.(1) ?? "?"} · 换手${e.turnoverRate?.toFixed?.(1) ?? "?"}%。
用不超过40字解释该异动可能的含义，并给一句行动建议。必须基于以上真实数据，不得编造数字。格式：归因（40字内）｜建议：动作`;
          const { callAI } = await import("../lib/ai");
          const r = await callAI("eventExplain", { prompt });
          const text = r.text.trim().replace(/^[\s\S]*?规则版[：:]\s*/, "").slice(0, 120);
          if (r.degraded) {
            updateAnomaly(e.id, { aiLLMDegraded: true });
          } else if (text && !text.startsWith("异动解释规则版")) {
            updateAnomaly(e.id, { aiCommentLLM: text });
          } else {
            updateAnomaly(e.id, { aiLLMDegraded: true });
          }
        } catch {
          updateAnomaly(e.id, { aiLLMDegraded: true });
        }
      })();
    }
  }, [events]);

  // v9.24.1-fix：早返回必须放在所有 hooks 之后（防止 stocks 长度从 0 变 N 时 hooks 数量变化，
  // 违反 React Rules of Hooks 触发 error #310 整页崩溃）
  if (stocks.length === 0) return null;

  // S 级事件（用于红色闪烁角标）
  const sCount = events.filter(e => e.level === "S").length;

  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] text-slate-500">异动捕捉引擎</span>
        <span className="flex items-center gap-1 text-xs">
          {sCount > 0 && <span className="animate-pulse rounded bg-rose-500/20 px-1.5 py-0.5 font-bold text-rose-300">S×{sCount} 紧急</span>}
          <span className="text-slate-600">S级红闪 · A级高亮 · B级关注</span>
        </span>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {verdicts.map(({ stock, verdict }) => {
          const meta = LEVEL_META[verdict.level];
  return (
            <div key={stock.code}
              className={`relative shrink-0 rounded-lg pl-3 pr-2 py-1 text-[11px] border bg-black/20 ${verdict.level === "S" ? "animate-pulse border-rose-500/40" : verdict.level === "A" ? "border-amber-500/30" : "border-white/10"}`}
              title={`${verdict.reason}｜${verdict.aiComment}｜建议：${verdict.action}`}>
              {/* 等级色条 */}
              <span className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-lg ${meta.bar}`} />
              <div className="flex items-center gap-1">
                <span className={`rounded px-1 text-xs font-black ${meta.badge}`}>{meta.label}</span>
                <span className="font-bold text-slate-200">{stock.name}</span>
                <span className={`font-semibold ${pctColor(stock.pct)}`}>{fmtPct(stock.pct)}</span>
              </div>
              <div className="text-xs text-slate-500 leading-tight mt-0.5">
                {verdict.reason}
                {verdict.mainlineHit && <span className="ml-1 text-amber-300">⚡呼应主线</span>}
              </div>
              <div className="text-xs text-slate-400 leading-tight">
                {verdict.aiComment} · <span className={actionColor(verdict.action)}>{verdict.action}</span>
              </div>
            </div>
          );
        })}
        {verdicts.length === 0 && (
          <div className="text-[11px] text-slate-600 py-1">暂无显著异动（S/A/B 均未触发）</div>
        )}
      </div>
      {/* 事件流摘要（S/A 级历史 + v9.26 A.6 LLM 异步解释） */}
      {events.length > 0 && (
        <div className="mt-1 border-t border-white/5 pt-1 text-xs space-y-1">
          {events.slice(0, 5).map(e => (
            <div key={e.id} className="flex flex-wrap gap-x-3 gap-y-0.5">
              <span className={e.level === "S" ? "text-rose-400" : e.level === "A" ? "text-amber-300/80" : "text-slate-500"}>
                {minsAgo(e.ts)} [{e.level}] {e.name} <span className={actionColor(e.action)}>{e.action}</span>
              </span>
              {e.aiCommentLLM && (
                <span className="text-violet-300/90">🤖 {e.aiCommentLLM}</span>
              )}
              {!e.aiCommentLLM && !e.aiLLMDegraded && e.level !== "B" && (
                <span className="text-slate-600 animate-pulse">🤖 AI解释生成中…</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============== 情绪日内折线（纯 SVG，零依赖） ==============
// P2：把静态情绪分升级为"日内轨迹"，直观展示升温/降温
function SentimentSparkline({ pts }: { pts: { t: string; s: number }[] }) {
  if (pts.length < 2) return null;
  const w = 280, h = 44, pad = 4;
  const min = Math.min(...pts.map(p => p.s), 0);
  const max = Math.max(...pts.map(p => p.s), 100);
  const range = Math.max(1, max - min);
  const step = (w - pad * 2) / (pts.length - 1);
  const xy = pts.map((p, i) => ({
    x: pad + i * step,
    y: h - pad - ((p.s - min) / range) * (h - pad * 2),
  }));
  const path = xy.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const last = xy[xy.length - 1];
  const first = xy[0];
  const rising = last.y < first.y;
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-11">
        <line x1={pad} y1={h - pad - ((50 - min) / range) * (h - pad * 2)} x2={w - pad} y2={h - pad - ((50 - min) / range) * (h - pad * 2)} stroke="rgba(255,255,255,0.12)" strokeWidth="1" strokeDasharray="3 3" />
        <path d={path} fill="none" stroke={rising ? "#f59e0b" : "#38bdf8"} strokeWidth="2" strokeLinecap="round" />
        <circle cx={first.x} cy={first.y} r="2" fill="rgba(255,255,255,0.4)" />
        <circle cx={last.x} cy={last.y} r="3" fill={rising ? "#f59e0b" : "#38bdf8"} />
      </svg>
      <div className="flex justify-between text-xs text-slate-600">
        <span>{pts[0].t}</span>
        <span>情绪日内轨迹</span>
        <span>{pts[pts.length - 1].t}</span>
      </div>
    </div>
  );
}

// ============== 闸门+温度计超大号卡 ==============
function GateGauge({ overview, gate }: { overview: OverviewData | null; gate: GateResult | null }) {
  if (!overview) return null;
  const s = overview.sentiment;
  // 修复：s 可能是 null（类型收窄），color 用兜底值
  const color = s == null ? "#8b5cf6" : s >= 80 ? "#ef4444" : s >= 65 ? "#f59e0b" : s >= 45 ? "#eab308" : s >= 25 ? "#3b82f6" : "#8b5cf6";
  // P2：情绪动量 + 仓位建议
  const intraday = loadIntradaySeries();
  const { momentum, delta } = computeMomentum(intraday);
  const advice = suggestPosition(s, momentum, gate?.factor ?? null);
  const momentumLabel = momentum === "heating" ? `🔥 升温 ${delta > 0 ? "+" : ""}${delta.toFixed(0)}` : momentum === "cooling" ? `❄️ 降温 ${delta.toFixed(0)}` : momentum === "flat" ? "→ 平稳" : "—";
  const posColor = advice.positionPct >= 70 ? "text-emerald-400" : advice.positionPct >= 40 ? "text-amber-300" : "text-rose-400";
  // v9.26.13：闸门系数颜色——高位（机会/中性）= 绿/琥珀，低位（熔断）= 红
  const gateColor = gate?.factor == null ? "text-slate-400"
    : gate.factor >= 0.7 ? "text-emerald-400"
    : gate.factor >= 0.4 ? "text-amber-300"
    : "text-rose-400";
  // v9.26.13：极端情绪反向机会提示（贪婪→控仓兑现/恐慌→超跌机会）
  const isExtreme = s != null && (s >= 80 || s < 25);
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-center space-y-2">
      <div className="text-[11px] text-slate-500">情绪 × 闸门</div>
      <div className="text-3xl font-black" style={{ color }}>{s != null && s > 0 ? s : "—"}</div>
      <div className="text-xs text-slate-400">{overview.sentimentLabel}</div>
      {gate && (
        <div className={`text-2xl font-black ${gateColor}`}>
          ×{gate.factor != null ? gate.factor.toFixed(1) : "—"}
        </div>
      )}
      {gate && <div className="text-[11px] text-slate-500">{gate.label}</div>}
      {/* v9.26.13：极端情绪反向机会提示（不再一律"禁新开仓/空仓"） */}
      {isExtreme && (
        <div className={`rounded-lg border px-2 py-1.5 text-left ${
          s >= 80
            ? "border-rose-500/40 bg-rose-500/10"
            : "border-sky-500/40 bg-sky-500/10"
        }`}>
          <div className={`text-xs font-bold ${s >= 80 ? "text-rose-300" : "text-sky-300"}`}>
            {s >= 80 ? "⚡ 控仓兑现（反向信号）" : "🔵 超跌机会（反向窗口）"}
          </div>
          <div className="text-xs text-slate-300 mt-0.5 leading-snug">
            {s >= 80
              ? "情绪极度贪婪 = 风险累积信号。已重仓者分批兑现，向确定性最高的龙头集中；轻仓者戒追高、加仓严守止损。"
              : "情绪极度恐慌 = 逆向买入窗口。关注 ETF 与白马蓝筹的左侧机会；分批建仓（白马/龙头优先），止损位设买入下方 5-8%。"}
          </div>
        </div>
      )}
      {/* P2：情绪动量标签 */}
      <div className="text-[11px] font-semibold text-slate-300">动量 {momentumLabel}</div>
      {/* P2：建议总仓位（十年机构视角：先定仓位，再谈标的） */}
      <div className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5">
        <div className="text-xs text-slate-500">建议总仓位</div>
        <div className={`text-2xl font-black ${posColor}`}>{advice.positionPct}%</div>
        <div className="text-xs text-slate-400">{advice.label}</div>
        <div className="text-xs text-slate-600 mt-0.5">{advice.hint}</div>
      </div>
      {/* P2：日内轨迹折线 */}
      <SentimentSparkline pts={intraday} />
      {gate && gate.reason.length > 0 && (
        <div className="space-y-0.5">
          {gate.reason.map((r, i) => (
            <div key={i} className="text-xs text-rose-400">🔥 {r}</div>
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
    // 修复：用本地日期（前 2 天），与 dataStore 存储口径一致
    const cutoff = localDateStrOffset(2);
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
          <span className={`text-xs font-bold mr-1 ${tagColor(x.tag)}`}>[{x.tag}]</span>
          <span className="text-[11px] text-slate-200">{x.title}</span>
          {x.summary && <span className="text-xs text-slate-500 ml-1">{x.summary}</span>}
          <span className="text-xs text-slate-600 ml-1">{x.time.slice(5, 16)}</span>
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
          {g.gapTiers.length > 0 && <span className="text-xs text-slate-500 line-through ml-1">断档</span>}
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
  /** v9.24-P1-4：今日主线名（异动分级"呼应主线"判断用） */
  mainlines?: string[];
  onSwitchTab?: (tab: string) => void;
  /** v9.19-F2：今日涨停池（竞价台用） */
  ztPool?: Array<{ c: string; n: string; fbt: number; lbc: number }>;
  /** v9.19-F2：昨日涨停股（竞价台用） */
  yesterdayZt?: Array<{ code: string; name: string }>;
  /** v9.33（缺口3）：LLM 盘后三剧本 / 竞价龙头预判 / 风险雷达 */
  nextScenarios?: Array<{ scenario: string; probability: number; conditions: string[]; focus: string[] }> | null;
  leaderPredict?: { predictLeader: { code: string; name: string } | null; confidence: number; reason: string; watch: string } | null;
  riskRadarText?: string | null;
  /** v9.75（阶段二）：次日闸门预测 */
  nextGatePredict?: { nextGate: string; reason: string; watchPoints: string[] } | null;
  /** v9.34（S1）：封单衰减预警（终裁决证据源） */
  sealAlerts?: Array<{ level: "yellow" | "red" }> | null;
}

export default function Dashboard({
  overview, fund, globalData, mainline, battlePlan, loading,
  phase: phaseProp = "post", watchStocks = [], mainlines = [], onSwitchTab, ztPool, yesterdayZt,
  nextScenarios = null, leaderPredict = null, riskRadarText = null, sealAlerts = null, nextGatePredict = null,
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
        const r = await fetch("/api/watch/list");
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
  // 修复：原代码只在组件首次挂载时算一次 phase，phase 改变时不会重新打开 AI 复盘
  const [showAI, setShowAI] = useState(panelPref.showAI ?? phase === "post");
  const [showSignal, setShowSignal] = useState(Boolean(panelPref.showSignal));
  // v9.35（S3）：信号有效性回测面板
  const [showSignalEffect, setShowSignalEffect] = useState(Boolean(panelPref.showSignalEffect));
  // v9.42：因子健康度面板（幻方"因子失效"IC 曲线）
  const [showFactorHealth, setShowFactorHealth] = useState(Boolean(panelPref.showFactorHealth));
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
  const isPre = phase === "pre" || phase === "auction";
  const gate = battlePlan?.gate ?? null;

  // v9.38（V3-2/3）：Agent 深审 —— v9.39 起自动主导（5 分钟节流）+ 保留手动按钮
  // v9.41（V4-E）：覆盖 Top-3 主线（每条一个 AI 裁决，共享节流）
  const [agentResults, setAgentResults] = useState<Array<{ mainline: string; verdict: AgentVerdict; snap: { strengthScore: number; ztCount: number } }>>([]);
  const [agentLoading, setAgentLoading] = useState(false);
  const agentLastRunRef = useRef(0); // 自动触发节流（5 分钟）
  // v11-3（P0）：上次裁决 action（变化提示用）—— ref 在 setAgentResults 前存旧值
  const lastActionRef = useRef<string | null>(null);
  const runAgent = async (auto = false) => {
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
            marketFactor: decisionSources.find(s => s.name === "市场状态")?.confidence ? 0.6 : 0.5,
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
          const r = await fetch(`/api/db/kv?key=${encodeURIComponent(key)}`);
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
    const out: Array<{ date: string; sentiment: number | null; blastedRate: number | null; ztCount: number | null; maxBoardHeight: number | null; premiumAvg: number | null; promotionRate: number | null; sealDecayCount: number | null; lhbBoostCount: number | null; fundInflowStreak: number | null; nuclearCount: number | null }> = [];
    const d = new Date();
    for (let i = 13; i >= 0; i--) {
      const t = new Date(d); t.setDate(t.getDate() - i);
      if (!isTradingDay(t)) continue; // 周末/节假日跳过（北京时间）
      const ds = bjDateStr(t);
      const row: any = { date: ds, sentiment: null, blastedRate: null, ztCount: null, maxBoardHeight: null, premiumAvg: null, promotionRate: null, sealDecayCount: null, lhbBoostCount: null, fundInflowStreak: null, nuclearCount: null };
      try {
        const sv = await kvGet(`sentiment:${ds}`);
        const num = Number(sv ?? NaN);
        if (Number.isFinite(num)) row.sentiment = num;
      } catch { /* 静默 */ }
      try {
        // v14-9（P2）：market_daily 用精确接口替代 as any
        const md = await kvGet(`market_daily:${ds}`) as MarketDailyLite | null;
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
        const nxt = new Date(t); nxt.setDate(nxt.getDate() + 1);
        const nxtMd = await kvGet(`market_daily:${bjDateStr(nxt)}`) as MarketDailyLite | null;
        if (nxtMd) {
          row.nextZtCount = nxtMd.ztCount ?? null;
          row.nextHeight = nxtMd.maxBoardHeight ?? null;
        }
      } catch { /* 静默 */ }
      out.push(row);
    }
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

      {/* ============== 共用顶部决策区（v9.46：全阶段可见，决策靠前） ============== */}
      {/* 驾驶舱 + 今日作战卡 + Agent 重审 + Top 摘要 —— 任何阶段（盘前/盘中/盘后/午休）都置顶 */}
      <div className="space-y-2">
        {/* v9.23-3：游资五问条（驾驶舱顶部常驻） */}
        <FiveQBar battlePlan={battlePlan ?? null} overview={overview} fund={fund ?? null} />
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
        {/* v11-5（P1）：事件三级研判移回驾驶舱（决策区下方，裁决→选股→事件一气呵成） */}
        {/* v13-4/6（P0）：管线视图 + 展开/可点击（新闻/个股/ETF 东财外链） */}
        <EventClassifyPanel onOpenNews={() => onSwitchTab?.("news")} />
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
          {/* 相位强调点：盘前/竞价台（仅 pre/auction 出现） */}
          {isPre && (
            <>
              {/* v9.19-F2：竞价台（盘前/竞价场景核心） */}
              {leaderPredict && leaderPredict.predictLeader && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                  <div className="text-xs font-bold text-amber-200">
                    🤖 AI 预判龙一：<span className="text-base">{leaderPredict.predictLeader.name}</span>
                    <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-xs font-black text-amber-300">置信 {leaderPredict.confidence}%</span>
                  </div>
                  {leaderPredict.reason && <div className="mt-1 text-[11px] text-slate-300">理由：{leaderPredict.reason}</div>}
                  {leaderPredict.watch && <div className="text-[11px] text-rose-300/80">⚠ 盯防：{leaderPredict.watch}</div>}
                </div>
              )}
              <AuctionBoard yesterdayZt={yesterdayZt} todayZt={ztPool} autoRefresh={false} />
              {/* v9.36（A2）：竞价强度榜（昨日涨停池竞价涨幅 top12） */}
              <AuctionStrengthPanel yesterdayZt={yesterdayZt} todayZt={ztPool} />
            </>
          )}
          {/* v9.48 D4：核心温度条提到决策区下方（盘中核心进阶指标，D2 已去 EmotionCycle 冗余） */}
          <LimitTempBar overview={overview} />
          {/* v10-4（P1）：作战卡内嵌 AI 裁决徽章（每条主线显示 LLM 结论） */}
          <BattlePlan data={battlePlan ?? null} agentResults={agentResults} />
          {/* v10-3：StockPickList 已上移至裁决区（见上），此处不再重复渲染 */}
          <AnomalyStrip stocks={watchStocks} mainlines={mainlines} />
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

      {/* ============== 复盘工具（v9.46：移到全 Dashboard 末尾 —— "现在进行"在前，"复盘"在后） ============== */}
      {/* 全天可见按钮（默认折叠，状态持久化到 localStorage）：AI复盘/信号/回测/因子健康/决策审计/净值 */}
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
            </div>
          )}
          {/* v9.75（阶段二）：次日闸门预测（LLM 结合隔夜外围/政策预判） */}
          {nextGatePredict && nextGatePredict.nextGate && (
            <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs">
              <span className="font-bold text-slate-200">🚦 次日闸门预测：</span>
              <span className={nextGatePredict.nextGate.includes("全开") ? "text-emerald-300" : nextGatePredict.nextGate.includes("低") || nextGatePredict.nextGate.includes("谨慎") ? "text-amber-300" : "text-slate-300"}>{nextGatePredict.nextGate}</span>
              {nextGatePredict.reason && <span className="text-slate-400">（{nextGatePredict.reason}）</span>}
              {nextGatePredict.watchPoints.length > 0 && (
                <div className="mt-1 text-[11px] text-slate-400">👀 观察：{nextGatePredict.watchPoints.join("；")}</div>
              )}
            </div>
          )}
          {nextScenarios && nextScenarios.length > 0 && (
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-[11px] font-bold text-slate-200 mb-2">🎬 明日三剧本（LLM 盘后推演）</div>
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
        </div>
      )}
      {showSignalEffect && <SignalEffectivenessPanel />}
      {/* v9.42：因子健康度（server cron 15:40 落库 factor_ic:日期） */}
      {showFactorHealth && <FactorHealthPanel />}
      {/* v9.65（V2-P2）：运维可观测面板（数据源/AI配额/队列/因子） */}
      <OpsPanel />
      {/* v9.44（②）：决策审计时间线（decision_log） */}
      {showAudit && <DecisionAuditPanel />}
      {/* v9.44（④）：信号净值曲线（signalLedger 等权复利） */}
      {showEquity && <SignalEquityPanel />}
      {showSignal && <SignalPanel />}
    </div>
  );
}
