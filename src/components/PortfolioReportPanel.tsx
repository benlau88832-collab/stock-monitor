// ============================================================
// v9.143.0 portfolio periodic report panel
// Data source: GET /api/portfolio/report?days=30
// ============================================================
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/cloudStore";

interface ReportData {
  periodDays: number;
  since: string;
  positions: number;
  trades: number;
  realizedPnlPct: number | null;
  reviewDue: number;
  invalidationCount: number;
  byTheme: Array<{ theme: string; count: number; avgPnl: number | null; winRate: number | null; pnlSum: number }>;
  pendingLogic: number;
}

export default function PortfolioReportPanel() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiFetch(`/api/portfolio/report?days=${days}`, { signal: AbortSignal.timeout(12000) });
      if (r.ok) setData(await r.json());
    } catch { /* 服务端不可用时不阻塞页面 */ }
    setLoading(false);
  }, [days]);

  useEffect(() => { load(); }, [load]);

  const fmtPct = (v: number | null) => v == null ? "—" : `${v > 0 ? "+" : ""}${v}%`;

  return (
    <div className="rounded-xl border border-teal-500/20 bg-teal-950/10 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-teal-300">📦 持仓组合周期报告</span>
        <div className="flex items-center gap-1">
          {[7, 30, 90].map(n => (
            <button key={n} onClick={() => setDays(n)} className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${days === n ? "bg-teal-500/25 text-teal-200" : "bg-white/5 text-slate-400 hover:bg-white/10"}`}>{n}天</button>
          ))}
          <button onClick={load} disabled={loading} className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-white/10">{loading ? "计算中" : "刷新"}</button>
        </div>
      </div>
      {!data ? (
        <div className="mt-2 text-[11px] text-slate-500">暂无持仓/成交样本；录入真实或纸上成交后自动生成组合周期报告。</div>
      ) : (
        <div className="mt-2 space-y-1.5">
          <div className="grid grid-cols-2 gap-1.5 text-[11px] sm:grid-cols-4">
            <div className="rounded bg-white/5 px-2 py-1"><div className="text-slate-500">持仓</div><div className="text-slate-200 font-bold">{data.positions} 只</div></div>
            <div className="rounded bg-white/5 px-2 py-1"><div className="text-slate-500">成交</div><div className="text-slate-200 font-bold">{data.trades} 笔</div></div>
            <div className="rounded bg-white/5 px-2 py-1"><div className="text-slate-500">实际盈亏</div><div className={`font-bold ${(data.realizedPnlPct ?? 0) >= 0 ? "text-rose-300" : "text-emerald-300"}`}>{fmtPct(data.realizedPnlPct)}</div></div>
            <div className="rounded bg-white/5 px-2 py-1"><div className="text-slate-500">待复核/失效</div><div className="text-slate-200 font-bold">{data.reviewDue} / {data.invalidationCount}</div></div>
          </div>
          {data.byTheme.length > 0 && (
            <div className="rounded bg-white/[0.03] p-1.5">
              <div className="text-[10px] text-slate-400">主题/个股贡献（{days} 天）</div>
              <div className="space-y-0.5">
                {data.byTheme.map((t) => (
                  <div key={t.theme} className="flex items-center gap-2 text-[11px]">
                    <span className="w-28 truncate text-slate-300" title={t.theme}>{t.theme}</span>
                    <span className={`font-bold ${(t.avgPnl ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{fmtPct(t.avgPnl)}</span>
                    <span className="text-slate-500">胜率 {t.winRate}%</span>
                    <span className="ml-auto text-slate-600">{t.count}笔</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="text-[10px] text-slate-600">数据源：trade_ledger + logic_ledger + decision_post；无成交时不制造统计。</div>
        </div>
      )}
    </div>
  );
}
