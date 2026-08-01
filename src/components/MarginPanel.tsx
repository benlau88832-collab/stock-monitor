// 两融观察面板：全市场融资融券总览（券商风格 v9.11 重做）
// 4 顶部指标卡 + 主图（两融余额走势）+ 副图（融资资金流）+ 3M/6M/1Y/3Y 切换
// 数据：RPTA_RZRQ_LSHJ（沪深合计，T+1 更新）
// 业务含义：融资余额上升 = 融资客加杠杆看多；净买入为正 = 当日融资客净增仓

import { useEffect, useState, useMemo } from "react";
import { ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from "recharts";
import { fetchMarginHistory, type MarginHistoryRow } from "../lib/margin";

// 顶部卡切换区间（用户截图里的 3M/6M/1Y/3Y 风格）
const TOP_RANGES = [
  { key: 30, label: "1月" },
  { key: 90, label: "3月" },
  { key: 180, label: "半年" },
  { key: 365, label: "1年" },
];

const CHART_RANGES = [
  { key: 90, label: "3M" },
  { key: 180, label: "6M" },
  { key: 365, label: "1Y" },
  { key: 1095, label: "3Y" },
];

// 数值格式化工具：万亿/亿，保留 1-2 位小数
function fmtYi(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 1e12) return `${(v / 1e12).toFixed(2)}万亿`;
  return `${(v / 1e8).toFixed(digits)}亿`;
}

// 同比/环比变化文本与颜色
function deltaText(curr: number | undefined, prev: number | undefined) {
  if (curr == null || prev == null) return null;
  const d = curr - prev;
  const dir = d > 0 ? "up" : d < 0 ? "down" : "flat";
  return { dir, value: d, text: `${d > 0 ? "+" : ""}${fmtYi(d)} 较前日` };
}

