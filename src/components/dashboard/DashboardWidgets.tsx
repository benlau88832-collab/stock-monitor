// ============================================================
// src/components/dashboard/DashboardWidgets.tsx —— 驾驶舱展示型组件（v9.138.0 阶段二：#14）
// 背景：Dashboard.tsx 原 1300+ 行（容器状态 + 9 个内联展示组件 + 渲染），按报告三层架构
// "页面容器 + 领域组件 + 数据 hook" 拆出领域组件层 —— 本文件为纯展示/自管理组件，
// 不消费 useMarketData，仅经 props 接收数据；Dashboard.tsx 保留容器状态与布局。
// 类型契约一律从 ../../lib/marketTypes 导入（#17 单源化），禁止引 "../App"。
// ============================================================
import { useState, useEffect, useMemo, useRef, memo } from "react";
import { fmtMoney, fmtPct, pctColor, localDateStrOffset } from "../../lib/format";
import { matchStocksToMainline, summarizeMatches } from "../../lib/positionMatch";
import { loadIntradaySeries, computeMomentum, suggestPosition } from "../../lib/sentimentStore";
import { buildThemeLadder, type ZTPoolItem } from "../../lib/themeLadder";
import { getFeed, type AlertEvent } from "../../lib/alertBus";
import { getAllSince } from "../../lib/dataStore";
import {
  classifyAnomaly, emitAnomaly, subscribeAnomaly, getAnomalies, updateAnomaly, type AnomalyEvent,
} from "../../lib/anomalyTier";
import type { GateResult } from "../../lib/regimeGate";
import type { OverviewData, MainlineData } from "../../lib/marketTypes";

