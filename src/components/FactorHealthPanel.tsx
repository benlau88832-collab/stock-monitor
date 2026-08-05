// ============================================================
// v9.42：因子健康度面板 —— 幻方"哪些因子在失效"可视化
// 数据源：PG kv_store:factor_ic:日期（server cron 15:40 自动落库，永不缺数据）
// 每因子一条滚动窗口 IC 曲线（|IC| 持续 <0.05 → 因子失效，降权 0.3）
// 汇总与决策联动：失效占比 ≥50% → decisionBus 置信 -15%（与 V4-B 门控一致）
// ============================================================
import { useState, useEffect, useMemo } from "react";
import { isLocalServer } from "../lib/cloudStore";
import { FACTORS, markNextWin, evaluateFactorIcSeries, resolveAutoStates, type FactorIcPoint, type FactorDayRow } from "../lib/factorLib";
import { loadFactorIcHistory, type FactorIcHistory } from "../lib/factorHistory";
import DisclaimerTag from "./DisclaimerTag";

const IC_Y_MAX = 0.15; // 纵轴固定 ±0.15（IC 常见范围）

// ---------- SVG 迷你曲线（无外部图表库） ----------
function IcSpark({ points, factorName, overrideIc }: { points: FactorIcPoint[]; factorName: string; overrideIc?: number | null }) {
  const W = 260, H = 58, PAD = 5;
  const innerW = W - PAD * 2, innerH = H - PAD * 2;
  if (points.length < 2) {
    return <div className="text-[10px] text-slate-600">样本不足，随每日落库自动积累</div>;
  }
  const yOf = (ic: number) => PAD + (IC_Y_MAX - Math.max(-IC_Y_MAX, Math.min(IC_Y_MAX, ic))) / (2 * IC_Y_MAX) * innerH;
  const xOf = (i: number) => PAD + i / (points.length - 1) * innerW;
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)},${yOf(p.ic).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  const lastX = xOf(points.length - 1);
  const dotColor = last.decayed ? "#fb7185" : last.reversed ? "#fbbf24" : "#34d399";
  // v9.44（③）：已反向因子 → 当前点标签/圆点按新方向 IC 显示
  const dispIc = overrideIc != null ? overrideIc : last.ic;
  const dispColor = overrideIc != null
    ? (overrideIc >= 0.05 ? "#22d3ee" : "#fb7185") // 反向后的方向：正=已恢复有效
    : dotColor;
  return (
    <svg width={W} height={H} className="shrink-0">
      {/* ±0.05 失效阈值带 */}
      <rect x={PAD} y={yOf(0.05)} width={innerW} height={yOf(-0.05) - yOf(0.05)} fill="rgba(148,163,184,0.08)" />
      {/* 0 线 + 阈值虚线 */}
      <line x1={PAD} x2={W - PAD} y1={yOf(0)} y2={yOf(0)} stroke="rgba(148,163,184,0.35)" strokeWidth="1" />
      <line x1={PAD} x2={W - PAD} y1={yOf(0.05)} y2={yOf(0.05)} stroke="rgba(251,113,133,0.35)" strokeWidth="0.8" strokeDasharray="3,3" />
      <line x1={PAD} x2={W - PAD} y1={yOf(-0.05)} y2={yOf(-0.05)} stroke="rgba(251,113,133,0.35)" strokeWidth="0.8" strokeDasharray="3,3" />
      {/* IC 曲线（clamp 到 ±0.15） */}
      <path d={line} fill="none" stroke="rgba(148,163,184,0.75)" strokeWidth="1.4" />
      {/* 失效点红色 / 反转点琥珀色高亮 */}
      {points.map((p, i) => (p.decayed || p.reversed) && (
        <circle key={i} cx={xOf(i)} cy={yOf(p.ic)} r="2" fill={p.decayed ? "rgba(251,113,133,0.9)" : "rgba(251,191,36,0.9)"}>
          <title>{`${factorName} ${p.date}\nIC=${p.ic} 样本=${p.samples}${p.decayed ? " 失效" : p.reversed ? " 方向反转" : ""}`}</title>
        </circle>
      ))}
      {/* 当前点大圆 */}
      <circle cx={lastX} cy={yOf(overrideIc != null ? overrideIc : last.ic)} r="3.5" fill={dispColor} stroke="#0f172a" strokeWidth="1.2">
        <title>{`${factorName} ${last.date}\nIC=${last.ic} 样本=${last.samples}${last.decayed ? " 疑似失效" : last.reversed ? " 方向反转" : " 健康"}${overrideIc != null ? `\n自动反向后 IC=${overrideIc}` : ""}`}</title>
      </circle>
      {/* 右缘当前 IC 标签 */}
      <text x={W - PAD - 2} y={yOf(dispIc) - 4} textAnchor="end" fontSize="8.5" fill={dispColor} fontWeight="bold">
        {dispIc >= 0 ? "+" : ""}{dispIc.toFixed(2)}
      </text>
    </svg>
  );
}

