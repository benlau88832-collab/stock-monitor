import { fmtMoney, fmtPct, pctColor } from "../lib/format";
import { COMMODITY_INDICES } from "../lib/api";
import { globalMarketUrl, commodityUrl } from "../lib/realLinks";
import type { GlobalData } from "../App";

export default function GlobalSignals({ data, loading }: { data: GlobalData | null; loading: boolean }) {
  if (loading && !data) return <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-slate-400">正在加载全球市场数据…</div>;
  if (!data) return null;

  const { globalSignals, commodities, turnover } = data;

  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-200">🌍 全球信号 · 主要海外市场和重要指标监控</h3>
        <span className="text-[11px] text-amber-300">数据来自东方财富全球市场接口，实时更新</span>
      </div>

      {/* 成交额 */}
      {turnover.available && (
        <a href="https://data.eastmoney.com/zjlx/detail.html" target="_blank" rel="noopener noreferrer"
          className="block rounded-xl border border-white/10 bg-white/5 p-3 hover:bg-white/8 transition">
          <div className="text-xs text-slate-400">沪深两市成交额</div>
          <div className="mt-1 text-xl font-bold text-emerald-400">{fmtMoney(turnover.amount)}</div>
        </a>
      )}

      {/* 海外指数 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {globalSignals.map((idx) => (
          <a key={idx.name} href={globalMarketUrl(idx.name)} target="_blank" rel="noopener noreferrer"
            className="rounded-xl border border-white/10 bg-white/5 p-3 hover:border-amber-400/30 hover:bg-white/10 transition block">
            <div className="text-xs text-slate-400">{idx.name}</div>
            <div className="mt-1 text-base font-bold text-slate-50">{idx.price?.toFixed(2)}</div>
            <div className={`text-sm font-semibold ${pctColor(idx.pct)}`}>{fmtPct(idx.pct)}</div>
          </a>
        ))}
      </div>

      {/* 隔夜关联品种 */}
      {commodities.length > 0 && (
        <div>
          <div className="text-xs font-bold text-amber-300 mb-2">📦 隔夜关联品种（商品 / 汇率）</div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
            {commodities.map((c) => {
              const meta = COMMODITY_INDICES.find(ci => ci.name === c.name);
              return (
                <a key={c.name} href={commodityUrl(c.name)} target="_blank" rel="noopener noreferrer" className="block rounded-xl border border-white/10 bg-white/5 p-3 hover:border-amber-400/30 hover:bg-white/10 transition">
                  <div className="text-xs text-slate-400">{c.name}</div>
                  <div className="mt-1 text-base font-bold text-slate-50">{c.price?.toFixed(c.price > 100 ? 1 : c.price > 10 ? 2 : 4)}</div>
                  <div className={`text-sm font-semibold ${pctColor(c.pct)}`}>{fmtPct(c.pct)}</div>
                  {meta?.hint && (
                    <div className="mt-1 text-[11px] text-slate-500 leading-tight">{meta.hint}</div>
                  )}
                </a>
              );
            })}
          </div>
        </div>
      )}

      <div className="text-[11px] text-slate-600">
        全球指数和商品数据来自东方财富push2接口（真实数据）。联动提示为预设文字模板。
      </div>
    </section>
  );
}
