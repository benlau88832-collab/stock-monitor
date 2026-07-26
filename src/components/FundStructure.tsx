"use client";

import { fmtMoney, pctColor, fmtPct } from "@/lib/format";

interface Props {
  data: any;
  loading: boolean;
}

const VERDICT_STYLE: Record<string, { bg: string; border: string; text: string; label: string }> = {
  danger: { bg: "bg-rose-500/15", border: "border-rose-500/50", text: "text-rose-300", label: "🚨 一票否决：结构危险" },
  warning: { bg: "bg-orange-500/15", border: "border-orange-500/50", text: "text-orange-300", label: "⚠️ 警告：结构偏弱" },
  caution: { bg: "bg-amber-500/10", border: "border-amber-500/40", text: "text-amber-300", label: "⚠ 谨慎：方向不明" },
  healthy: { bg: "bg-emerald-500/10", border: "border-emerald-500/40", text: "text-emerald-300", label: "✅ 结构健康" },
  unknown: { bg: "bg-slate-500/10", border: "border-slate-500/40", text: "text-slate-300", label: "数据不足" },
};

function FlowBar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (Math.abs(value) / max) * 100) : 0;
  const positive = value >= 0;
  return (
    <div className="flex items-center gap-2 text-xs">
      <div className="w-20 shrink-0 text-slate-400">{label}</div>
      <div className="relative h-4 flex-1 rounded bg-slate-800">
        <div
          className={`absolute top-0 h-4 rounded ${positive ? "bg-rose-500" : "bg-emerald-500"}`}
          style={{ width: `${pct}%`, [positive ? "left" : "right"]: "50%" } as any}
        />
        <div className="absolute left-1/2 top-0 h-4 w-px bg-slate-600" />
      </div>
      <div className={`w-24 shrink-0 text-right font-semibold ${positive ? "text-rose-400" : "text-emerald-400"}`}>
        {fmtMoney(value)}
      </div>
    </div>
  );
}

function FundRatioBar({ label, inflow, outflow }: { label: string; inflow: number; outflow: number }) {
  const total = Math.abs(inflow) + Math.abs(outflow);
  const inflowPct = total > 0 ? (Math.abs(inflow) / total) * 100 : 50;
  return (
    <div className="text-xs">
      <div className="flex items-center justify-between mb-1">
        <span className="text-slate-400">{label}</span>
        <span className="text-slate-500">{fmtMoney(inflow + outflow)}</span>
      </div>
      <div className="flex h-3 rounded overflow-hidden bg-slate-800">
        <div className="bg-rose-500 h-3" style={{ width: `${inflowPct}%` }} />
        <div className="bg-emerald-500 h-3" style={{ width: `${100 - inflowPct}%` }} />
      </div>
      <div className="flex justify-between mt-0.5 text-[10px]">
        <span className="text-rose-400">流入 {fmtMoney(Math.abs(inflow > 0 ? inflow : 0))}</span>
        <span className="text-emerald-400">流出 {fmtMoney(Math.abs(outflow < 0 ? outflow : 0))}</span>
      </div>
    </div>
  );
}

