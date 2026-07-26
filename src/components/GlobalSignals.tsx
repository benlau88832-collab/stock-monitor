import { fmtPct, fmtMoney, pctColor } from "../lib/format";
import { globalMarketUrl } from "../lib/realLinks";
import type { GlobalData } from "../App";

export default function GlobalSignals({ data, loading }: { data: GlobalData | null; loading: boolean }) {
  const signals = data?.globalSignals ?? [];
  const turnover = data?.turnover;

  if (loading && signals.length === 0) {
    return <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-slate-400">正在加载全球市场数据…</div>;
  }

  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-200">🌍 全球信号 · 主要海外市场和重要指标监控</h3>
        <span className="text-[10px] text-amber-300">数据来自东方财富全球市场接口，实时更新</span>
      </div>

      {turnover?.available && (
        <a href="https://data.eastmoney.com/zjlx/detail.html" target="_blank" rel="noopener noreferrer"
          className="mb-4 block rounded-lg border border-white/5 bg-black/20 p-3 hover:bg-black/30 transition">
          <div className="text-xs text-slate-400">沪深两市成交额</div>
          <div className="mt-1 text-xl font-black text-slate-100">{fmtMoney(turnover.amount)}</div>
          <div className="text-[10px] text-amber-300/60">点击查看详情 →</div>
        </a>
      )}

      {signals.length === 0 ? (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-300">
          全球市场数据暂时无法获取，请稍后重试。数据源为东方财富全球市场接口。
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {signals.map((s) => (
            <a key={s.name} href={globalMarketUrl(s.name)} target="_blank" rel="noopener noreferrer"
              className="rounded-lg border border-white/5 bg-black/20 p-3 hover:border-amber-400/20 hover:bg-black/30 transition">
              <div className="text-xs text-slate-400">{s.name}</div>
              <div className="mt-1 text-base font-bold text-slate-100">{s.price?.toFixed(2) ?? "--"}</div>
              <div className={`text-sm font-semibold ${pctColor(s.pct)}`}>{fmtPct(s.pct)}</div>
              <div className="mt-1 text-[10px] text-amber-300">点击查看真实市场数据 →</div>
            </a>
          ))}
        </div>
      )}

      <div className="mt-3 text-[11px] text-slate-600">
        说明：全球市场数据用于判断A股外部环境。所有数据基于东方财富全球市场接口真实抓取，可点击各卡片跳转验证。
      </div>
    </section>
  );
}
