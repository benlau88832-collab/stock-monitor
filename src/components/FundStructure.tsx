import { useState, useEffect } from "react";
import { fmtMoney, pctColor } from "../lib/format";
import { fundFlowUrl } from "../lib/realLinks";
import type { FundStructureData } from "../App";
import { fetchMarginHistory, type MarginHistoryRow } from "../lib/margin";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, LineChart, Line } from "recharts";
import BoardRankPanel from "./BoardRankPanel";
import FreshnessTag from "./FreshnessTag";

// ============== 分级预警 ==============
interface AlertLevel { label: string; border: string; bg: string; text: string; flash?: boolean }

function getAlertLevel(structure: FundStructureData["structure"]): AlertLevel {
  const { today, mainNet5d, mainNet10d, vetoTriggered } = structure;
  const mainOut = today.mainNet < 0;
  const retailIn = today.smallNet > 0;
  const persistent5 = mainNet5d < 0;
  const persistent10 = mainNet10d < 0;

  // 重度：主力流出+散户流入+5日10日均流出
  if (vetoTriggered || (mainOut && retailIn && persistent5 && persistent10)) {
    return { label: "🚨 重度背离 — 主力持续撤退，散户接盘", border: "border-rose-500/50", bg: "bg-rose-500/10", text: "text-rose-300", flash: true };
  }
  // 中度：主力流出+散户流入，或5日持续流出
  if ((mainOut && retailIn) || (mainOut && persistent5)) {
    return { label: "⚠️ 中度背离 — 资金结构偏弱，注意仓位控制", border: "border-amber-500/40", bg: "bg-amber-500/10", text: "text-amber-300" };
  }
  // 轻度：今日主力流出但幅度不大
  if (mainOut) {
    return { label: "💡 轻度背离 — 今日主力净流出，建议观察", border: "border-amber-500/30", bg: "bg-amber-500/10", text: "text-amber-300" };
  }
  // 健康
  if (today.mainNet > 0 && mainNet5d > 0) {
    return { label: "✅ 结构健康 — 资金面支持顺势操作", border: "border-emerald-500/30", bg: "bg-emerald-500/10", text: "text-emerald-300" };
  }
  // 中性
  return { label: "⚡ 结构分歧 — 今日与近5日方向不一致，建议观望", border: "border-amber-500/30", bg: "bg-amber-500/10", text: "text-amber-300" };
}

// ============== 出货强度 ==============
function shipIntensity(mainNet: number, turnover: number): { label: string; color: string } {
  if (turnover <= 0 || mainNet >= 0) return { label: "无出货", color: "text-slate-400" };
  const ratio = Math.abs(mainNet) / turnover * 100;
  if (ratio >= 5) return { label: `强（${ratio.toFixed(1)}%）`, color: "text-rose-400" };
  if (ratio >= 2) return { label: `中（${ratio.toFixed(1)}%）`, color: "text-amber-400" };
  return { label: `弱（${ratio.toFixed(1)}%）`, color: "text-emerald-400" };
}

// ============== 资金柱 ==============
function FundBar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = Math.abs(value) / max * 100;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-20 text-right text-slate-400">{label}</span>
      <div className="flex-1 h-4 bg-slate-800 rounded relative overflow-hidden">
        {value >= 0 ? (
          <div className="absolute left-1/2 h-full bg-rose-500/60 rounded-r" style={{ width: `${pct / 2}%` }} />
        ) : (
          <div className="absolute right-1/2 h-full bg-emerald-500/60 rounded-l" style={{ width: `${pct / 2}%` }} />
        )}
      </div>
      <span className={`w-24 text-right font-semibold ${pctColor(value)}`}>{fmtMoney(value)}</span>
    </div>
  );
}

