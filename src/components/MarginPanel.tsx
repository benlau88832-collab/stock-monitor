// 两融观察面板：全市场融资融券总览
// 展示：融资余额 / 今日融资净买入 / 融资买入额 / 融券余额 + 历史趋势图
// 数据：RPTA_RZRQ_LSHJ（沪深合计，T+1 更新）
// 业务含义：融资余额上升 = 融资客加杠杆看多；净买入为正 = 当日融资客净增仓

import { useEffect, useState } from "react";
import { ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { fetchMarginHistory, type MarginHistoryRow } from "../lib/margin";

const RANGES = [
  { key: 20, label: "1月" },
  { key: 60, label: "3月" },
  { key: 120, label: "半年" },
  { key: 250, label: "1年" },
];

function fmtYi(v: number): string {
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)}万亿`;
  return `${(v / 1e8).toFixed(0)}亿`;
}

export default function MarginPanel() {
  const [history, setHistory] = useState<MarginHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState(60);

  useEffect(() => {
    let cancelled = false;
    fetchMarginHistory(250).then(rows => {
      if (cancelled) return;
      setHistory(rows);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const latest = history[0];
  const prev = history[1];
  const trend = [...history].reverse().slice(-range).map(r => ({
    date: r.date.slice(5),              // MM-DD
    rzBalance: Math.round(r.rzBalance / 1e8),   // 亿
    rzNet: Math.round(r.rzNet / 1e8),           // 亿
    rqBalance: Math.round(r.rqBalance / 1e8),
  }));

  const rzDelta = latest && prev ? latest.rzBalance - prev.rzBalance : null;
  const netDelta = latest && prev ? latest.rzNet - prev.rzNet : null;

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-bold text-slate-200">📊 两融观察（全市场）</h3>
          <div className="text-[11px] text-slate-500">
            沪深两市融资融券汇总 · 交易所 T+1 披露{latest ? ` · 数据截至 ${latest.date}` : ""}
          </div>
        </div>
        <div className="flex gap-1">
          {RANGES.map(r => (
            <button key={r.key} onClick={() => setRange(r.key)}
              className={`rounded px-2 py-0.5 text-[11px] ${range === r.key ? "bg-amber-500/20 text-amber-300" : "bg-white/5 text-slate-400 hover:bg-white/10"}`}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* 指标卡 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="text-[11px] text-slate-400">融资余额（融资客持仓）</div>
          <div className="mt-1 text-xl font-black text-slate-100">{latest ? fmtYi(latest.rzBalance) : "…"}</div>
          {rzDelta != null && (
            <div className={`mt-0.5 text-[11px] font-bold ${rzDelta >= 0 ? "text-rose-400" : "text-emerald-400"}`}>
              {rzDelta >= 0 ? "▲" : "▼"} {fmtYi(Math.abs(rzDelta))} 较前日
            </div>
          )}
        </div>
        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="text-[11px] text-slate-400">今日融资净买入</div>
          <div className={`mt-1 text-xl font-black ${latest && latest.rzNet >= 0 ? "text-rose-400" : "text-emerald-400"}`}>
            {latest ? (latest.rzNet >= 0 ? "+" : "") + fmtYi(latest.rzNet) : "…"}
          </div>
          {netDelta != null && (
            <div className="mt-0.5 text-[11px] text-slate-500">
              较前日 {netDelta >= 0 ? "+" : ""}{fmtYi(netDelta)}
            </div>
          )}
          <div className="mt-0.5 text-[10px] text-slate-600">买入−偿还 = 融资客当日净增仓</div>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="text-[11px] text-slate-400">融资买入额（当日）</div>
          <div className="mt-1 text-xl font-black text-slate-100">{latest ? fmtYi(latest.rzBuy) : "…"}</div>
          <div className="mt-0.5 text-[10px] text-slate-600">融资客当日借钱买入量</div>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="text-[11px] text-slate-400">融券余额（做空盘）</div>
          <div className="mt-1 text-xl font-black text-slate-100">{latest ? fmtYi(latest.rqBalance) : "…"}</div>
          <div className="mt-0.5 text-[10px] text-slate-600">融券余额小 = 做空力量弱</div>
        </div>
      </div>

      {/* 趋势图 */}
      <div className="mt-3 h-56">
        {loading ? (
          <div className="flex h-full items-center justify-center text-xs text-slate-500">两融数据加载中…</div>
        ) : trend.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-amber-300">两融历史数据暂不可用，请稍后刷新</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={trend} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
              <CartesianGrid stroke="#ffffff10" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={30} />
              <YAxis yAxisId="left" tick={{ fill: "#64748b", fontSize: 10 }} tickLine={false} axisLine={false} width={50} />
              <YAxis yAxisId="right" orientation="right" tick={{ fill: "#475569", fontSize: 10 }} tickLine={false} axisLine={false} width={45} />
              <Tooltip
                contentStyle={{ background: "#0b0f1a", border: "1px solid #ffffff20", borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: "#94a3b8" }}
                formatter={(value: any) => {
                  const v = Number(value);
                  return fmtYi(v * 1e8);
                }}
              />
              <ReferenceLine yAxisId="left" y={0} stroke="#ffffff15" />
              <Bar yAxisId="right" dataKey="rzNet" name="融资净买入" fill="#f59e0b55" barSize={range > 120 ? 2 : 4} />
              <Line yAxisId="left" type="monotone" dataKey="rzBalance" name="融资余额" stroke="#f43f5e" strokeWidth={1.8} dot={false} />
              <Line yAxisId="left" type="monotone" dataKey="rqBalance" name="融券余额" stroke="#38bdf8" strokeWidth={1.2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* 解读 */}
      <div className="mt-2 rounded-lg bg-white/5 px-3 py-2 text-[11px] text-slate-400 leading-relaxed">
        <b className="text-slate-300">怎么看：</b>
        融资余额 = 融资客借钱持有的股票市值，余额持续上升说明杠杆资金在加仓看多；融资净买入为正 = 当日买入多于偿还。
        <span className="text-rose-300">融资余额快速上升的个股（5日增速快于10日）</span>通常预示后续有表现，可在个股雷达查看每只自选股的融资信号。
      </div>
    </div>
  );
}
