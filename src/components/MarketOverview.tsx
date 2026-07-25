"use client";

import { fmtPct, pctColor } from "@/lib/format";
import { indexRealUrl } from "@/lib/realLinks";

interface Props {
  data: any;
  loading: boolean;
}

function SentimentGauge({ value, label }: { value: number; label: string }) {
  const color = value >= 70 ? "#f43f5e" : value >= 55 ? "#fb923c" : value >= 40 ? "#facc15" : value >= 25 ? "#38bdf8" : "#818cf8";
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="text-xs uppercase tracking-wider text-slate-400">情绪温度计</div>
      <div className="relative h-24 w-24">
        <svg viewBox="0 0 36 36" className="h-24 w-24 -rotate-90">
          <circle cx="18" cy="18" r="15.5" fill="none" stroke="#1e293b" strokeWidth="3.5" />
          <circle
            cx="18"
            cy="18"
            r="15.5"
            fill="none"
            stroke={color}
            strokeWidth="3.5"
            strokeDasharray={`${(value / 100) * 97.4} 97.4`}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-xl font-black" style={{ color }}>
            {value}
          </div>
        </div>
      </div>
      <div className="text-center text-xs font-medium text-slate-300">{label}</div>
    </div>
  );
}

export default function MarketOverview({ data, loading }: Props) {
  if (!data && loading) {
    return <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-slate-400">正在加载市场概览…</div>;
  }
  if (!data) {
    return <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-6 text-rose-300">市场概览数据获取失败</div>;
  }

  const { indices, indicesAvailable, breadth, breadthAvailable, sentiment, sentimentLabel } = data;

  return (
    <section className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_auto]">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {!indicesAvailable && (
          <div className="col-span-full rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            指数行情数据不完整，请稍后重试
          </div>
        )}
        {(indices ?? []).map((idx: any) => (
          <a key={idx.code} href={indexRealUrl(idx.code, idx.name)} target="_blank" rel="noopener noreferrer" className="rounded-xl border border-white/10 bg-white/5 p-3 hover:border-amber-400/30 hover:bg-white/10 transition block">
            <div className="text-xs text-slate-400">{idx.name}</div>
            <div className="mt-1 text-lg font-bold text-slate-50">{idx.price?.toFixed(2)}</div>
            <div className={`text-sm font-semibold ${pctColor(idx.pct)}`}>{fmtPct(idx.pct)}</div>
            <div className="mt-1 text-[10px] text-amber-300/80">点击查看东方财富真实数据 →</div>
          </a>
        ))}

        <div className="col-span-2 rounded-xl border border-white/10 bg-white/5 p-3 sm:col-span-3 lg:col-span-5">
          {!breadthAvailable ? (
            <div className="text-xs text-amber-300">市场宽度（涨跌家数）数据不完整</div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <span className="text-slate-400">
                全市场 <b className="text-slate-100">{breadth.total}</b> 只
              </span>
              <span className="text-rose-400">
                上涨 <b>{breadth.up}</b>
              </span>
              <span className="text-emerald-400">
                下跌 <b>{breadth.down}</b>
              </span>
              <span className="text-slate-400">
                平盘 <b>{breadth.flat}</b>
              </span>
              <span className="text-rose-300">
                涨停 <b>{breadth.limitUp}</b>
              </span>
              <span className="text-emerald-300">
                跌停 <b>{breadth.limitDown}</b>
              </span>
              <span className="text-slate-400">
                平均涨跌幅 <b className={pctColor(breadth.avgPct)}>{fmtPct(breadth.avgPct)}</b>
              </span>
            </div>
          )}
        </div>
      </div>

      <SentimentGauge value={sentiment} label={sentimentLabel} />
    </section>
  );
}