export default function FundStructure({ data, loading }: Props) {
  if (!data && loading) {
    return <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-slate-400">正在加载资金结构…</div>;
  }
  const structure = data?.structure;
  if (!structure) {
    return (
      <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-6 text-rose-300">
        {data?.message || "资金结构数据获取失败"}
      </div>
    );
  }

  const style = VERDICT_STYLE[structure.verdict] ?? VERDICT_STYLE.unknown;
  const t = structure.today;
  const max = Math.max(Math.abs(t.extraLargeNet), Math.abs(t.largeNet), Math.abs(t.mediumNet), Math.abs(t.smallNet), 1);

  // 计算力量对比
  const mainForce = t.mainNet; // 主力 = 超大单 + 大单
  const retailForce = t.mediumNet + t.smallNet; // 散户 + 游资

  return (
    <section className="space-y-4">
      {/* 一票否决判断 */}
      <div className={`rounded-xl border p-4 ${style.bg} ${style.border}`}>
        <div className={`text-lg font-black ${style.text}`}>{style.label}</div>
        <ul className="mt-2 space-y-1 text-sm text-slate-200">
          {structure.reasons.map((r: string, i: number) => (
            <li key={i}>• {r}</li>
          ))}
        </ul>
        <div className="mt-3 rounded-lg bg-black/30 px-3 py-2 text-sm font-medium text-slate-100">
          可执行含义：{structure.actionHint}
        </div>
      </div>

      {/* 资金力量对比概览 */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-center">
          <div className="text-xs text-slate-400">主力（超大单+大单）</div>
          <div className={`mt-1 text-2xl font-black ${pctColor(mainForce)}`}>{fmtMoney(mainForce)}</div>
          <div className="mt-1 text-[10px] text-slate-500">机构 + 大户</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-center">
          <div className="text-xs text-slate-400">散户+游资（中单+小单）</div>
          <div className={`mt-1 text-2xl font-black ${pctColor(retailForce)}`}>{fmtMoney(retailForce)}</div>
          <div className="mt-1 text-[10px] text-slate-500">游资 + 散户</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-center">
          <div className="text-xs text-slate-400">主力/散户力量对比</div>
          <div className={`mt-1 text-2xl font-black ${mainForce > 0 && retailForce < 0 ? "text-emerald-400" : mainForce < 0 && retailForce > 0 ? "text-rose-400" : "text-amber-300"}`}>
            {mainForce > 0 && retailForce < 0 ? "主力吸筹" : mainForce < 0 && retailForce > 0 ? "主力出货" : mainForce > 0 && retailForce > 0 ? "共振做多" : mainForce < 0 && retailForce < 0 ? "共振做空" : "方向不明"}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* 资金分档 */}
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="mb-3 text-sm font-semibold text-slate-200">今日资金结构分档</div>
          <div className="space-y-3">
            <FlowBar label="超大单(机构)" value={t.extraLargeNet} max={max} />
            <FlowBar label="大单(大户)" value={t.largeNet} max={max} />
            <FlowBar label="中单(游资)" value={t.mediumNet} max={max} />
            <FlowBar label="小单(散户)" value={t.smallNet} max={max} />
          </div>
          <div className="mt-3 border-t border-white/10 pt-3 text-sm">
            <span className="text-slate-400">主力净流入合计：</span>
            <span className={`ml-1 font-bold ${pctColor(t.mainNet)}`}>{fmtMoney(t.mainNet)}</span>
          </div>
        </div>

        {/* 连续性 */}
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="mb-3 text-sm font-semibold text-slate-200">资金连续性（趋势判断核心）</div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-black/20 p-3 text-center">
              <div className="text-xs text-slate-400">近5日主力净流入</div>
              <div className={`mt-1 text-xl font-bold ${pctColor(structure.mainNet5d)}`}>{fmtMoney(structure.mainNet5d)}</div>
            </div>
            <div className="rounded-lg bg-black/20 p-3 text-center">
              <div className="text-xs text-slate-400">近10日主力净流入</div>
              <div className={`mt-1 text-xl font-bold ${pctColor(structure.mainNet10d)}`}>{fmtMoney(structure.mainNet10d)}</div>
            </div>
          </div>

          {/* 连续性判断 */}
          <div className="mt-3 rounded-lg bg-black/20 p-3">
            <div className="text-xs text-slate-400 mb-2">连续性信号</div>
            <div className="space-y-1 text-xs">
              <div className={`flex items-center gap-2 ${structure.mainNet5d < 0 ? "text-rose-400" : "text-emerald-400"}`}>
                <span className={`h-2 w-2 rounded-full ${structure.mainNet5d < 0 ? "bg-rose-500" : "bg-emerald-500"}`} />
                近5日主力：{structure.mainNet5d < 0 ? "持续流出" : "持续流入"}
              </div>
              <div className={`flex items-center gap-2 ${structure.mainNet10d < 0 ? "text-rose-400" : "text-emerald-400"}`}>
                <span className={`h-2 w-2 rounded-full ${structure.mainNet10d < 0 ? "bg-rose-500" : "bg-emerald-500"}`} />
                近10日主力：{structure.mainNet10d < 0 ? "持续流出" : "持续流入"}
              </div>
              <div className={`flex items-center gap-2 ${t.mainNet < 0 && t.smallNet > 0 ? "text-rose-400" : "text-emerald-400"}`}>
                <span className={`h-2 w-2 rounded-full ${t.mainNet < 0 && t.smallNet > 0 ? "bg-rose-500" : "bg-emerald-500"}`} />
                今日主散对立：{t.mainNet < 0 && t.smallNet > 0 ? "主力出+散户进（危险）" : "未触发"}
              </div>
            </div>
          </div>

          {/* 北向资金 */}
          <div className="mt-3 rounded-lg bg-black/20 p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">北向资金</span>
              <span className={structure.north.available ? pctColor(structure.north.net) : "text-slate-500"}>
                {structure.north.available ? fmtMoney(structure.north.net) : "数据不完整"}
              </span>
            </div>
            <div className="mt-1 text-[11px] text-slate-500">{structure.north.note}</div>
          </div>
        </div>
      </div>

      {/* 历史快照 */}
      {data.history && data.history.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="mb-3 text-sm font-semibold text-slate-200">近期资金快照（历史记录）</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-slate-400">
                <tr>
                  <th className="px-2 py-1 text-left">日期</th>
                  <th className="px-2 py-1 text-right">主力净流入</th>
                  <th className="px-2 py-1 text-right">散户净流入</th>
                </tr>
              </thead>
              <tbody>
                {data.history.map((h: any, i: number) => (
                  <tr key={i} className="border-t border-white/5">
                    <td className="px-2 py-1 text-slate-300">{h.date}</td>
                    <td className={`px-2 py-1 text-right ${pctColor(Number(h.mainNet))}`}>{fmtMoney(Number(h.mainNet))}</td>
                    <td className={`px-2 py-1 text-right ${pctColor(Number(h.smallNet))}`}>{fmtMoney(Number(h.smallNet))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-white/5 bg-black/20 px-3 py-2 text-[11px] text-slate-500">
        数据来源与计算逻辑：{data.source}。主力=超大单+大单净额；散户=小单净额；游资=中单净额（东方财富分档口径，为行业通用近似分类，非交易所官方定义）。一票否决规则：主力净流出+散户净流入+近5日/10日持续流出=结构危险。
      </div>
    </section>
  );
}
