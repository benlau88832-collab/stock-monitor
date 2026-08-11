// ============================================================
// v9.106.0（第六批 B，T-B4）：主线级回测面板
// 数据源：GET /api/backtest/mainline（zt_snapshot 多日板块涨停序列聚合）
// 展示：同主线历史胜率表（次日/3日涨停家数延续均值 + 延续胜率 + 样本数）
// 诚实标注：样本 <3 日板块不展示；胜率为"涨停家数延续"口径（非个股收益）
// ============================================================
import { useState, useEffect } from "react";
import { isLocalServer } from "../lib/cloudStore";

interface BacktestRow {
  board: string;
  samples: number;
  nextDayAvg: number | null;
  nextDayWinRate: number | null;
  day3Avg: number | null;
  day3WinRate: number | null;
}

export default function MainlineBacktestPanel() {
  const [rows, setRows] = useState<BacktestRow[]>([]);
  const [days, setDays] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isLocalServer()) return;
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/backtest/mainline");
        const j = await r.json();
        if (!alive) return;
        setRows(Array.isArray(j.items) ? j.items : []);
        setDays(Number(j.days ?? 0));
      } catch { /* 静默 */ }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  const fmt = (v: number | null, sign = true) => v == null ? "—" : `${sign && v > 0 ? "+" : ""}${v.toFixed(1)}`;
  const color = (v: number | null) => v == null ? "text-slate-500" : v > 0 ? "text-rose-400" : v < 0 ? "text-emerald-400" : "text-slate-400";

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-slate-200">📊 主线级回测（涨停家数延续）</span>
        <span className="text-[10px] text-slate-500">{days} 个交易日快照 · 口径：板块次日/3日涨停家数变化 · 样本&lt;3日不展示</span>
      </div>
      {loading ? (
        <div className="text-[11px] text-slate-500">回测数据加载中…</div>
      ) : rows.length === 0 ? (
        <div className="text-[11px] text-slate-500">暂无回测数据（需 ≥3 个交易日的涨停快照）</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead className="bg-white/5 text-slate-400">
              <tr>
                <th className="px-2 py-1 text-left">板块</th>
                <th className="px-2 py-1 text-right">样本</th>
                <th className="px-2 py-1 text-right">次日变化均值</th>
                <th className="px-2 py-1 text-right">次日延续胜率</th>
                <th className="px-2 py-1 text-right">3日变化均值</th>
                <th className="px-2 py-1 text-right">3日延续胜率</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 15).map(r => (
                <tr key={r.board} className="border-t border-white/5 hover:bg-white/5">
                  <td className="px-2 py-1 font-semibold text-slate-200">{r.board}</td>
                  <td className="px-2 py-1 text-right text-slate-400">{r.samples}</td>
                  <td className={`px-2 py-1 text-right font-bold ${color(r.nextDayAvg)}`}>{fmt(r.nextDayAvg)}</td>
                  <td className="px-2 py-1 text-right text-slate-300">{r.nextDayWinRate != null ? r.nextDayWinRate.toFixed(0) + "%" : "—"}</td>
                  <td className={`px-2 py-1 text-right font-bold ${color(r.day3Avg)}`}>{fmt(r.day3Avg)}</td>
                  <td className="px-2 py-1 text-right text-slate-300">{r.day3WinRate != null ? r.day3WinRate.toFixed(0) + "%" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 text-[10px] text-slate-600">胜率为"板块涨停家数次日/3日延续增加"口径，非个股收益；历史规律仅供参考，不构成投资建议。</div>
        </div>
      )}
    </div>
  );
}
