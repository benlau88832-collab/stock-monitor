// ============================================================
// P3-1：长期胜率仪表盘 —— 按月/按主线/按 AI 路径分组
// 数据：decision_post（人类拍板，含真实回填 pnl/pnl_t20/pnl_t60）+ decision_log（AI 来源）
// 展示：月度胜率折线 / 主线平均 PnL 排行 / AI vs 规则对比
// 支持 T+5 / T+20 / T+60 周期切换；服务端回填经 DecisionAuditPanel 传入合并
// ============================================================
import { useEffect, useMemo, useState } from "react";
import { loadRecentPosts, type DecisionPost } from "../lib/decisionPost";
import { loadDecisionLogs } from "../lib/decisionAttribution";
import DisclaimerTag from "./DisclaimerTag";

interface MonthlyStat { month: string; total: number; winRate: number | null; avgPnl: number | null; }
interface MainlineStat { mainline: string; total: number; avgPnl: number | null; winRate: number | null; }

type Horizon = "T+5" | "T+20" | "T+60";

const HORIZONS: Horizon[] = ["T+5", "T+20", "T+60"];

export default function LongTermStatsPanel({ serverDecisions = [] }: { serverDecisions?: Array<Record<string, any>> }) {
  const [posts, setPosts] = useState<DecisionPost[]>([]);
  const [logs, setLogs] = useState<ReturnType<typeof loadDecisionLogs>>([]);
  const [horizon, setHorizon] = useState<Horizon>("T+5");

  useEffect(() => {
    const local = loadRecentPosts(180); // 近 180 天拍板
    const map = new Map(serverDecisions.map((d) => [d.ticketId, d]));
    setPosts(local.map((p) => map.has(p.ticketId) ? { ...p, ...map.get(p.ticketId) } : p));
    setLogs(loadDecisionLogs(180)); // 近 180 天 AI 裁决
  }, [serverDecisions]);

  const pnlOf = (p: DecisionPost, h: Horizon): number | null => {
    if (h === "T+20") return p.pnlT20 ?? null;
    if (h === "T+60") return p.pnlT60 ?? null;
    return p.pnl ?? null;
  };

  // 仅统计已回填的 confirm 拍板（有当前周期真实 pnl）
  const confirmed = useMemo(() => posts.filter(p => p.humanAction === "confirm" && pnlOf(p, horizon) != null), [posts, horizon]);

  // 按月聚合
  const monthly: MonthlyStat[] = useMemo(() => {
    const map = new Map<string, { total: number; wins: number; pnlSum: number }>();
    for (const p of confirmed) {
      const v = pnlOf(p, horizon) ?? 0;
      const m = p.date.slice(0, 7);
      const rec = map.get(m) ?? { total: 0, wins: 0, pnlSum: 0 };
      rec.total++; rec.pnlSum += v; if (v > 0) rec.wins++;
      map.set(m, rec);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, r]) => ({
        month,
        total: r.total,
        winRate: Math.round(r.wins / r.total * 100),
        avgPnl: Math.round(r.pnlSum / r.total * 10) / 10,
      }));
  }, [confirmed, horizon]);

  // 按主线聚合
  const mainlineStats: MainlineStat[] = useMemo(() => {
    const map = new Map<string, { total: number; wins: number; pnlSum: number }>();
    for (const p of confirmed) {
      const v = pnlOf(p, horizon) ?? 0;
      const ml = p.mainline ?? p.code ?? "未知";
      const rec = map.get(ml) ?? { total: 0, wins: 0, pnlSum: 0 };
      rec.total++; rec.pnlSum += v; if (v > 0) rec.wins++;
      map.set(ml, rec);
    }
    return [...map.entries()]
      .map(([mainline, r]) => ({
        mainline,
        total: r.total,
        winRate: Math.round(r.wins / r.total * 100),
        avgPnl: Math.round(r.pnlSum / r.total * 10) / 10,
      }))
      .filter(x => x.total >= 2) // 样本 ≥2 才展示
      .sort((a, b) => (b.avgPnl ?? 0) - (a.avgPnl ?? 0))
      .slice(0, 10);
  }, [confirmed, horizon]);

  // AI vs 规则对比（基于 decision_log 来源 + 拍板配对）
  const aiLogs = logs.filter(l => l.source === "AI-Agent");
  const aiPosts = confirmed.filter(p => p.decisionLogRef && aiLogs.some(l => l.ts === p.decisionLogRef));
  const rulePosts = confirmed.filter(p => !p.decisionLogRef || !aiLogs.some(l => l.ts === p.decisionLogRef));
  const calc = (arr: DecisionPost[]) => {
    if (arr.length === 0) return { n: 0, avgPnl: null as number | null, winRate: null as number | null };
    const sum = arr.reduce((s, p) => s + (pnlOf(p, horizon) ?? 0), 0);
    const wins = arr.filter(p => (pnlOf(p, horizon) ?? 0) > 0).length;
    return { n: arr.length, avgPnl: Math.round(sum / arr.length * 10) / 10, winRate: Math.round(wins / arr.length * 100) };
  };
  const aiStat = calc(aiPosts);
  const ruleStat = calc(rulePosts);

  const fmtPct = (v: number | null) => v == null ? "—" : `${v > 0 ? "+" : ""}${v}%`;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-bold text-slate-300">📈 长期胜率仪表盘 <span className="text-[10px] text-slate-500 font-normal">近 180 天 · 拍板真实 {horizon} 盈亏</span></div>
        <div className="flex items-center gap-1">
          {HORIZONS.map(h => (
            <button key={h} onClick={() => setHorizon(h)}
              className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${horizon === h ? "bg-cyan-500/25 text-cyan-200" : "bg-white/5 text-slate-400 hover:bg-white/10"}`}>
              {h}
            </button>
          ))}
          <DisclaimerTag />
        </div>
      </div>

      {confirmed.length === 0 ? (
        <div className="text-[11px] text-slate-500">暂无已回填拍板（{horizon} 周期）。拍板后按交易日自动回填，持续使用拍板功能后此面板自动积累。</div>
      ) : (
        <>
          {/* AI vs 规则对比 */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2">
              <div className="text-[10px] text-amber-300/80">🤖 AI 拍板</div>
              <div className="text-lg font-black text-slate-100">{aiStat.avgPnl != null ? fmtPct(aiStat.avgPnl) : "—"}</div>
              <div className="text-[10px] text-slate-500">胜率 {aiStat.winRate ?? "—"}% · {aiStat.n} 笔</div>
            </div>
            <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-2">
              <div className="text-[10px] text-violet-300/80">🧠 规则拍板</div>
              <div className="text-lg font-black text-slate-100">{ruleStat.avgPnl != null ? fmtPct(ruleStat.avgPnl) : "—"}</div>
              <div className="text-[10px] text-slate-500">胜率 {ruleStat.winRate ?? "—"}% · {ruleStat.n} 笔</div>
            </div>
          </div>

          {/* 月度趋势 */}
          {monthly.length > 0 && (
            <div className="rounded-lg border border-white/5 bg-white/[0.03] p-2">
              <div className="mb-1 text-[10px] text-slate-400">📅 月度表现（{horizon}）</div>
              <div className="flex items-end gap-2 overflow-x-auto pb-1">
                {monthly.map(m => (
                  <div key={m.month} className="flex flex-col items-center min-w-[52px]">
                    <div className="text-[10px] font-bold" style={{ color: (m.avgPnl ?? 0) >= 0 ? "#34d399" : "#fb7185" }}>
                      {fmtPct(m.avgPnl)}
                    </div>
                    {/* 简易柱状图 */}
                    <div className="mt-1 h-12 w-5 rounded-t bg-white/5 relative overflow-hidden">
                      <div className="absolute bottom-0 left-0 right-0"
                        style={{
                          height: `${Math.min(100, Math.abs(m.avgPnl ?? 0) * 10)}%`,
                          background: (m.avgPnl ?? 0) >= 0 ? "rgba(52,211,153,0.5)" : "rgba(251,113,133,0.5)",
                        }} />
                    </div>
                    <div className="text-[9px] text-slate-500 mt-0.5">{m.month.slice(5)}</div>
                    <div className="text-[9px] text-slate-600">{m.total}笔</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 主线排行 */}
          {mainlineStats.length > 0 && (
            <div className="rounded-lg border border-white/5 bg-white/[0.03] p-2">
              <div className="mb-1 text-[10px] text-slate-400">🎯 主线表现排行（{horizon} 平均盈亏）</div>
              <div className="space-y-0.5">
                {mainlineStats.map(m => (
                  <div key={m.mainline} className="flex items-center gap-2 text-[11px]">
                    <span className="w-24 truncate text-slate-300" title={m.mainline}>{m.mainline}</span>
                    <span className={`font-bold ${(m.avgPnl ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                      {fmtPct(m.avgPnl)}
                    </span>
                    <span className="text-slate-500">胜率 {m.winRate}%</span>
                    <span className="ml-auto text-slate-600">{m.total}笔</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
