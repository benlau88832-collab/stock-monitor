import { useState } from "react";
import { fmtMoney, fmtPct, pctColor } from "../lib/format";
import { stockRealUrl } from "../lib/realLinks";
import { fetchStockOne } from "../lib/api";

export default function StockMonitor() {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  async function search(c?: string) {
    const target = (c ?? code).trim();
    if (!/^\d{6}$/.test(target)) {
      setError("请输入正确的 6 位股票代码，如 600519");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await fetchStockOne(target);
      if (!result) {
        setError("未找到该股票");
        setData(null);
      } else {
        setData(result);
        setCode(target);
      }
    } catch (e: any) {
      setError("网络请求失败：" + e?.message);
    } finally {
      setLoading(false);
    }
  }

  // 计算一票否决
  const vetoTriggered = data ? data.mainNet < 0 && data.smallNet > 0 && data.mainNet5d < 0 : false;
  const vetoReason = vetoTriggered
    ? "主力净流出+散户净流入+近5日持续流出=结构危险，不建议加仓"
    : data ? (data.mainNet > 0 ? "资金面暂无明显风险信号" : "资金面偏弱，需结合其他信号判断") : "";

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="输入6位股票代码，如 600519"
          className="w-64 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-amber-400"
        />
        <button
          onClick={() => search()}
          disabled={loading}
          className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-bold text-black hover:bg-amber-300 disabled:opacity-50"
        >
          {loading ? "查询中…" : "查询"}
        </button>
        {["600519", "300750", "000001", "002594", "601318", "000858"].map((c) => (
          <button key={c} onClick={() => search(c)} disabled={loading}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-400 hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed">
            {c}
          </button>
        ))}
      </div>

      {error && <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-rose-300">{error}</div>}

      {data && (
        <div className="space-y-4">
          <div className={`rounded-xl border p-4 ${vetoTriggered ? "border-rose-500/50 bg-rose-500/10" : "border-emerald-500/30 bg-emerald-500/5"}`}>
            <a href={stockRealUrl(data.code)} target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-between hover:opacity-80 transition">
              <div className="text-xl font-black text-slate-50">
                {data.name} <span className="text-sm text-slate-500">{data.code}</span>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-slate-50">{data.price}</div>
                <div className={`font-semibold ${pctColor(data.pct)}`}>{fmtPct(data.pct)}</div>
              </div>
            </a>
            <div className="text-[10px] text-amber-300">点击查看东方财富实时行情页面 →</div>
            <div className={`mt-3 rounded-lg px-3 py-2 text-sm font-semibold ${vetoTriggered ? "bg-rose-500/20 text-rose-200" : "bg-black/20 text-slate-300"}`}>
              {vetoTriggered ? "🚨 " : ""}{vetoReason}
            </div>
            <div className="mt-3">
              <a href={stockRealUrl(data.code)} target="_blank" rel="noopener noreferrer"
                className="rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-white/5 transition inline-block">
                打开东方财富行情页 →
              </a>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs text-slate-400">今日主力净额</div>
              <div className={`mt-1 text-lg font-bold ${pctColor(data.mainNet)}`}>{fmtMoney(data.mainNet)}</div>
              <div className="mt-2 text-xs text-slate-500">
                超大单 {fmtMoney(data.extraLargeNet)} / 大单 {fmtMoney(data.largeNet)}
              </div>
              <div className="text-xs text-slate-500">
                中单(游资) {fmtMoney(data.mediumNet)} / 小单(散户) {fmtMoney(data.smallNet)}
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs text-slate-400">近5日 / 近10日主力净额</div>
              <div className={`mt-1 text-lg font-bold ${pctColor(data.mainNet5d)}`}>{fmtMoney(data.mainNet5d)}</div>
              <div className={`text-sm font-semibold ${pctColor(data.mainNet10d)}`}>{fmtMoney(data.mainNet10d)}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs text-slate-400">交易指标</div>
              <div className="mt-1 text-sm text-slate-300">换手率 {data.turnoverRate?.toFixed(2)}%</div>
              <div className="text-sm text-slate-300">量比 {data.volumeRatio?.toFixed(2)}</div>
              <div className="text-sm text-slate-300">市盈率(动) {data.pe?.toFixed(2)}</div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
