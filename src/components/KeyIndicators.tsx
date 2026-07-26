import { fmtMoney, fmtPct, pctColor } from "../lib/format";
import { marketBreadthUrl, fundFlowUrl, northboundUrl } from "../lib/realLinks";

export default function KeyIndicators({ data, loading }: { data?: any; loading?: boolean }) {
  const breadth = data?.breadth;
  const fund = data?.fundStructure?.structure;

  if (loading && !data) {
    return <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-slate-400">正在加载重要指标…</div>;
  }

  const indicators: Array<{ name: string; value: string; color?: string; url: string }> = [];

  if (breadth) {
    indicators.push(
      { name: "全市场股票总数", value: `${breadth.total} 只`, url: marketBreadthUrl() },
      { name: "上涨家数", value: `${breadth.up} 家`, color: "text-rose-400", url: marketBreadthUrl() },
      { name: "下跌家数", value: `${breadth.down} 家`, color: "text-emerald-400", url: marketBreadthUrl() },
      { name: "涨停家数", value: `${breadth.limitUp} 家`, color: "text-rose-300", url: marketBreadthUrl() },
      { name: "跌停家数", value: `${breadth.limitDown} 家`, color: "text-emerald-300", url: marketBreadthUrl() },
      { name: "平均涨跌幅", value: fmtPct(breadth.avgPct), color: pctColor(breadth.avgPct), url: marketBreadthUrl() },
    );
  }

  if (fund) {
    indicators.push(
      { name: "今日主力净流入", value: fmtMoney(fund.today?.mainNet), color: pctColor(fund.today?.mainNet), url: fundFlowUrl() },
      { name: "近5日主力净流入", value: fmtMoney(fund.mainNet5d), color: pctColor(fund.mainNet5d), url: fundFlowUrl() },
    );
    if (fund.north?.available) {
      indicators.push(
        { name: "北向资金净流入", value: fmtMoney(fund.north.net), color: pctColor(fund.north.net), url: northboundUrl() },
      );
    }
  }

  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-200">📊 重要指标监控 · 实时数据</h3>
        <span className="text-[10px] text-amber-300">所有数据来自东方财富公开接口真实抓取</span>
      </div>
      {indicators.length === 0 ? (
        <div className="text-sm text-slate-500">数据加载中或暂无数据…</div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {indicators.map((ind) => (
            <a key={ind.name} href={ind.url} target="_blank" rel="noopener noreferrer"
              className="rounded-lg border border-white/5 bg-black/20 p-4 hover:border-amber-400/20 hover:bg-black/30 transition">
              <div className="text-xs text-slate-400">{ind.name}</div>
              <div className={`mt-1 text-xl font-black ${ind.color || "text-slate-100"}`}>{ind.value}</div>
              <div className="mt-2 text-[10px] text-amber-300">点击查看详细数据 →</div>
            </a>
          ))}
        </div>
      )}
      <div className="mt-3 text-[11px] text-slate-600 leading-relaxed">
        说明：所有指标均来自东方财富公开接口真实抓取。每个指标卡片均可点击跳转到东方财富对应页面验证。
      </div>
    </section>
  );
}
