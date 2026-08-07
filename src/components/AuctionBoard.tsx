// 竞价台（v9.19-F2）
// 展示 昨日涨停股 + 自选股 在开盘（竞价结果）的强度排行
// 高亮：竞价即封板（red）/ 竞价大幅低开（green）
// 数据近似说明：东财无竞价量字段，用 今开涨幅 + 首封时间 近似早盘强度
import { useState, useEffect, useCallback } from "react";
import { fetchAuctionBoard, type AuctionItem } from "../lib/auction";
import { stockRealUrl } from "../lib/realLinks";
import FreshnessTag from "./FreshnessTag";

interface Props {
  /** 昨日涨停股（code,name,hybk） */
  yesterdayZt?: Array<{ code: string; name: string }>;
  /** 今日涨停池（首封时间/连板） */
  todayZt?: Array<{ c: string; n: string; fbt: number; lbc: number }>;
  autoRefresh?: boolean;
}

export default function AuctionBoard({ yesterdayZt, todayZt, autoRefresh }: Props) {
  const [items, setItems] = useState<AuctionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!yesterdayZt || yesterdayZt.length === 0) {
      setError("暂无昨日涨停数据，无法生成竞价台");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const codes = yesterdayZt.slice(0, 40).map(z => z.code);
      const result = await fetchAuctionBoard(codes, todayZt);
      setItems(result);
    } catch {
      setError("竞价数据获取失败");
    } finally {
      setLoading(false);
    }
  }, [yesterdayZt, todayZt]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(load, 30000); // 30s 刷新
    return () => clearInterval(t);
  }, [autoRefresh, load]);

  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-950/10 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-amber-300">🌅 竞价台（开盘强度）</span>
          <FreshnessTag type="near_realtime" text="开盘竞价结果" />
          <span className="text-[10px] text-slate-600">数据源：腾讯行情（实时涨幅+竞价额+换手）</span>
        </div>
        <button onClick={load} disabled={loading}
          className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-white/20 disabled:opacity-40">
          {loading ? "…" : "刷新"}
        </button>
      </div>

      {error && <div className="text-[10px] text-amber-400">⚠️ {error}</div>}

      {items.length > 0 ? (
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-[11px]">
            <thead><tr className="text-slate-500">
              <th className="px-1 py-0.5 text-left">股票</th>
              <th className="px-1 py-0.5 text-right">竞价涨幅</th>
              <th className="px-1 py-0.5 text-right">实时涨幅</th>
              <th className="px-1 py-0.5 text-right">现价</th>
              <th className="px-1 py-0.5 text-right">竞价额</th>
              <th className="px-1 py-0.5 text-right">换手%</th>
              <th className="px-1 py-0.5 text-center">首封</th>
              <th className="px-1 py-0.5 text-center">连板</th>
              <th className="px-1 py-0.5 text-center">强度</th>
            </tr></thead>
            <tbody>
              {items.slice(0, 15).map(it => (
                <tr key={it.code} className="border-t border-white/5">
                  <td className="px-1 py-0.5">
                    <a href={stockRealUrl(it.code)} target="_blank" rel="noopener noreferrer" className="text-slate-200 hover:text-amber-300">
                      {it.name || it.code}
                    </a>
                    <span className="text-slate-600 ml-1">{it.code}</span>
                  </td>
                  <td className={`px-1 py-0.5 text-right font-mono font-bold ${
                    it.auctionPct >= 0 ? "text-rose-400" : "text-emerald-400"
                  }`}>
                    {it.auctionPct >= 0 ? "+" : ""}{it.auctionPct.toFixed(2)}%
                  </td>
                  {/* v9.26.14：实时涨幅（当前价 vs 昨收） */}
                  <td className={`px-1 py-0.5 text-right font-mono font-bold ${
                    it.changePct >= 0 ? "text-rose-400" : "text-emerald-400"
                  }`}
                    title={`现价${it.currentPrice.toFixed(2)} 涨跌额${it.changeAmount >= 0 ? "+" : ""}${it.changeAmount.toFixed(2)}`}>
                    {it.changePct >= 0 ? "+" : ""}{it.changePct.toFixed(2)}%
                  </td>
                  <td className="px-1 py-0.5 text-right font-mono text-slate-300">
                    {it.currentPrice > 0 ? it.currentPrice.toFixed(2) : "—"}
                  </td>
                  <td className="px-1 py-0.5 text-right font-mono text-slate-300">
                    {it.openAmountYi > 0 ? `${it.openAmountYi.toFixed(2)}亿` : "—"}
                  </td>
                  <td className="px-1 py-0.5 text-right font-mono text-slate-400">
                    {it.turnoverRate > 0 ? it.turnoverRate.toFixed(2) : "—"}
                  </td>
                  <td className="px-1 py-0.5 text-center text-slate-400">{it.firstBoardTime ?? "—"}</td>
                  <td className="px-1 py-0.5 text-center text-slate-400">{it.boardCount ? `${it.boardCount}板` : "—"}</td>
                  <td className="px-1 py-0.5 text-center">
                    {it.auctionLimitUp ? (
                      <span className="rounded bg-rose-500/20 px-1 py-0.5 text-xs font-bold text-rose-300">⚡竞价涨停</span>
                    ) : it.auctionGapDown ? (
                      <span className="rounded bg-emerald-500/20 px-1 py-0.5 text-xs font-bold text-emerald-300">大幅低开</span>
                    ) : (
                      <span className={`font-mono ${it.strength >= 70 ? "text-rose-300" : it.strength >= 40 ? "text-amber-300" : "text-slate-400"}`}>
                        {it.strength}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : !error && (
        <div className="text-[10px] text-slate-500">{loading ? "加载中…" : "暂无竞价数据"}</div>
      )}

      <div className="text-xs text-slate-600">仅用于早盘强度观察，非交易依据 · 竞价数据为开盘首笔近似</div>
    </div>
  );
}
