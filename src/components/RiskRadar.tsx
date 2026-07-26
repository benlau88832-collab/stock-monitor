"use client";

import { stockRealUrl } from "@/lib/realLinks";

const LEVEL_STYLE: Record<string, string> = {
  high: "border-rose-500/50 bg-rose-500/10 text-rose-300",
  medium: "border-orange-500/40 bg-orange-500/10 text-orange-300",
  low: "border-slate-500/30 bg-slate-500/10 text-slate-300",
  positive: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  policy: "border-sky-500/40 bg-sky-500/10 text-sky-300",
};

export default function RiskRadar({ data, loading }: { data: any; loading: boolean }) {
  if (!data && loading) {
    return <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-slate-400">正在扫描风险与信号…</div>;
  }
  if (!data || data.message) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-6 text-amber-300">
        {data?.message || "请先在「设置」中添加自选股，风险雷达将自动扫描"}
      </div>
    );
  }

  const items = data.items ?? [];

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs text-slate-400">
        A股风险与信号雷达 · 针对自选股扫描：风险（质押/减持/现金流/偿债/监管） + 利好（业绩/回购/合同/政策）+ 行业政策
      </div>
      {items.length === 0 && <div className="text-slate-500">暂无监控标的，请先在「设置」中添加自选股</div>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {items.map((it: any) => (
          <div
            key={it.code}
            className={`rounded-xl border p-4 ${it.vetoTriggered ? "border-rose-500/50 bg-rose-500/5" : "border-white/10 bg-white/5"}`}
          >
            <div className="flex items-center justify-between">
              <a href={stockRealUrl(it.code)} target="_blank" rel="noopener noreferrer" className="text-base font-bold text-slate-50 hover:text-amber-300 transition">
                {it.name} <span className="text-xs text-slate-500">{it.code}</span>
                <span className="ml-2 text-[10px] text-amber-300">查看东方财富 →</span>
              </a>
              <div className="flex gap-1">
                {it.vetoTriggered && (
                  <span className="rounded bg-rose-500/20 px-2 py-0.5 text-xs font-bold text-rose-300">高危信号</span>
                )}
                {it.hasPositive && (
                  <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-xs font-bold text-emerald-300">有利好</span>
                )}
              </div>
            </div>
            <div className="mt-1 text-xs text-slate-400">
              质押比例：{it.pledgeRatio != null ? `${it.pledgeRatio}%（${it.pledgeDate}）` : "无披露数据 / 数据不完整"}
            </div>
            <div className="mt-3 space-y-2">
              {it.items.length === 0 && it.positiveItems?.length === 0 && (
                <div className="text-sm text-emerald-400">未触发已知风险或利好规则</div>
              )}
              {/* Risk items */}
              {it.items.map((r: any, i: number) => (
                <div key={`risk-${i}`} className={`rounded-lg border px-3 py-2 text-xs ${LEVEL_STYLE[r.level]}`}>
                  <div className="font-semibold">{r.level === "high" ? "🚨 " : r.level === "medium" ? "⚠️ " : ""}{r.type}</div>
                  <div className="mt-0.5 text-slate-300">{r.detail}</div>
                  <div className="mt-0.5 text-[10px] text-slate-500">来源：{r.source}</div>
                </div>
              ))}
              {/* Positive items */}
              {(it.positiveItems ?? []).map((r: any, i: number) => (
                <div key={`pos-${i}`} className={`rounded-lg border px-3 py-2 text-xs ${LEVEL_STYLE[r.level]}`}>
                  <div className="font-semibold">{r.level === "positive" ? "✅ " : "📋 "}{r.type}</div>
                  <div className="mt-0.5 text-slate-300">{r.detail}</div>
                  <div className="mt-0.5 text-[10px] text-slate-500">来源：{r.source}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {data.source && <div className="text-[11px] text-slate-500">数据来源与计算逻辑：{data.source}</div>}
    </section>
  );
}
