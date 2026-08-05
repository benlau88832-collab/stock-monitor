import { useState, useEffect, useMemo } from "react";
import MarketOverview from "./MarketOverview";
import EmotionCycleCard from "./EmotionCycleCard";
import DisciplinePanel from "./DisciplinePanel";
import ReviewPanel from "./ReviewPanel";
import AuctionBoard from "./AuctionBoard";
import FiveQBar from "./FiveQBar";
import DailySummary from "./DailySummary";
import SignalPanel from "./SignalPanel";
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
import GlobalSignals from "./GlobalSignals";
import { fmtMoney, fmtPct, pctColor, localDateStrOffset } from "../lib/format";
import { loadIntradaySeries, computeMomentum, suggestPosition } from "../lib/sentimentStore";
import { buildThemeLadder, type ZTPoolItem } from "../lib/themeLadder";
import { getFeed, type AlertEvent } from "../lib/alertBus";
import { getAllSince } from "../lib/dataStore";
import { matchStocksToMainline, summarizeMatches } from "../lib/positionMatch";
import type { OverviewData, FundStructureData, GlobalData, MainlineData } from "../App";
import type { SessionPhase } from "../lib/tradingSession";
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
        <div className="flex gap-1.5 text-[10px]">
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
          <span key={m.code} className={`rounded-lg border px-2 py-1 text-[10px] ${statusColor(m.status)}`} title={m.hint}>
            <span className="text-slate-200 font-semibold">{m.name}</span>
            <span className="ml-1 text-slate-500">{m.code}</span>
            <span className={`ml-1 rounded px-1 py-0.5 text-[9px] font-bold ${badge(m.status)}`}>{label(m.status)}</span>
            {m.matchedBoard && <span className="ml-1 text-slate-400">{m.matchedBoard.name}({m.matchedBoard.pct >= 0 ? "+" : ""}{m.matchedBoard.pct.toFixed(2)}%)</span>}
            {m.matchFrom === "concept" && <span className="ml-1 text-amber-400/80 text-[9px]">概念</span>}
          </span>
        ))}
      </div>
      <div className="text-[10px] text-slate-600">顺风=主线行业/概念共振 / 🔥异动=涨幅 ≥5% 但偏离主线（历史统计追高风险高）/ 逆风=主线退潮 / 孤立=与今日主线无关</div>
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
用不超过40字解释该异动可能的含义，并给一句行动建议。格式：归因（40字内）｜建议：动作`;
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
        <span className="flex items-center gap-1 text-[10px]">
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
                <span className={`rounded px-1 text-[10px] font-black ${meta.badge}`}>{meta.label}</span>
                <span className="font-bold text-slate-200">{stock.name}</span>
                <span className={`font-semibold ${pctColor(stock.pct)}`}>{fmtPct(stock.pct)}</span>
              </div>
              <div className="text-[10px] text-slate-500 leading-tight mt-0.5">
                {verdict.reason}
                {verdict.mainlineHit && <span className="ml-1 text-amber-300">⚡呼应主线</span>}
              </div>
              <div className="text-[10px] text-slate-400 leading-tight">
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
        <div className="mt-1 border-t border-white/5 pt-1 text-[10px] space-y-1">
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
      <div className="flex justify-between text-[9px] text-slate-600">
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
          <div className={`text-[10px] font-bold ${s >= 80 ? "text-rose-300" : "text-sky-300"}`}>
            {s >= 80 ? "⚡ 控仓兑现（反向信号）" : "🔵 超跌机会（反向窗口）"}
          </div>
          <div className="text-[9px] text-slate-300 mt-0.5 leading-snug">
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
        <div className="text-[10px] text-slate-500">建议总仓位</div>
        <div className={`text-2xl font-black ${posColor}`}>{advice.positionPct}%</div>
        <div className="text-[10px] text-slate-400">{advice.label}</div>
        <div className="text-[9px] text-slate-600 mt-0.5">{advice.hint}</div>
      </div>
      {/* P2：日内轨迹折线 */}
      <SentimentSparkline pts={intraday} />
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
  /** v9.24-P1-4：今日主线名（异动分级"呼应主线"判断用） */
  mainlines?: string[];
  onSwitchTab?: (tab: string) => void;
  /** v9.19-F2：今日涨停池（竞价台用） */
  ztPool?: Array<{ c: string; n: string; fbt: number; lbc: number }>;
  /** v9.19-F2：昨日涨停股（竞价台用） */
  yesterdayZt?: Array<{ code: string; name: string }>;
}

export default function Dashboard({
  overview, fund, globalData, mainline, battlePlan, loading,
  phase: phaseProp = "post", watchStocks = [], mainlines = [], onSwitchTab, ztPool, yesterdayZt,
}: DashboardProps) {
  // v9.19-fix：默认值字面量导致类型收窄，显式拓宽回联合类型
  const phase: SessionPhase = phaseProp;
  // 修复：原代码只在组件首次挂载时算一次 phase，phase 改变时不会重新打开 AI 复盘
  const [showAI, setShowAI] = useState(phase === "post");
  const [showSignal, setShowSignal] = useState(false);
  useEffect(() => {
    // 当 phase 变到 post 时自动打开 AI 复盘（盘后场景）
    if (phase === "post") setShowAI(true);
  }, [phase]);

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
            {/* v9.23-3：游资五问条（驾驶舱顶部常驻） */}
            <FiveQBar battlePlan={battlePlan ?? null} />
            <BattlePlan data={battlePlan ?? null} />
            {/* v9.18-F5：情绪周期雷达（温度计 2.0） */}
            {overview && (
              <EmotionCycleCard input={{
                sentiment: overview.sentiment,
                ztCount: overview.limitPool?.limitUpCount ?? 0,
                ztCountYesterday: null, // 昨日涨停数暂未在 overview 中回传（可扩展）
                maxBoardHeight: overview.limitPool?.boardCounts ? Math.max(0, ...Object.keys(overview.limitPool.boardCounts).map(Number)) : null,
                maxBoardYesterday: null,
                blastedRate: overview.limitPool?.blastedRate ?? null,
                blastedRatePrev: null,
                premiumAvg: overview.premiumAvg ?? null,
                promotionRate: overview.promotionRate ?? null,
              }} />
            )}
            <AnomalyStrip stocks={watchStocks} mainlines={mainlines} />
            <PositionMatchStrip stocks={watchStocks} boards={mainline?.boards} />
            <LimitTempBar overview={overview} />
            <MarketOverview data={overview} loading={loading} />
            <PopularityRadar />
          </div>
          {/* 右 1/3 */}
          <div className="space-y-2">
            {/* v9.19-F7：仓位与纪律面板 */}
            <DisciplinePanel />
            {/* v9.19-F10：每日复盘 */}
            <ReviewPanel />
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
            {/* v9.19-F2：竞价台（盘前/竞价场景核心） */}
            <AuctionBoard yesterdayZt={yesterdayZt} todayZt={ztPool} autoRefresh={false} />
            <Playbook sentiment={overview?.sentiment} limitUpCount={overview?.limitPool?.limitUpCount}
              blastedRate={overview?.limitPool?.blastedRate} overview={overview} globalData={globalData} mainline={mainline} />
            {globalData && <GlobalSignals data={globalData} loading={loading} />}
            <BattlePlan data={battlePlan ?? null} />
            {/* v9.19-F7/F10：纪律+复盘（全天可用） */}
            <DisciplinePanel />
            <ReviewPanel />
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
              <AnomalyStrip stocks={watchStocks} mainlines={mainlines} />
              <PositionMatchStrip stocks={watchStocks} boards={mainline?.boards} />
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
