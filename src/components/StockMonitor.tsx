"use client";

import { useState } from "react";
import { fmtMoney, fmtPct, pctColor } from "@/lib/format";

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
      const res = await fetch(`/api/stock/${target}`);
      const json = await res.json();
      if (!res.ok || json.message) {
        setError(json.message || "获取失败");
        setData(null);
      } else {
        setData(json);
        setCode(target);
      }
    } catch (e: any) {
      setError("网络请求失败：" + e?.message);
    } finally {
      setLoading(false);
    }
  }

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
        {["600519", "300750", "000001", "002594"].map((c) => (
          <button
            key={c}
            onClick={() => search(c)}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-400 hover:bg-white/5"
          >
            {c}
          </button>
        ))}
      </div>

      {error && <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-rose-300">{error}</div>}

      {data && (
        <div className="space-y-4">
          <div
            className={`rounded-xl border p-4 ${
              data.vetoTriggered ? "border-rose-500/50 bg-rose-500/10" : "border-emerald-500/30 bg-emerald-500/5"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="text-xl font-black text-slate-50">
                {data.quote.name} <span className="text-sm text-slate-500">{data.quote.code}</span>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-slate-50">{data.quote.price}</div>
                <div className={`font-semibold ${pctColor(data.quote.pct)}`}>{fmtPct(data.quote.pct)}</div>
              </div>
            </div>
            <div className={`mt-3 rounded-lg px-3 py-2 text-sm font-semibold ${data.vetoTriggered ? "bg-rose-500/20 text-rose-200" : "bg-black/20 text-slate-300"}`}>
              {data.vetoTriggered ? "🚨 " : ""}
              {data.vetoReason}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs text-slate-400">今日主力净额</div>
              <div className={`mt-1 text-lg font-bold ${pctColor(data.quote.mainNet)}`}>{fmtMoney(data.quote.mainNet)}</div>
              <div className="mt-2 text-xs text-slate-500">
                超大单 {fmtMoney(data.quote.extraLargeNet)} / 大单 {fmtMoney(data.quote.largeNet)}
              </div>
              <div className="text-xs text-slate-500">
                中单(游资) {fmtMoney(data.quote.mediumNet)} / 小单(散户) {fmtMoney(data.quote.smallNet)}
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs text-slate-400">近5日 / 近10日主力净额</div>
              <div className={`mt-1 text-lg font-bold ${pctColor(data.quote.mainNet5d)}`}>{fmtMoney(data.quote.mainNet5d)}</div>
              <div className={`text-sm font-semibold ${pctColor(data.quote.mainNet10d)}`}>{fmtMoney(data.quote.mainNet10d)}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs text-slate-400">股权质押比例</div>
              <div className="mt-1 text-lg font-bold text-slate-100">
                {data.pledge?.ratio != null ? `${data.pledge.ratio}%` : "无披露/数据不完整"}
              </div>
              <div className="text-xs text-slate-500">{data.pledge?.date || ""}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="mb-2 text-sm font-semibold text-slate-200">近期减持相关公告</div>
              {data.announcements?.reduction?.length ? (
                data.announcements.reduction.map((a: any, i: number) => (
                  <div key={i} className="mb-1 rounded bg-rose-500/10 px-2 py-1 text-xs text-rose-300">
                    {a.date} · {a.title}
                  </div>
                ))
              ) : (
                <div className="text-xs text-emerald-400">未发现减持相关公告</div>
              )}
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="mb-2 text-sm font-semibold text-slate-200">监管 / 问询相关公告</div>
              {data.announcements?.regulatory?.length ? (
                data.announcements.regulatory.map((a: any, i: number) => (
                  <div key={i} className="mb-1 rounded bg-orange-500/10 px-2 py-1 text-xs text-orange-300">
                    {a.date} · {a.title}
                  </div>
                ))
              ) : (
                <div className="text-xs text-emerald-400">未发现监管问询类公告</div>
              )}
            </div>
          </div>

          <div className="text-[11px] text-slate-500">数据来源与计算逻辑：{data.source}</div>
        </div>
      )}
    </section>
  );
}
