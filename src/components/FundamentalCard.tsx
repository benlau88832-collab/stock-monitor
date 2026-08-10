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
    </div>
  );
}