// ============== 主组件 ==============
export default function FundStructure({ data, loading }: { data: FundStructureData | null; loading: boolean }) {
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [showChart, setShowChart] = useState(true);
  // 两融数据（独立拉取：T+1 数据，10分钟缓存，不占用主刷新管道）
  const [marginRows, setMarginRows] = useState<MarginHistoryRow[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchMarginHistory(5).then(rows => { if (!cancelled) setMarginRows(rows); });
    return () => { cancelled = true; };
  }, []);

  if (!data && loading) return <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-slate-400">正在加载资金结构…</div>;
  const structure = data?.structure;
  if (!structure) return <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-6 text-rose-300">资金结构数据获取失败</div>;

  const alert = getAlertLevel(structure);
  const t = structure.today;
  const max = Math.max(Math.abs(t.extraLargeNet), Math.abs(t.largeNet), Math.abs(t.mediumNet), Math.abs(t.smallNet), 1);
  const mainForce = t.mainNet;
  const retailForce = t.mediumNet + t.smallNet;
  const history = data?.history ?? [];
  const displayHistory = historyExpanded ? history : history.slice(0, 5);

  // 使用真实两市成交额计算出货强度
  const realTurnover = data?.turnoverAmount ?? 0;
  const ship = shipIntensity(t.mainNet, realTurnover);

  const chartData = [...history].reverse().map(h => ({
    date: h.date.slice(5),
    主力净流入: Math.round(h.mainNet / 1e8 * 100) / 100,
    散户净流入: Math.round((h.mediumNet + h.smallNet) / 1e8 * 100) / 100,
  }));

  // 20日走势数据
  const trendData = [...history].reverse().slice(-20).map(h => ({
    date: h.date.slice(5),
    净额: Math.round(h.mainNet / 1e8),
  }));

  return (
    <div className="space-y-4">
      {/* 分级预警 */}
      <div className={`rounded-xl border p-4 ${alert.border} ${alert.bg} ${alert.flash ? "animate-pulse" : ""}`}>
        <div className={`text-base font-black ${alert.text}`}>{alert.label}</div>
        <div className="mt-2 space-y-1">
          {structure.reasons.map((r: string, i: number) => (
            <div key={i} className="text-sm text-slate-300">• {r}</div>
          ))}
        </div>
        <div className="mt-2 text-sm font-semibold text-amber-300">可执行含义：{structure.actionHint}</div>
      </div>

      {/* 资金力量 + 出货强度 + 两融 */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        <a href={fundFlowUrl()} target="_blank" rel="noopener noreferrer" className="rounded-xl border border-white/10 bg-white/5 p-4 hover:bg-white/8 transition">
          <div className="text-xs text-slate-400">主力（超大单+大单）</div>
          <div className={`mt-1 text-2xl font-black ${pctColor(mainForce)}`}>{fmtMoney(mainForce)}</div>
          <div className="mt-1 text-[11px] text-slate-500">机构+大户 · 点击查看 →</div>
        </a>
        <a href={fundFlowUrl()} target="_blank" rel="noopener noreferrer" className="rounded-xl border border-white/10 bg-white/5 p-4 hover:bg-white/8 transition">
          <div className="text-xs text-slate-400">散户+游资（中单+小单）</div>
          <div className={`mt-1 text-2xl font-black ${pctColor(retailForce)}`}>{fmtMoney(retailForce)}</div>
          <div className="mt-1 text-[11px] text-slate-500">游资+散户 · 点击查看 →</div>
        </a>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-slate-400">主力占成交额比/出货强度</div>
          <div className={`mt-1 text-xl font-black ${ship.color}`}>{ship.label}</div>
          <div className="mt-1 text-[11px] text-slate-500">|主力净额|/成交额估算</div>
        </div>
        {/* 两融卡片：全市场融资余额 + 今日净买入（真实接口 RPTA_RZRQ_LSHJ） */}
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-slate-400">两融 · 融资余额</div>
          {marginRows.length >= 2 ? (
            <>
              <div className="mt-1 text-xl font-black text-slate-100">
                {(marginRows[0].rzBalance / 1e8).toFixed(0)}亿
              </div>
              <div className={`mt-1 text-[11px] font-bold ${marginRows[0].rzBalance >= marginRows[1].rzBalance ? "text-rose-400" : "text-emerald-400"}`}>
                {marginRows[0].rzBalance >= marginRows[1].rzBalance ? "▲ 融资客加仓" : "▼ 融资客减仓"}
                {" "}（{(Math.abs(marginRows[0].rzBalance - marginRows[1].rzBalance) / 1e8).toFixed(0)}亿/日）
              </div>
              <div className={`mt-0.5 text-[11px] ${marginRows[0].rzNet >= 0 ? "text-rose-300" : "text-emerald-300"}`}>
                今日净买入 {(marginRows[0].rzNet >= 0 ? "+" : "")}{(marginRows[0].rzNet / 1e8).toFixed(0)}亿
              </div>
              <div className="mt-0.5 text-[10px] text-slate-600">数据 {marginRows[0].date.slice(5)} · 全市场两融</div>
            </>
          ) : (
            <div className="mt-1 text-xl font-black text-slate-500">{marginRows.length === 0 ? "加载中…" : "—"}</div>
          )}
        </div>
      </div>

      {/* 资金分档 */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
        <div className="text-sm font-bold text-slate-200">今日资金结构分档 <FreshnessTag type="realtime" /></div>
        <FundBar label="超大单" value={t.extraLargeNet} max={max} />
        <FundBar label="大单" value={t.largeNet} max={max} />
        <FundBar label="中单(游资)" value={t.mediumNet} max={max} />
        <FundBar label="小单(散户)" value={t.smallNet} max={max} />
        <div className="text-xs text-slate-400">
          主力净流入合计：<span className={`font-semibold ${pctColor(t.mainNet)}`}>{fmtMoney(t.mainNet)}</span>
        </div>
      </div>

      {/* 连续性 + 20日走势 */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
        <div className="text-sm font-bold text-slate-200">资金连续性（趋势判断核心）</div>
        <div className="grid grid-cols-2 gap-3">
          <a href={fundFlowUrl()} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-black/20 p-3 hover:bg-black/30 transition">
            <div className="text-xs text-slate-400">近5日主力净流入</div>
            <div className={`mt-1 text-lg font-bold ${pctColor(structure.mainNet5d)}`}>{fmtMoney(structure.mainNet5d)}</div>
          </a>
          <a href={fundFlowUrl()} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-black/20 p-3 hover:bg-black/30 transition">
            <div className="text-xs text-slate-400">近10日主力净流入</div>
            <div className={`mt-1 text-lg font-bold ${pctColor(structure.mainNet10d)}`}>{fmtMoney(structure.mainNet10d)}</div>
          </a>
        </div>

        {/* 近20日主力资金走势折线图 */}
        {trendData.length > 0 && (
          <div>
            <div className="text-xs font-bold text-slate-300 mb-1">近20日主力资金净额走势（亿）</div>
            <div className="h-32 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 9 }} />
                  <YAxis tick={{ fill: "#94a3b8", fontSize: 9 }} />
                  <Tooltip contentStyle={{ backgroundColor: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 11 }} />
                  <ReferenceLine y={0} stroke="#475569" />
                  <Line type="monotone" dataKey="净额" stroke="#f43f5e" strokeWidth={2} dot={{ r: 2, fill: "#f43f5e" }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        <div className="rounded-lg bg-black/20 p-3 space-y-1">
          <div className="text-xs font-bold text-slate-300">连续性信号</div>
          <div className={`text-xs ${structure.mainNet5d < 0 ? "text-emerald-400" : "text-rose-400"}`}>
            • 近5日主力：{structure.mainNet5d < 0 ? "持续流出" : "持续流入"}
          </div>
          <div className={`text-xs ${structure.mainNet10d < 0 ? "text-emerald-400" : "text-rose-400"}`}>
            • 近10日主力：{structure.mainNet10d < 0 ? "持续流出" : "持续流入"}
          </div>
          <div className={`text-xs ${t.mainNet < 0 && t.smallNet > 0 ? "text-rose-400" : "text-emerald-400"}`}>
            • 今日主散对立：{t.mainNet < 0 && t.smallNet > 0 ? "主力出+散户进（危险）" : "未触发"}
          </div>
        </div>

        <div className="rounded-lg bg-black/20 p-3">
        </div>
      </div>

      {/* 历史快照 */}
      {history.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-bold text-slate-200">📊 近期资金快照（{history.length}天历史记录）</div>
            <div className="flex gap-2">
              <button onClick={() => setShowChart(v => !v)} className="rounded px-2 py-1 text-xs bg-white/10 text-slate-300 hover:bg-white/20">
                {showChart ? "表格视图" : "图表视图"}
              </button>
              <button onClick={() => setHistoryExpanded(v => !v)} disabled={showChart}
                className="rounded px-2 py-1 text-xs bg-white/10 text-slate-300 hover:bg-white/20 disabled:opacity-40">
                {historyExpanded ? "收起" : `展开全部 ${history.length} 天`}
              </button>
            </div>
          </div>

          {showChart && chartData.length > 0 && (
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 5, right: 5, left: -15, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                  <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} />
                  <Tooltip contentStyle={{ backgroundColor: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }} labelStyle={{ color: "#e2e8f0" }} />
                  <ReferenceLine y={0} stroke="#475569" />
                  <Bar dataKey="主力净流入" fill="#f43f5e" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="散户净流入" fill="#38bdf8" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <div className="flex justify-center gap-4 text-[11px] text-slate-500 mt-1">
                <span><span className="inline-block w-3 h-2 bg-rose-500 rounded mr-1" />主力净流入(亿)</span>
                <span><span className="inline-block w-3 h-2 bg-slate-400 rounded mr-1" />散户净流入(亿)</span>
              </div>
            </div>
          )}

          {!showChart && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/10 text-slate-400">
                    <th className="px-2 py-1.5 text-left">日期</th>
                    <th className="px-2 py-1.5 text-right">主力净流入</th>
                    <th className="px-2 py-1.5 text-right">超大单</th>
                    <th className="px-2 py-1.5 text-right">大单</th>
                    <th className="px-2 py-1.5 text-right">中单(游资)</th>
                    <th className="px-2 py-1.5 text-right">小单(散户)</th>
                  </tr>
                </thead>
                <tbody>
                  {displayHistory.map(h => (
                    <tr key={h.date} className="border-b border-white/5 hover:bg-white/5">
                      <td className="px-2 py-1.5 text-slate-300">{h.date}</td>
                      <td className={`px-2 py-1.5 text-right font-semibold ${pctColor(h.mainNet)}`}>{fmtMoney(h.mainNet)}</td>
                      <td className={`px-2 py-1.5 text-right ${pctColor(h.extraLargeNet)}`}>{fmtMoney(h.extraLargeNet)}</td>
                      <td className={`px-2 py-1.5 text-right ${pctColor(h.largeNet)}`}>{fmtMoney(h.largeNet)}</td>
                      <td className={`px-2 py-1.5 text-right ${pctColor(h.mediumNet)}`}>{fmtMoney(h.mediumNet)}</td>
                      <td className={`px-2 py-1.5 text-right ${pctColor(h.smallNet)}`}>{fmtMoney(h.smallNet)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!historyExpanded && history.length > 5 && !showChart && (
            <div className="text-center">
              <button onClick={() => setHistoryExpanded(true)} className="text-xs text-amber-300 hover:text-amber-200">
                ▼ 展开剩余 {history.length - 5} 天数据
              </button>
            </div>
          )}
        </div>
      )}

      {/* 板块资金流排行（升级版） */}
      {data?.boardRank && (data.boardRank.inflow.length > 0 || data.boardRank.outflow.length > 0) && (
        <BoardRankPanel inflow={data.boardRank.inflow} outflow={data.boardRank.outflow} />
      )}

      <div className="text-[11px] text-slate-600 leading-relaxed">
        数据来源：东方财富push2资金流接口。主力=超大单+大单净额；散户=小单净额；游资=中单净额。
        分级预警：轻度(今日主力出) → 中度(主力出+散户进/5日持续出) → 重度(全面背离+持续多日)。
        两融数据待接入全市场汇总接口(TODO)。
        <a href={fundFlowUrl()} target="_blank" rel="noopener noreferrer" className="text-amber-300 hover:underline ml-1">查看东方财富资金流向 →</a>
      </div>
    </div>
  );
}
