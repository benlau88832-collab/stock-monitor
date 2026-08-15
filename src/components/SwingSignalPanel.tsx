// ============================================================
// v9.147.0（阶段二B·波段信号闭环）：波段买点信号胜率面板
// 数据：GET /api/swing/signals → { stats: 按信号类型 T+20/T+60 胜率, recent: 最近信号 }
// 信号来源：波段决策卡 stage.buyPoint 落库（放量首板/首板次日低吸/平台突破/主升回踩）
// 回填：cron 15:55 用本地 kline_daily 算 T+20/T+60 收盘涨跌幅；样本≥10 才显示胜率
// ============================================================
import { useEffect, useState } from "react";
import { isLocalServer } from "../lib/cloudStore";

interface TStats { n: number; winRate: number | null; win: number; avg: number | null; }
interface SignalStatRow { signalType: string; n: number; t20: TStats; t60: TStats; }
interface RecentSignal { id: number; code: string; name: string | null; signal_type: string; signal_date: string; price: number | null; pnl_t20: number | null; pnl_t60: number | null; status: string; }

const TYPE_LABEL: Record<string, string> = {
  放量首板: "首板打板",
  首板次日低吸: "首板低吸",
  平台突破: "平台突破",
  主升回踩: "主升回踩",
};

export default function SwingSignalPanel() {
  const [stats, setStats] = useState<SignalStatRow[] | null>(null);
  const [recent, setRecent] = useState<RecentSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!isLocalServer()) {
        if (alive) { setError("本地部署才可读取信号台账"); setLoading(false); }
        return;
      }
      try {
        const r = await fetch("/api/swing/signals?limit=30");
        if (!r.ok) throw new Error(`signals ${r.status}`);
        const j = await r.json();
        if (alive) { setStats(Array.isArray(j.stats) ? j.stats : []); setRecent(Array.isArray(j.recent) ? j.recent : []); setError(null); }
      } catch (e) {
        if (alive) setError(String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const pnlColor = (v: number | null) => v == null ? "text-slate-500" : v > 0 ? "text-emerald-300" : "text-rose-300";

  return (
    <details className="rounded-xl border border-violet-500/20 bg-violet-950/10">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-bold text-violet-300">波段信号胜率（收起）</summary>
      <div className="space-y-2 px-3 pb-3">
        {loading && <div className="text-[11px] text-slate-500">信号台账加载中…</div>}
        {error && <div className="text-[11px] text-rose-300">{error}</div>}
        {!loading && !error && stats && stats.length === 0 && (
          <div className="text-[11px] text-slate-500">
            暂无信号样本。使用波段决策卡分析标的（产生买点时自动记录信号），每日盘后自动回填 T+20/T+60 盈亏；样本≥10 才显示胜率。
          </div>
        )}
        {!loading && !error && stats && stats.length > 0 && (
          <table className="w-full text-[11px]">
            <thead className="bg-white/5 text-slate-400">
              <tr>
                <th className="px-2 py-1 text-left">信号</th>
                <th className="px-2 py-1 text-center">样本</th>
                <th className="px-2 py-1 text-center">T+20 胜率</th>
                <th className="px-2 py-1 text-center">T+20 均幅</th>
                <th className="px-2 py-1 text-center">T+60 胜率</th>
                <th className="px-2 py-1 text-center">T+60 均幅</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s) => (
                <tr key={s.signalType} className="border-t border-white/5">
                  <td className="px-2 py-1 text-slate-200">{TYPE_LABEL[s.signalType] ?? s.signalType}</td>
                  <td className="px-2 py-1 text-center text-slate-300">{s.n}</td>
                  <td className="px-2 py-1 text-center">{s.t20.winRate != null ? <b className="text-violet-300">{s.t20.winRate}%</b> : <span className="text-slate-600">{s.t20.n}/10</span>}</td>
                  <td className={`px-2 py-1 text-center ${pnlColor(s.t20.avg)}`}>{s.t20.avg != null ? `${s.t20.avg > 0 ? "+" : ""}${s.t20.avg}%` : "—"}</td>
                  <td className="px-2 py-1 text-center">{s.t60.winRate != null ? <b className="text-violet-300">{s.t60.winRate}%</b> : <span className="text-slate-600">{s.t60.n}/10</span>}</td>
                  <td className={`px-2 py-1 text-center ${pnlColor(s.t60.avg)}`}>{s.t60.avg != null ? `${s.t60.avg > 0 ? "+" : ""}${s.t60.avg}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {recent.length > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] font-bold text-slate-400">最近信号（{recent.length}）</div>
            {recent.slice(0, 12).map((s) => (
              <div key={s.id} className="flex items-center gap-2 rounded bg-black/20 px-2 py-1 text-[10px] text-slate-300">
                <span className="font-bold text-slate-100">{s.code}</span>
                <span className="text-violet-300/90">{TYPE_LABEL[s.signal_type] ?? s.signal_type}</span>
                <span className="text-slate-500">{s.signal_date}</span>
                <span className={`ml-auto ${pnlColor(s.pnl_t20)}`}>{s.pnl_t20 != null ? `T+20 ${s.pnl_t20 > 0 ? "+" : ""}${s.pnl_t20}%` : "T+20 待回填"}</span>
                <span className={pnlColor(s.pnl_t60)}>{s.pnl_t60 != null ? `T+60 ${s.pnl_t60 > 0 ? "+" : ""}${s.pnl_t60}%` : ""}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}
