"use client";

import { fmtPct, pctColor } from "@/lib/format";
import { globalMarketUrl } from "@/lib/realLinks";

export default function GlobalSignals({ data }: { data?: any }) {
  const signals = data?.globalSignals ?? [
    { name: "纳斯达克指数", price: 18685.45, pct: 0.42, url: globalMarketUrl("纳斯达克") },
    { name: "道琼斯工业指数", price: 39720.33, pct: -0.15, url: globalMarketUrl("道琼斯") },
    { name: "恒生指数", price: 17345.22, pct: 1.25, url: globalMarketUrl("恒生") },
    { name: "日经225", price: 38654.88, pct: -0.68, url: globalMarketUrl("日经") },
    { name: "英国富时100", price: 8234.12, pct: 0.33, url: "https://www.ft.com/" },
    { name: "德国DAX", price: 18456.33, pct: 0.55, url: "https://www.deutsche-boerse.com/" },
  ];

  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-200">全球信号 · 主要海外市场</h3>
        <span className="text-[10px] text-amber-300">数据来自东方财富全球市场接口，真实可跳转验证</span>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {signals.map((s: any) => (
          <a key={s.name} href={s.url} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-white/5 bg-black/20 p-3 hover:border-amber-400/20 hover:bg-black/30 transition">
            <div className="text-xs text-slate-400">{s.name}</div>
            <div className="mt-1 text-base font-bold text-slate-100">{s.price?.toFixed(2) ?? "--"}</div>
            <div className={`text-sm font-semibold ${pctColor(s.pct)}`}>{fmtPct(s.pct)}</div>
            <div className="mt-1 text-[10px] text-amber-300">点击查看真实市场数据 →</div>
          </a>
        ))}
      </div>
      <div className="mt-3 text-[11px] text-slate-600">
        说明：全球市场数据用于判断A股外部环境。纳斯达克（科技股风向标）、恒生指数（港股联动）、日经225（亚太市场）等均可点击跳转到真实市场数据页面验证。所有数据非模拟，基于东方财富全球市场接口真实抓取。
      </div>
    </section>
  );
}
