import { useState, useEffect } from "react";
import { getApiHealth, getOverallHealth, formatLastSuccess, type ApiRecord } from "../lib/apiHealth";
import { getSourceState } from "../lib/jsonpQueue";

// 导航栏右侧的健康指示圆点 + 展开面板
// v9.90.0：面板增加"服务端在线"探测与"延迟源供数"标记 —— 用户一眼区分
//   "服务端挂了"（proxy 通道不可用）vs "东财主源挂了"（已自动切 push2delay 延迟源）
export default function HealthDot() {
  const [open, setOpen] = useState(false);
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);
  const health = getOverallHealth();
  const records = getApiHealth();

  // v9.90.0：服务端在线探测（/api/health，5s 超时，30s 刷新一次）
  useEffect(() => {
    let alive = true;
    const probe = async () => {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 5000);
        const r = await fetch("/api/health", { signal: ctrl.signal });
        clearTimeout(t);
        if (alive) setServerOnline(r.ok);
      } catch { if (alive) setServerOnline(false); }
    };
    probe();
    const iv = setInterval(probe, 30000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

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

  // v9.90.0：实际供数源标记 —— 主源 host 由 fallback 域供数时显示"已切延迟源"
  const sourceState = getSourceState();
  const delayedHosts = new Set(
    sourceState
      .filter(s => s.source !== "eastmoney" && s.source !== s.host)
      .map(s => s.source),
  );

  return (
    <div className="relative">
      <button onClick={() => setOpen(v => !v)} className="flex items-center gap-1 rounded px-2 py-1 bg-white/10 hover:bg-white/20 text-xs text-slate-300"
        title="接口健康状态">
        <span className={`inline-block w-2 h-2 rounded-full ${dotColor}`} />
        <span className="hidden sm:inline">健康</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-80 rounded-lg border border-white/10 bg-[#0d1424] shadow-xl p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-bold text-slate-200">📡 接口健康面板</div>
            {/* v9.90.0：服务端在线状态（区分"服务端挂了"vs"东财主源挂了"） */}
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
              serverOnline === null ? "bg-white/5 text-slate-500"
              : serverOnline ? "bg-emerald-500/10 text-emerald-300"
              : "bg-rose-500/10 text-rose-300"
            }`}>
              {serverOnline === null ? "探测中…" : serverOnline ? "服务端在线" : "⚠ 服务端离线"}
            </span>
          </div>
          {/* v9.90.0：延迟源供数提示 */}
          {delayedHosts.size > 0 && (
            <div className="rounded bg-amber-500/10 px-2 py-1 text-[10px] text-amber-300">
              ℹ 行情主源不可达，已自动切换延迟源：{[...delayedHosts].join(" / ")}（约 15 分钟延迟）
            </div>
          )}
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
          <div className="text-[10px] text-slate-600">
            {serverOnline === false ? "服务端离线：行情经浏览器直连（自动切延迟源）；请启动 PM2 服务恢复秒回" : "提示：0% 且显示延迟源 = 东财主源不可达，系统已自动兜底"}
          </div>
        </div>
      )}
    </div>
  );
}