// v9.26.11：建议动作颜色（轻仓/重仓参与=积极红；观察=黄；禁止/无需=灰）
export function actionColor(action: string): string {
  if (action.includes("重仓参与")) return "text-rose-300 font-bold";
  if (action.includes("轻仓参与")) return "text-amber-300 font-semibold";
  if (action.includes("观察")) return "text-sky-300";
  return "text-slate-500";
}

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
export function IndexStripImpl({ overview }: { overview: OverviewData | null }) {
  if (!overview) return null;
  const { indices, turnoverAmount, turnoverAvg5d } = overview;
  // v9.100.0（P1-07）：均量缺失/垃圾值（push2 断源时 avg5d 或 amount 异常）→ 不显示荒谬百分比（审查实测"vs均量-100%/0%"）
  const volRatio = turnoverAmount > 0 && turnoverAvg5d && turnoverAvg5d > 0
    ? (() => { const r = turnoverAmount / turnoverAvg5d; return r >= 0.05 && r <= 20 ? r : null; })()
    : null;
  return (
    <div className="flex items-center gap-3 rounded-lg bg-black/30 px-3 py-1 overflow-x-auto text-[11px]">
      {indices.slice(0, 4).map(idx => (
        <span key={idx.code} className="whitespace-nowrap">
          <span className="text-slate-500">{idx.name} </span>
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
// v9.81（性能）：18s 快刷只更新 limitPool → 指数条（不消费涨停池）字段级 memo，跳过无谓重渲染
export const IndexStrip = memo(IndexStripImpl, (prev, next) =>
  prev.overview?.indices === next.overview?.indices &&
  prev.overview?.turnoverAmount === next.overview?.turnoverAmount &&
  prev.overview?.turnoverAvg5d === next.overview?.turnoverAvg5d,
);

// ============== 涨停温度计横条 ==============
// 核心进阶温度条（v9.48 G1：涨停/跌停/炸板率已在 StatusBar 全局常驻，此处只留进阶指标：
// 晋级率/溢价/最高板 —— 不再三处重复同一组数）
export function LimitTempBar({ overview }: { overview: OverviewData | null }) {
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
export function PositionMatchStrip({ stocks, boards }: {
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

export function AnomalyStrip({ stocks, mainlines = [], ztPool = [] }: { stocks: WatchStockBrief[]; mainlines?: string[]; ztPool?: Array<{ c?: string; n?: string; p?: number; zdp?: number; fund?: number; amount?: number; zbc?: number }> }) {
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
  // v9.81（性能）：useMemo —— 原每次渲染对每只自选股重跑 classifyAnomaly
  // v9.137.0（审查 P2-08 修复）：注入涨停池真实封单/炸板数据 —— 原调用只传 6 字段，
  //   detectTrap 所需 sealFund/amount/blastCount 全走缺省 0 → "近涨停+假封板"诱多分支
  //   （anomalyTier.ts:120-127）生产恒不可达；现命中涨停池的自选股带上 fund/amount/zbc 真实值
  const verdicts = useMemo(() => {
    if (stocks.length === 0) return [];
    const poolByCode = new Map<string, { sealFund?: number; amount?: number; blastCount?: number }>();
    for (const s of ztPool) {
      const code = String(s.c ?? "");
      if (!code) continue;
      poolByCode.set(code, {
        sealFund: typeof s.fund === "number" ? s.fund : undefined,
        amount: typeof s.amount === "number" ? s.amount : undefined,
        blastCount: typeof s.zbc === "number" ? s.zbc : undefined,
      });
    }
    return stocks.map(s => {
      const poolRow = poolByCode.get(s.code);
      return {
        stock: s,
        verdict: classifyAnomaly({
          code: s.code, name: s.name, pct: s.pct,
          volumeRatio: s.volumeRatio ?? null,
          turnoverRate: s.turnoverRate,
          limitPct: s.limitPct ?? 10,
          ...(poolRow ? { sealFund: poolRow.sealFund, amount: poolRow.amount, blastCount: poolRow.blastCount } : {}),
        }, mainlines),
      };
    }).filter((x): x is { stock: WatchStockBrief; verdict: NonNullable<ReturnType<typeof classifyAnomaly>> } => x.verdict != null);
  }, [stocks, mainlines, ztPool]);

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
          const { callAI } = await import("../../lib/ai");
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
function GateGaugeImpl({ overview, gate }: { overview: OverviewData | null; gate: GateResult | null }) {
  // v9.81（性能）：useMemo —— 原每次渲染都从 localStorage 读日内序列并重算动量/仓位建议
  const { momentum, delta, advice, intraday } = useMemo(() => {
    const intraday = loadIntradaySeries();
    const m = computeMomentum(intraday);
    return { momentum: m.momentum, delta: m.delta, advice: suggestPosition(overview?.sentiment ?? null, m.momentum, gate?.factor ?? null), intraday };
  }, [overview?.sentiment, gate?.factor]);
  if (!overview) return null;
  const s = overview.sentiment;
  // 修复：s 可能是 null（类型收窄），color 用兜底值
  const color = s == null ? "#8b5cf6" : s >= 80 ? "#ef4444" : s >= 65 ? "#f59e0b" : s >= 45 ? "#eab308" : s >= 25 ? "#3b82f6" : "#8b5cf6";
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
// v9.81（性能）：18s 快刷只更新 limitPool → 闸门卡（只看情绪+闸门因子）字段级 memo 跳过无谓重渲染
export const GateGauge = memo(GateGaugeImpl, (prev, next) =>
  prev.overview?.sentiment === next.overview?.sentiment &&
  prev.gate?.factor === next.gate?.factor,
);

// ============== 重要信息摘录（真实新闻+公告） ==============
export function ImportantFeed() {
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
export function AlertFeed() {
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
export function LadderMini({ overview, onSwitchTab }: { overview: OverviewData | null; onSwitchTab?: () => void }) {
  // v9.81（性能）：useMemo —— 原每次渲染对 ~500 条池子重跑分组建梯队
  const groups = useMemo(
    () => (overview?.limitPool?.rawZTPool ? buildThemeLadder(overview.limitPool.rawZTPool as ZTPoolItem[]) : []),
    [overview?.limitPool?.rawZTPool],
  );
  if (!overview?.limitPool?.rawZTPool) return null;
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
