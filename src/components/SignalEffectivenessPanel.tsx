// ============================================================
// v9.35（S3）：信号有效性面板 —— 幻方"因子验证"前端展示
// 每个信号显示：历史样本数 / 次日正面率 / 次日情绪均变 / 结论（有效/存疑/样本不足）
// 数据来自 backtestSignals（读 kv sentiment:日期 + market_daily:日期）
// ============================================================
import { useState, useEffect } from "react";
import { backtestSignals, type SignalStat } from "../lib/signalBacktest";
import { isLocalServer } from "../lib/cloudStore";
import DisclaimerTag from "./DisclaimerTag";

export default function SignalEffectivenessPanel() {
  const [stats, setStats] = useState<SignalStat[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!isLocalServer()) {
        if (alive) { setError("本地部署才可读取历史数据"); setLoading(false); }
        return;
      }
      try {
        const s = await backtestSignals(14);
        if (alive) { setStats(s); setError(null); }
      } catch {
        if (alive) setError("历史数据读取失败");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  if (loading) {
    return <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-xs text-slate-500">信号回测加载中…</div>;
  }
  if (error) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-300">
        {error}
        <div className="mt-1 text-[10px] text-amber-300/70">数据源：本地 kv（sentiment:日期 + market_daily:日期）</div>
      </div>
    );
  }
  if (!stats || stats.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-xs text-slate-500">
        暂无足够历史数据（至少需要 4 个有情绪分的数据日）。情绪分每日自动积累，market_daily 由 cron 15:40 落库。
      </div>
    );
  }

  const verdictColor = (v: SignalStat["verdict"]) =>
    v === "有效" ? "bg-emerald-500/20 text-emerald-300"
    : v === "存疑" ? "bg-amber-500/20 text-amber-300"
    : "bg-slate-500/20 text-slate-400";

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-sm font-bold text-slate-100">
          🧪 信号有效性回测 <span className="ml-1 text-[10px] text-slate-500 font-normal">幻方"因子验证" · 近14交易日 · 每日自动积累</span>
        </div>
        <DisclaimerTag />
      </div>

      <div className="text-[11px] text-slate-500">
        每个信号用历史数据验证"触发后次日表现"——只信样本≥6 且正面率≥60% 的信号。样本不足的信号会随每日落库自动积累。
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-xs">
          <thead className="bg-white/5 text-slate-400">
            <tr>
              <th className="px-2 py-1.5 text-left">信号</th>
              <th className="px-2 py-1.5 text-left">触发条件</th>
              <th className="px-2 py-1.5 text-center">样本数</th>
              <th className="px-2 py-1.5 text-center">次日正面率</th>
              <th className="px-2 py-1.5 text-center">次日情绪均变</th>
              <th className="px-2 py-1.5 text-center">结论</th>
            </tr>
          </thead>
          <tbody>
            {stats.map(s => (
              <tr key={s.id} className="border-t border-white/5 hover:bg-white/5">
                <td className="px-2 py-1.5 font-semibold text-slate-200">{s.name}</td>
                <td className="px-2 py-1.5 text-slate-400">{s.condition}</td>
                <td className="px-2 py-1.5 text-center font-mono text-slate-300">{s.samples}</td>
                <td className={`px-2 py-1.5 text-center font-mono font-bold ${
                  s.winRate >= 60 ? "text-emerald-300" : s.winRate >= 45 ? "text-amber-300" : "text-rose-300"
                }`}>{s.winRate}%</td>
                <td className={`px-2 py-1.5 text-center font-mono ${s.avgNextChange >= 0 ? "text-rose-300" : "text-emerald-300"}`}>
                  {s.avgNextChange >= 0 ? "+" : ""}{s.avgNextChange.toFixed(1)}
                </td>
                <td className="px-2 py-1.5 text-center">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${verdictColor(s.verdict)}`}>{s.verdict}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-[10px] text-slate-600">
        {stats.filter(s => s.verdict === "有效").length > 0 && (
          <span className="text-emerald-400/80">✅ 当前可信信号：{stats.filter(s => s.verdict === "有效").map(s => s.name).join("、")}　</span>
        )}
        {stats.filter(s => s.verdict === "存疑").length > 0 && (
          <span className="text-amber-400/80">⚠️ 谨慎信号：{stats.filter(s => s.verdict === "存疑").map(s => s.name).join("、")}　</span>
        )}
        <span className="text-slate-500">数据每日自动 +1 日，样本≥6 后自动出结论</span>
      </div>
    </div>
  );
}
