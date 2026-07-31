import { useState } from "react";
import { getApiHealth, getOverallHealth, formatLastSuccess, type ApiRecord } from "../lib/apiHealth";

// 导航栏右侧的健康指示圆点 + 展开面板
export default function HealthDot() {
  const [open, setOpen] = useState(false);
  const health = getOverallHealth();
  const records = getApiHealth();

  const dotColor = health === "green" ? "bg-emerald-400" : health === "yellow" ? "bg-amber-400" : "bg-rose-400";

  function successRate(r: ApiRecord): string {
    if (r.recentCalls === 0) return "—";
    return `${Math.round(r.recentSuccesses / r.recentCalls * 100)}%`;
  }

  function rateColor(r: ApiRecord): string {
    if (r.recentCalls < 2) return "text-slate-400";
    const rate = r.recentSuccesses / r.recentCalls;
    if (rate >= 0.8) return "text-emerald-400";
    if (rate >= 0.5) return "text-amber-400";
    return "text-rose-400";
  }

  return (
    <div className="relative">
      <button onClick={() => setOpen(v => !v)} className="flex items-center gap-1 rounded px-2 py-1 bg-white/10 hover:bg-white/20 text-xs text-slate-300"
        title="接口健康状态">
        <span className={`inline-block w-2 h-2 rounded-full ${dotColor}`} />
        <span className="hidden sm:inline">健康</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-80 rounded-lg border border-white/10 bg-[#0d1424] shadow-xl p-3 space-y-2">
          <div className="text-xs font-bold text-slate-200">📡 接口健康面板</div>
          {records.length === 0 ? (
            <div className="text-[11px] text-slate-500">暂无调用记录（等待首次刷新）</div>
          ) : (
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-slate-500 border-b border-white/10">
                  <th className="text-left py-1">接口</th>
                  <th className="text-right">成功率</th>
                  <th className="text-right">均耗时</th>
                  <th className="text-right">最后成功</th>
                </tr>
              </thead>
              <tbody>
                {records.map(r => (
                  <tr key={r.name} className="border-b border-white/5">
                    <td className="py-1 text-slate-300">{r.name}</td>
                    <td className={`text-right font-semibold ${rateColor(r)}`}>{successRate(r)}</td>
                    <td className="text-right text-slate-400">{r.avgMs}ms</td>
                    <td className="text-right text-slate-500">{formatLastSuccess(r.lastSuccess)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="text-[11px] text-slate-600">基于近10次调用统计。绿≥80% / 黄≥50% / 红&lt;50%</div>
        </div>
      )}
    </div>
  );
}
