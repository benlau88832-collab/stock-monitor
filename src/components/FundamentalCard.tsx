// ============================================================
// v9.98.0（批次 3）：基本面体检卡（investool 全栈落地前端）
// 数据：GET /api/db/fundamental/:code（阈值表 + 银行专项 + desc/ok + 合理价）
// desc 人类可读 → 直接展示；ok 标志 → 绿/红
// ============================================================
import { useState, useEffect } from "react";

interface FundamentalCheck {
  name: string;
  desc: string;
  ok: boolean;
}

interface FundamentalData {
  checks: FundamentalCheck[];
  metrics: {
    roe: number | null; debt: number | null; eps: number | null;
    revTz: number | null; profitTz: number | null; peTtm: number | null;
    marketCap: number | null; bank: boolean;
  } | null;
  rightPrice: { rightPrice: number | null; priceSpace: number | null; annualDate?: string; note?: string } | null;
  bank: boolean;
  error?: string;
  asOf?: string;
  history?: Array<{ reportDate: string; roe: number | null; debt: number | null; gross: number | null; revYoy: number | null; profitYoy: number | null; eps: number | null; cashPs: number | null }>;
  peerComparison?: { peerCount: number; peers: Array<{ code: string; name: string }>; metrics: Record<string, number | null> };
  catalysts?: Array<{ type: string; title: string; eventDate: string }>;
  researchRatingTrend?: Array<{ month: string; total: number; ratings: Record<string, number> }>;
}

interface Props {
  code: string;
  /** 现价（用于合理价空间展示） */
  price?: number | null;
}

export default function FundamentalCard({ code, price = null }: Props) {
  const [data, setData] = useState<FundamentalData | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    if (!code) return;
    let alive = true;
    setLoading(true);
    fetch(`/api/db/fundamental/${code}`)
      .then(r => r.json())
      .then(j => { if (alive) setData(j); })
      .catch(() => { if (alive) setData(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [code, refreshTick]);

  if (loading && !data) {
    return <div className="rounded-lg border border-white/10 bg-black/20 p-2 text-[10px] text-slate-600">💊 基本面体检加载中…</div>;
  }
  if (!data || data.error) {
    return <div className="rounded-lg border border-white/10 bg-black/20 p-2 text-[10px] text-slate-600">💊 基本面：{data?.error ?? "无数据"}</div>;
  }

  const pass = data.checks?.filter(c => c.ok).length ?? 0;
  const total = data.checks?.length ?? 0;
  const rp = data.rightPrice;
  const rpVsPrice = rp?.rightPrice != null && price != null && price > 0
    ? ((rp.rightPrice - price) / price) * 100 : rp?.priceSpace;

  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-2 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-slate-500">💊 基本面体检 <span className="ml-1 text-[9px] text-slate-600">{data.bank ? "银行专项" : "通用阈值"} · {pass}/{total} 通过</span></span>
        <button onClick={() => setRefreshTick(t => t + 1)}
          className="rounded bg-white/5 px-1.5 py-0.5 text-[9px] text-slate-400 hover:bg-white/10">刷新</button>
      </div>
      <div className="space-y-0.5">
        {data.checks?.map((c, i) => (
          <div key={i} className="flex items-start gap-1.5 text-[10px]">
            <span className={`mt-0.5 shrink-0 rounded px-1 text-[9px] font-bold ${c.ok ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300"}`}>{c.ok ? "✓" : "✗"}</span>
            <span className="text-slate-400">{c.name}</span>
            <span className="text-slate-500 truncate">{c.desc}</span>
          </div>
        ))}
      </div>
      {rp?.rightPrice != null && (
        <div className={`rounded bg-white/5 px-1.5 py-1 text-[10px] ${rpVsPrice != null && rpVsPrice < 0 ? "text-amber-300" : "text-sky-300"}`}>
          合理价 <b>{rp.rightPrice}</b>
          {rpVsPrice != null && <span className="ml-1">({rpVsPrice >= 0 ? "+" : ""}{rpVsPrice.toFixed(1)}%{price != null ? " vs 现价" : "空间"})</span>}
          <span className="block text-[9px] text-slate-600">{rp.note}{rp.annualDate ? ` · 年报 ${rp.annualDate}` : ""}</span>
        </div>
      )}
      {(data.history?.length ?? 0) > 0 && (
        <div className="rounded bg-white/5 p-1.5">
          <div className="text-[9px] text-slate-500 mb-0.5">📈 基本面历史趋势（本地 SQL 最近 {data.history!.length} 期）</div>
          <div className="space-y-0.5">
            {data.history!.slice(0, 6).map((h, i) => (
              <div key={i} className="flex gap-1 text-[9px] text-slate-400">
                <span className="w-20 shrink-0">{h.reportDate}</span>
                <span>ROE {h.roe != null ? `${h.roe.toFixed(1)}%` : "—"}</span>
                <span>毛利 {h.gross != null ? `${h.gross.toFixed(1)}%` : "—"}</span>
                <span>营收 {h.revYoy != null ? `${h.revYoy.toFixed(1)}%` : "—"}</span>
                <span>净利 {h.profitYoy != null ? `${h.profitYoy.toFixed(1)}%` : "—"}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {data.peerComparison && (
        <div className="rounded bg-white/5 p-1.5 text-[9px] text-slate-400">
          <div className="text-slate-500 mb-0.5">🏭 同行对比（本地 {data.peerComparison.peerCount} 只可比）</div>
          <div className="flex flex-wrap gap-x-2">
            <span>PE分位 {data.peerComparison.metrics.pePercentile ?? "未采集"}</span>
            <span>ROE分位 {data.peerComparison.metrics.roePercentile ?? "未采集"}</span>
            <span>营收分位 {data.peerComparison.metrics.revYoyPercentile ?? "未采集"}</span>
          </div>
          {data.peerComparison.peers.slice(0, 6).map((p, i) => (
            <span key={i} className="mr-1 text-slate-500">{p.name}({p.code})</span>
          ))}
        </div>
      )}
      {(data.catalysts?.length ?? 0) > 0 && (
        <div className="rounded bg-white/5 p-1.5">
          <div className="text-[9px] text-slate-500 mb-0.5">📅 催化剂日历（未来 180 天，本地 SQL {data.catalysts!.length} 条）</div>
          <div className="space-y-0.5">
            {data.catalysts!.slice(0, 5).map((c, i) => (
              <div key={i} className="text-[9px] text-slate-400"><b className="text-amber-300/80">{c.eventDate}</b> [{c.type}] {c.title}</div>
            ))}
          </div>
        </div>
      )}
      {(data.researchRatingTrend?.length ?? 0) > 0 && (
        <div className="rounded bg-white/5 p-1.5">
          <div className="text-[9px] text-slate-500 mb-0.5">📚 研报覆盖趋势（东财 reportapi 按月聚合）</div>
          <div className="space-y-0.5">
            {data.researchRatingTrend!.slice(-6).map((m, i) => (
              <div key={i} className="flex flex-wrap gap-x-2 text-[9px] text-slate-400">
                <span className="w-16 shrink-0">{m.month}</span>
                <span>共 {m.total} 份</span>
                {Object.entries(m.ratings).map(([r, n]) => (
                  <span key={r} className="text-slate-500">{r} {n}</span>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