export default function MarginPanel() {
  const [history, setHistory] = useState<MarginHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [topRange, setTopRange] = useState(90);    // 顶部 4 卡用 1 月累计
  const [chartRange, setChartRange] = useState(90); // 主图/副图用 3M

  useEffect(() => {
    let cancelled = false;
    fetchMarginHistory(1095).then(rows => {
      if (cancelled) return;
      setHistory(rows);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  // ========== 关键指标计算 ==========
  const latest = history[0];
  const prev = history[1];

  // 顶部 4 卡的计算窗口
  const topWindow = useMemo(() => history.slice(0, topRange), [history, topRange]);
  const topWindowSum = topWindow.length > 0 ? {
    rzBalance: topWindow[topWindow.length - 1]?.rzBalance ?? 0, // 起点余额（用于区间累计）
    rzBuySum: topWindow.reduce((s, r) => s + r.rzBuy, 0),
    rzNetSum: topWindow.reduce((s, r) => s + r.rzNet, 0),
  } : null;

  // 主图/副图序列（升序）
  const trend = useMemo(() => {
    const sliced = [...history].reverse().slice(-chartRange);
    return sliced.map(r => ({
      date: r.date.slice(5), // MM-DD
      ts: new Date(r.date).getTime(),
      rzBalance: Math.round(r.rzBalance / 1e8),  // 融资余额（亿）
      rqBalance: Math.round(r.rqBalance / 1e8),  // 融券余量（亿）
      rzBuy: Math.round(r.rzBuy / 1e8),          // 融资买入额（亿）
      rzNet: Math.round(r.rzNet / 1e8),          // 融资净买入（亿）
      netColor: r.rzNet >= 0 ? "ef444488" : "10b98188", // recharts Bar fill 用字符串
      netDisplay: r.rzNet >= 0 ? "净买入" : "净偿还",
    }));
  }, [history, chartRange]);

  // 顶部 4 卡：与前日对比
  const dBalance = latest && prev ? deltaText(latest.rzBalance, prev.rzBalance) : null;        // ① 两融余额
  const dRzBalance = latest && prev ? deltaText(latest.rzBalance, prev.rzBalance) : null;       // ② 融资余额 = ①（两融合计=融资+融券，但融券占比小≈融资）
  const dRzBuy = latest && prev ? deltaText(latest.rzBuy, prev.rzBuy) : null;                     // ③ 融资买入额
  const dRqBalance = latest && prev ? deltaText(latest.rqBalance, prev.rqBalance) : null;        // ④ 融券余量金额

  // ============== 顶部 4 卡渲染 ==============
  function renderTopCard(label: string, sub: string, value: number | undefined, delta: ReturnType<typeof deltaText>, color: "blue" | "red") {
    const valColor = color === "red" ? "text-rose-400" : "text-sky-400";
    const isUp = delta?.dir === "up";
    const isDown = delta?.dir === "down";
    return (
      <div className="rounded-lg border border-white/10 bg-black/20 p-3">
        <div className="text-[11px] text-slate-400">{label}</div>
        <div className={`mt-1 text-2xl font-black ${valColor}`}>{value != null ? fmtYi(value, 1) : "—"}</div>
        <div className="mt-0.5 text-[11px] font-semibold">
          {delta ? (
            <span className={isUp ? "text-emerald-400" : isDown ? "text-rose-400" : "text-slate-400"}>
              {isUp ? "▲" : isDown ? "▼" : "—"} {delta.text}
            </span>
          ) : <span className="text-slate-500">—</span>}
        </div>
        <div className="mt-0.5 text-[10px] text-slate-600">{sub}</div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
      {/* 头部：标题 + 时间窗切换 */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="text-sm font-bold text-slate-200">📊 两融观察（全市场）</div>
          <div className="text-[11px] text-slate-500">
            沪深两市融资融券汇总 · 交易所 T+1 披露
            {latest ? ` · 数据截至 ${latest.date}` : ""}
          </div>
        </div>
        <div className="flex gap-1">
          {TOP_RANGES.map(r => (
            <button key={r.key} onClick={() => setTopRange(r.key)}
              className={`rounded px-2 py-0.5 text-[11px] ${topRange === r.key ? "bg-amber-500/20 text-amber-300" : "bg-white/5 text-slate-400 hover:bg-white/10"}`}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* 顶部 4 卡（融资融券余额 / 融资余额 / 融资买入额 / 融券余量） */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {renderTopCard(
          "融资融券余额（融资客+融券）",
          `${latest ? latest.date : ""} 收盘`,
          latest?.rzBalance != null ? latest.rzBalance + (latest.rqBalance || 0) : undefined,
          dBalance,
          "blue",
        )}
        {renderTopCard(
          "融资余额（融资客持仓）",
          `较前日 ${dRzBalance ? (dRzBalance.value > 0 ? "+" : "") + fmtYi(dRzBalance.value) : "—"}`,
          latest?.rzBalance,
          dRzBalance,
          "red",
        )}
        {renderTopCard(
          "融资买入额（当日）",
          "融资客借钱买入量",
          latest?.rzBuy,
          dRzBuy,
          "red",
        )}
        {renderTopCard(
          "融券余量金额（做空盘）",
          "融券余额小 = 做空力量弱",
          latest?.rqBalance,
          dRqBalance,
          "blue",
        )}
      </div>

      {/* 区间累计条（顶部卡时间窗生效） */}
      {topWindowSum && (
        <div className="rounded-lg border border-white/5 bg-white/5 px-3 py-1.5 text-[11px] text-slate-400 flex items-center gap-4 flex-wrap">
          <span>区间累计：
            <b className="text-rose-400">{fmtYi(topWindowSum.rzBuySum)}</b> 融资买入，
            <b className={topWindowSum.rzNetSum >= 0 ? "text-rose-400" : "text-emerald-400"}>
              {topWindowSum.rzNetSum >= 0 ? "+" : ""}{fmtYi(topWindowSum.rzNetSum)}
            </b> 净买入
          </span>
        </div>
      )}

      {/* 主图：两融余额走势（融资余额折线 + 融券余量柱状，双 Y 轴） */}
      <div className="rounded-lg border border-white/10 bg-black/20 p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[11px] font-bold text-slate-300">两融余额走势 <span className="text-slate-500">（融资余额左轴 · 融券余量右轴）</span></div>
          <div className="flex gap-1">
            {CHART_RANGES.map(r => (
              <button key={r.key} onClick={() => setChartRange(r.key)}
                className={`rounded px-2 py-0.5 text-[10px] ${chartRange === r.key ? "bg-amber-500/20 text-amber-300" : "bg-white/5 text-slate-400 hover:bg-white/10"}`}>
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <div className="h-56">
          {loading ? (
            <div className="flex h-full items-center justify-center text-xs text-slate-500">两融数据加载中…</div>
          ) : trend.length === 0 ? (
            <div className="flex h-full items-center justify-center text-xs text-amber-300">两融历史数据暂不可用，请稍后刷新</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={trend} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid stroke="#ffffff10" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={30} />
                <YAxis yAxisId="left" tick={{ fill: "#64748b", fontSize: 10 }} tickLine={false} axisLine={false} width={50} />
                <YAxis yAxisId="right" orientation="right" tick={{ fill: "#475569", fontSize: 10 }} tickLine={false} axisLine={false} width={45} />
                <Tooltip
                  contentStyle={{ background: "#0b0f1a", border: "1px solid #ffffff20", borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: "#94a3b8" }}
                  formatter={(value: any) => fmtYi(Number(value) * 1e8)}
                />
                <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
                <ReferenceLine yAxisId="left" y={0} stroke="#ffffff15" />
                <Bar yAxisId="right" dataKey="rqBalance" name="融券余量" fill="#38bdf855" barSize={chartRange > 365 ? 1 : 3} />
                <Line yAxisId="left" type="monotone" dataKey="rzBalance" name="融资余额" stroke="#f43f5e" strokeWidth={1.8} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* 副图：融资资金流（融资买入额柱+融资偿还额柱+净买入柱） */}
      <div className="rounded-lg border border-white/10 bg-black/20 p-3">
        <div className="text-[11px] font-bold text-slate-300 mb-2">融资资金流 <span className="text-slate-500">（净买入=买入-偿还，红涨绿跌）</span></div>
        <div className="h-44">
          {loading ? (
            <div className="flex h-full items-center justify-center text-xs text-slate-500">加载中…</div>
          ) : trend.length === 0 ? (
            <div className="flex h-full items-center justify-center text-xs text-amber-300">暂无数据</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={trend} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid stroke="#ffffff10" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={30} />
                <YAxis yAxisId="left" tick={{ fill: "#64748b", fontSize: 10 }} tickLine={false} axisLine={false} width={50} />
                <Tooltip
                  contentStyle={{ background: "#0b0f1a", border: "1px solid #ffffff20", borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: "#94a3b8" }}
                  formatter={(value: any) => fmtYi(Number(value) * 1e8)}
                />
                <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
                <ReferenceLine yAxisId="left" y={0} stroke="#ffffff15" />
                {/* 净买入柱：红/绿叠加（用 Bar 背景 + 条件颜色） */}
                <Bar yAxisId="left" dataKey="rzBuy" name="融资买入额" fill="#f43f5e66" barSize={chartRange > 365 ? 1 : 3} />
                <Bar yAxisId="left" dataKey="rzNet" name="融资净买入" fill="ef444488" shape={(props: any) => {
                  // recharts shape prop 自定义柱颜色（净买入红/净偿还绿）
                  const fill = props.netColor || "#ef444488";
                  return <rect {...props} fill={fill} />;
                }} barSize={chartRange > 365 ? 1 : 2} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* 解读 */}
      <div className="rounded-lg bg-white/5 px-3 py-2 text-[11px] text-slate-400 leading-relaxed">
        <b className="text-slate-300">怎么看：</b>
        融资余额 = 融资客借钱持有的股票市值，余额持续上升说明杠杆资金在加仓看多；
        融资净买入为正 = 当日买入多于偿还。
        <span className="text-rose-300">融资余额快速上升的个股（5日增速快于10日）</span>通常预示后续有表现，可在个股雷达查看每只自选股的融资信号。
      </div>
    </div>
  );
}