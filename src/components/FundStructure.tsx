import { useState } from "react";
import { fmtMoney, pctColor } from "../lib/format";
import { fundFlowUrl } from "../lib/realLinks";
import type { FundStructureData } from "../App";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

const VERDICT_STYLE: Record<string, { label: string; border: string; bg: string; text: string }> = {
  danger: { label: "🚨 结构危险（一票否决）", border: "border-rose-500/50", bg: "bg-rose-500/10", text: "text-rose-300" },
  warning: { label: "⚠️ 结构偏弱（需警惕）", border: "border-amber-500/40", bg: "bg-amber-500/10", text: "text-amber-300" },
  caution: { label: "⚡ 结构分歧（观望为主）", border: "border-yellow-500/30", bg: "bg-yellow-500/10", text: "text-yellow-300" },
  healthy: { label: "✅ 结构健康（资金面支持）", border: "border-emerald-500/30", bg: "bg-emerald-500/10", text: "text-emerald-300" },
  unknown: { label: "❓ 数据不足", border: "border-slate-500/30", bg: "bg-slate-500/10", text: "text-slate-300" },
};

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

export default function FundStructure({ data, loading }: { data: FundStructureData | null; loading: boolean }) {
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [showChart, setShowChart] = useState(true);

  if (!data && loading) {
    return <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-slate-400">正在加载资金结构…</div>;
  }
  const structure = data?.structure;
  if (!structure) {
    return <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-6 text-rose-300">资金结构数据获取失败</div>;
  }

  const style = VERDICT_STYLE[structure.verdict] ?? VERDICT_STYLE.unknown;
  const t = structure.today;
  const max = Math.max(Math.abs(t.extraLargeNet), Math.abs(t.largeNet), Math.abs(t.mediumNet), Math.abs(t.smallNet), 1);
  const mainForce = t.mainNet;
  const retailForce = t.mediumNet + t.smallNet;
  const history = data?.history ?? [];
  const displayHistory = historyExpanded ? history : history.slice(0, 5);

  // Chart data for history
  const chartData = [...history].reverse().map(h => ({
    date: h.date.slice(5),
    主力净流入: Math.round(h.mainNet / 1e8 * 100) / 100,
    散户净流入: Math.round((h.mediumNet + h.smallNet) / 1e8 * 100) / 100,
  }));

  return (
    <div className="space-y-4">
      {/* 一票否决判断 */}
      <div className={`rounded-xl border p-4 ${style.border} ${style.bg}`}>
        <div className={`text-base font-black ${style.text}`}>{style.label}</div>
        <div className="mt-2 space-y-1">
          {structure.reasons.map((r: string, i: number) => (
            <div key={i} className="text-sm text-slate-300">• {r}</div>
          ))}
        </div>
        <div className="mt-2 text-sm font-semibold text-amber-300">
          可执行含义：{structure.actionHint}
        </div>
      </div>

      {/* 资金力量对比 */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <a href={fundFlowUrl()} target="_blank" rel="noopener noreferrer" className="rounded-xl border border-white/10 bg-white/5 p-4 hover:bg-white/8 transition">
          <div className="text-xs text-slate-400">主力（超大单+大单）</div>
          <div className={`mt-1 text-2xl font-black ${pctColor(mainForce)}`}>{fmtMoney(mainForce)}</div>
          <div className="mt-1 text-[10px] text-slate-500">机构 + 大户 · 点击查看详细 →</div>
        </a>
        <a href={fundFlowUrl()} target="_blank" rel="noopener noreferrer" className="rounded-xl border border-white/10 bg-white/5 p-4 hover:bg-white/8 transition">
          <div className="text-xs text-slate-400">散户+游资（中单+小单）</div>
          <div className={`mt-1 text-2xl font-black ${pctColor(retailForce)}`}>{fmtMoney(retailForce)}</div>
          <div className="mt-1 text-[10px] text-slate-500">游资 + 散户 · 点击查看详细 →</div>
        </a>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-slate-400">主力/散户力量对比</div>
          <div className={`mt-1 text-2xl font-black ${
            mainForce > 0 && retailForce < 0 ? "text-emerald-400" :
            mainForce < 0 && retailForce > 0 ? "text-rose-400" : "text-amber-300"
          }`}>
            {mainForce > 0 && retailForce < 0 ? "主力吸筹" :
             mainForce < 0 && retailForce > 0 ? "主力出货" :
             mainForce > 0 && retailForce > 0 ? "共振做多" :
             mainForce < 0 && retailForce < 0 ? "共振做空" : "方向不明"}
          </div>
        </div>
      </div>

      {/* 资金分档 */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
        <div className="text-sm font-bold text-slate-200">今日资金结构分档</div>
        <FundBar label="超大单" value={t.extraLargeNet} max={max} />
        <FundBar label="大单" value={t.largeNet} max={max} />
        <FundBar label="中单(游资)" value={t.mediumNet} max={max} />
        <FundBar label="小单(散户)" value={t.smallNet} max={max} />
        <div className="text-xs text-slate-400">
          主力净流入合计：<span className={`font-semibold ${pctColor(t.mainNet)}`}>{fmtMoney(t.mainNet)}</span>
        </div>
      </div>

      {/* 连续性 */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
        <div className="text-sm font-bold text-slate-200">资金连续性（趋势判断核心）</div>
        <div className="grid grid-cols-2 gap-3">
          <a href={fundFlowUrl()} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-black/20 p-3 hover:bg-black/30 transition">
            <div className="text-xs text-slate-400">近5日主力净流入</div>
            <div className={`mt-1 text-lg font-bold ${pctColor(structure.mainNet5d)}`}>{fmtMoney(structure.mainNet5d)}</div>
            <div className="text-[10px] text-amber-300/60">点击查看 →</div>
          </a>
          <a href={fundFlowUrl()} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-black/20 p-3 hover:bg-black/30 transition">
            <div className="text-xs text-slate-400">近10日主力净流入</div>
            <div className={`mt-1 text-lg font-bold ${pctColor(structure.mainNet10d)}`}>{fmtMoney(structure.mainNet10d)}</div>
            <div className="text-[10px] text-amber-300/60">点击查看 →</div>
          </a>
        </div>
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
          <div className="text-xs text-slate-400">北向资金</div>
          <div className="mt-1 text-sm text-slate-500">{structure.north.note}</div>
        </div>
      </div>

      {/* 历史快照（30天） */}
      {history.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-bold text-slate-200">
              📊 近期资金快照（{history.length}天历史记录）
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowChart(v => !v)}
                className="rounded px-2 py-1 text-xs bg-white/10 text-slate-300 hover:bg-white/20"
              >
                {showChart ? "表格视图" : "图表视图"}
              </button>
              <button
                onClick={() => setHistoryExpanded(v => !v)}
                className="rounded px-2 py-1 text-xs bg-white/10 text-slate-300 hover:bg-white/20"
              >
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
                  <Tooltip
                    contentStyle={{ backgroundColor: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: "#e2e8f0" }}
                  />
                  <ReferenceLine y={0} stroke="#475569" />
                  <Bar dataKey="主力净流入" fill="#f43f5e" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="散户净流入" fill="#38bdf8" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <div className="flex justify-center gap-4 text-[10px] text-slate-500 mt-1">
                <span><span className="inline-block w-3 h-2 bg-rose-500 rounded mr-1" />主力净流入(亿)</span>
                <span><span className="inline-block w-3 h-2 bg-sky-400 rounded mr-1" />散户净流入(亿)</span>
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
                  {displayHistory.map((h) => (
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
              <button
                onClick={() => setHistoryExpanded(true)}
                className="text-xs text-amber-300 hover:text-amber-200"
              >
                ▼ 展开剩余 {history.length - 5} 天数据
              </button>
            </div>
          )}
        </div>
      )}

      <div className="text-[11px] text-slate-600 leading-relaxed">
        数据来源与计算逻辑：东方财富push2资金流接口。主力=超大单+大单净额；散户=小单净额；游资=中单净额。
        一票否决规则：主力净流出+散户净流入+近5日/10日持续流出=结构危险。
        <a href={fundFlowUrl()} target="_blank" rel="noopener noreferrer" className="text-amber-300 hover:underline ml-1">查看东方财富资金流向 →</a>
      </div>
    </div>
  );
}