export default function FactorHealthPanel() {
  const [history, setHistory] = useState<FactorIcHistory | null>(null);
  const [fallbackRows, setFallbackRows] = useState<FactorDayRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!isLocalServer()) {
        if (alive) { setError("本地部署（localhost:8080）才可读取 PG 历史数据"); setLoading(false); }
        return;
      }
      try {
        // 1. 主数据源：server cron 落库的 factor_ic:日期 快照序列
        const hist = await loadFactorIcHistory(30);
        if (alive) setHistory(hist);
        // 2. 若历史快照太少（<2 个日期），降级用 market_daily+sentiment 前端现算
        if (!hist || hist.dates.length < 2) {
          const { loadFactorRows: lfr } = await import("../lib/factorHistory");
          const rows = await lfr(30);
          if (alive && rows.length >= 4) setFallbackRows(rows);
        }
      } catch {
        if (alive) setError("历史数据读取失败");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // 统一成 factorId → IcPoint[]（快照模式按 name 匹配注册表）
  const seriesMap = useMemo(() => {
    if (history && history.dates.length >= 2) {
      const m: Record<string, FactorIcPoint[]> = {};
      for (const f of FACTORS) {
        const pts = history.byFactor[f.name];
        if (pts && pts.length >= 1) m[f.id] = pts.map(p => ({ date: p.date, ic: p.ic, samples: p.samples, decayed: p.decayed, reversed: (p as any).reversed }));
      }
      return m;
    }
    if (fallbackRows) return evaluateFactorIcSeries(markNextWin(fallbackRows), 10);
    return {};
  }, [history, fallbackRows]);

  const stats = useMemo(() => {
    const ids = Object.keys(seriesMap);
    if (ids.length === 0) return null;
    const cur = (id: string) => seriesMap[id][seriesMap[id].length - 1];
    const decayed = ids.filter(id => cur(id)?.decayed).length;
    const reversed = ids.filter(id => !cur(id)?.decayed && cur(id)?.reversed).length;
    const avgAbsIc = ids.reduce((s, id) => {
      const pts = seriesMap[id];
      return s + (pts.length ? Math.abs(pts[pts.length - 1].ic) : 0);
    }, 0) / ids.length;
    const healthScore = Math.round((1 - (decayed + reversed) / ids.length) * 100);
    return { total: ids.length, decayed, reversed, avgAbsIc, healthScore };
  }, [seriesMap]);

  // v9.44（③）：自动处置判定 —— 连续反转≥3日自动反向 / 连续真失效≥5日退役
  const autoStates = useMemo(() => resolveAutoStates(seriesMap, { flipDays: 3, retireDays: 5 }), [seriesMap]);
  const autoMap = useMemo(() => new Map(autoStates.map(a => [a.factorId, a])), [autoStates]);
  const flippedCount = autoStates.filter(a => a.flipped).length;
  const retiredCount = autoStates.filter(a => a.retired).length;
  const autoNote = [
    flippedCount > 0 ? `${flippedCount} 因子已自动反向` : "",
    retiredCount > 0 ? `${retiredCount} 因子已退役` : "",
  ].filter(Boolean).join(" · ");

  if (loading) {
    return <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-xs text-slate-500">因子健康度加载中…</div>;
  }
  if (error) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-300">
        {error}
        <div className="mt-1 text-[10px] text-amber-300/70">数据源：PG kv_store:factor_ic:日期（server cron 15:40 自动落库）</div>
      </div>
    );
  }
  if (!stats) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-xs text-slate-500">
        暂无足够数据（至少需要 2 个有因子快照的交易日）。server cron 每日 15:40 自动落库 factor_ic，次日即有曲线。
      </div>
    );
  }

  const rowColor = stats.decayed >= Math.ceil(stats.total * 0.5)
    ? "text-rose-300 border-rose-500/30 bg-rose-500/10"
    : stats.decayed >= Math.ceil(stats.total * 0.3)
      ? "text-amber-300 border-amber-500/30 bg-amber-500/10"
      : "text-emerald-300 border-emerald-500/30 bg-emerald-500/10";

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-bold text-slate-100">
          🧪 因子健康度 <span className="ml-1 text-[10px] text-slate-500 font-normal">幻方"因子会失效"监测 · 滚动窗口 IC 曲线</span>
        </div>
        <DisclaimerTag />
      </div>

      {/* 汇总条 */}
      <div className={`rounded-lg border px-3 py-2 ${rowColor.split(" ").slice(1).join(" ")}`}>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
          <span>失效因子 <b className="font-black">{stats.decayed}</b> / {stats.total}</span>
          {stats.reversed > 0 && <span>方向反转 <b className="font-black text-amber-300">{stats.reversed}</b></span>}
          {flippedCount > 0 && <span>已自动反向 <b className="font-black text-cyan-300">{flippedCount}</b></span>}
          {retiredCount > 0 && <span>已退役 <b className="font-black text-slate-400">{retiredCount}</b></span>}
          <span>平均 |IC| <b className="font-mono">{stats.avgAbsIc.toFixed(3)}</b></span>
          <span>健康分 <b className="font-black">{stats.healthScore}</b> / 100</span>
          {stats.decayed >= Math.ceil(stats.total * 0.5) && (
            <span className="text-[10px] text-rose-300/90">⚠ 失效占比≥50% → 决策置信自动 -15%（门控生效）</span>
          )}
          {stats.decayed >= Math.ceil(stats.total * 0.3) && stats.decayed < Math.ceil(stats.total * 0.5) && (
            <span className="text-[10px] text-amber-300/90">⚠ 失效占比≥30% → 决策置信自动 -8%</span>
          )}
          <span className="text-[10px] text-slate-500">数据：{history?.latest?.date ?? "实时计算"}</span>
        </div>
      </div>

      <div className="text-[11px] text-slate-500">
        每条曲线 = 该因子最近 10 个交易日的滚动 IC（秩相关，正=与期望方向一致）。灰带为 |IC|&lt;0.05 失效区：曲线持续落入灰带 → 因子疑似失效，权重自动降为 0.3（幻方核心：因子会过期）。
      </div>

      {/* 因子曲线列表 */}
      <div className="space-y-1.5">
        {FACTORS.map(f => {
          const pts = seriesMap[f.id];
          if (!pts || pts.length === 0) return null;
          const cur = pts[pts.length - 1];
          // v9.44（③）：自动处置状态优先于原始状态（退役 > 已反向 > 失效 > 反转 > 健康）
          const auto = autoMap.get(f.id);
          const retired = Boolean(auto?.retired);
          const flipped = Boolean(auto?.flipped);
          const showIc = flipped ? (auto?.effIc ?? cur.ic) : cur.ic;
          return (
            <div key={f.id} className={`flex items-center gap-3 rounded-lg border px-2.5 py-1.5 ${
              retired ? "border-slate-600/40 bg-slate-800/20 opacity-70"
              : flipped ? "border-cyan-500/25 bg-cyan-500/5"
              : cur.decayed ? "border-rose-500/25 bg-rose-500/5"
              : cur.reversed ? "border-amber-500/25 bg-amber-500/5"
              : "border-white/5 bg-white/[0.03]"
            }`}>
              <div className="w-36 shrink-0">
                <div className="text-xs font-semibold text-slate-200">{f.name}</div>
                <div className="mt-0.5 flex items-center gap-1">
                  <span className={`rounded px-1 py-px text-[9px] font-bold ${
                    retired ? "bg-slate-500/30 text-slate-300"
                    : flipped ? "bg-cyan-500/20 text-cyan-300"
                    : cur.decayed ? "bg-rose-500/20 text-rose-300"
                    : cur.reversed ? "bg-amber-500/20 text-amber-300"
                    : "bg-emerald-500/20 text-emerald-300"
                  }`}>
                    {retired ? "⛔ 退役" : flipped ? "↻ 已反向" : cur.decayed ? "⚠ 失效" : cur.reversed ? "↻ 反转" : "健康"}
                  </span>
                  <span className="text-[9px] text-slate-500">样本{cur.samples}</span>
                </div>
              </div>
              <div className="min-w-0 flex-1"><IcSpark points={pts} factorName={f.name} overrideIc={flipped ? showIc : null} /></div>
            </div>
          );
        })}
      </div>

      <div className="text-[10px] text-slate-600">
        <span className="text-slate-400">💡 失效因子已自动降权（weight 0.3）；连续反转≥3日自动反向使用（IC 按新方向显示）、连续真失效≥5日自动退役（不参与决策），均已在 AI 调研中体现</span>
        {autoNote && <span className="text-cyan-400/80">　{autoNote}</span>}
        <span>　·　{history && history.dates.length >= 2
          ? `历史快照 ${history.dates.length} 天（server cron 每日 15:40 落库，不依赖开页面）`
          : "历史快照不足，当前为实时计算（market_daily + sentiment），cron 落库后自动切换"}</span>
      </div>
    </div>
  );
}
