// ============================================================
// v9.44（④）：信号净值曲线 —— 幻方"信号验证"的收益视图
// 读 signalLedger 已回填信号 → T1/T5 等权复利净值曲线 + 胜率/回撤统计
// SVG 手绘（无图表库）；红涨绿跌（A股习惯）
// ============================================================
import { useState, useEffect, useMemo } from "react";
import { getLedger, buildEquitySeries, computeEquityStats, type EquityPoint } from "../lib/signalLedger";
import DisclaimerTag from "./DisclaimerTag";

function EquityChart({ pts }: { pts: EquityPoint[] }) {
  const W = 340, H = 96, PAD = 6;
  const innerW = W - PAD * 2, innerH = H - PAD * 2;
  if (pts.length < 2) return <div className="text-[10px] text-slate-600">至少需要 2 笔已回填信号才能画曲线（T+1 收益自动回填积累中）</div>;
  const vals = pts.map(p => p.equity);
  const min = Math.min(...vals, 100);
  const max = Math.max(...vals, 100);
  const span = (max - min) || 1;
  const yOf = (v: number) => PAD + (max - v) / span * innerH;
  const xOf = (i: number) => PAD + i / (pts.length - 1) * innerW;
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)},${yOf(p.equity).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg width={W} height={H} className="w-full">
      {/* 100 基准线 */}
      <line x1={PAD} x2={W - PAD} y1={yOf(100)} y2={yOf(100)} stroke="rgba(148,163,184,0.35)" strokeWidth="0.8" strokeDasharray="3,3" />
      <text x={W - PAD} y={yOf(100) - 2} textAnchor="end" fontSize="8" fill="rgba(148,163,184,0.7)">100</text>
      {/* 净值曲线 */}
      <path d={line} fill="none" stroke={last.equity >= 100 ? "#f43f5e" : "#10b981"} strokeWidth="1.6" />
      {/* 单笔标记：红涨绿跌 */}
      {pts.map((p, i) => (
        <circle key={i} cx={xOf(i)} cy={yOf(p.equity)} r={p.win ? 2.2 : 2} fill={p.win ? "rgba(244,63,94,0.85)" : "rgba(16,185,129,0.85)"}>
          <title>{`${p.date} 收益${p.ret >= 0 ? "+" : ""}${p.ret}% 净值${p.equity}`}</title>
        </circle>
      ))}
      {/* 当前点 */}
      <circle cx={xOf(pts.length - 1)} cy={yOf(last.equity)} r="3.2" fill={last.equity >= 100 ? "#f43f5e" : "#10b981"} stroke="#0f172a" strokeWidth="1">
        <title>{`最新 ${last.date} 净值 ${last.equity}`}</title>
      </circle>
    </svg>
  );
}

export default function SignalEquityPanel() {
  const [horizon, setHorizon] = useState<1 | 5>(1);
  const [ledger, setLedger] = useState<ReturnType<typeof getLedger>>([]);

  useEffect(() => {
    try { setLedger(getLedger()); } catch { setLedger([]); }
  }, []);

  const pts = useMemo(() => buildEquitySeries(ledger, horizon), [ledger, horizon]);
  const stats = useMemo(() => computeEquityStats(pts), [pts]);

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-sm font-bold text-slate-100">
          💰 信号净值曲线 <span className="ml-1 text-[10px] text-slate-500 font-normal">幻方"信号验证" · 等权复利 · 红涨绿跌</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setHorizon(1)}
            className={`rounded px-2 py-0.5 text-[10px] font-bold ${horizon === 1 ? "bg-cyan-500/25 text-cyan-200" : "bg-white/5 text-slate-400 hover:bg-white/10"}`}>T+1</button>
          <button onClick={() => setHorizon(5)}
            className={`rounded px-2 py-0.5 text-[10px] font-bold ${horizon === 5 ? "bg-cyan-500/25 text-cyan-200" : "bg-white/5 text-slate-400 hover:bg-white/10"}`}>T+5</button>
          <DisclaimerTag />
        </div>
      </div>

      {stats.count === 0 ? (
        <div className="text-[11px] text-slate-500">
          暂无已回填信号。信号触发后 T+1/T+5 收盘价自动回填（runSignalBackfill），积累几笔后此处出现净值曲线。
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span>已回填 <b className="font-black text-slate-200">{stats.count}</b> 笔</span>
            <span>胜率 <b className={`font-black ${stats.winRate >= 55 ? "text-emerald-300" : stats.winRate >= 45 ? "text-amber-300" : "text-rose-300"}`}>{stats.winRate}%</b></span>
            <span>累计收益 <b className={`font-black ${stats.totalReturn >= 0 ? "text-rose-300" : "text-emerald-300"}`}>{stats.totalReturn >= 0 ? "+" : ""}{stats.totalReturn}%</b></span>
            <span>平均单笔 <b className={`font-mono ${stats.avgReturn >= 0 ? "text-rose-300" : "text-emerald-300"}`}>{stats.avgReturn >= 0 ? "+" : ""}{stats.avgReturn}%</b></span>
            <span>最大回撤 <b className="font-mono text-amber-300">-{stats.maxDrawdown}%</b></span>
          </div>
          <EquityChart pts={pts} />
          <div className="text-[10px] text-slate-600">
            假设每笔信号等权满仓、按 T+{horizon} 收盘价结算的复利净值（从 100 起）。收益为正记红、为负记绿（A股习惯）。胜率&lt;45% 的信号源在 SignalPanel 已标"存疑"。
          </div>
        </>
      )}
    </div>
  );
}
