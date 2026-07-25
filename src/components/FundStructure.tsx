"use client";

import { fmtMoney, pctColor } from "@/lib/format";
import { indexRealUrl } from "@/lib/realLinks";

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
      <div className="w-16 shrink-0 text-slate-400">{label}</div>
      <div className="relative h-3 flex-1 rounded bg-slate-800">
        <div
          className={`absolute top-0 h-3 rounded ${positive ? "bg-rose-500" : "bg-emerald-500"}`}
          style={{ width: `${pct}%`, [positive ? "left" : "right"]: "50%" } as any}
        />
        <div className="absolute left-1/2 top-0 h-3 w-px bg-slate-600" />
      </div>
      <div className={`w-24 shrink-0 text-right font-semibold ${positive ? "text-rose-400" : "text-emerald-400"}`}>
        {fmtMoney(value)}
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

  return (
    <section className="space-y-4">
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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="mb-3 text-sm font-semibold text-slate-200">今日资金结构分档（超大单/大单=主力，中单=游资，小单=散户）</div>
          <div className="space-y-2">
            <FlowBar label="超大单" value={t.extraLargeNet} max={max} />
            <FlowBar label="大单" value={t.largeNet} max={max} />
            <FlowBar label="中单(游资)" value={t.mediumNet} max={max} />
            <FlowBar label="小单(散户)" value={t.smallNet} max={max} />
          </div>
          <div className="mt-3 border-t border-white/10 pt-3 text-sm">
            <span className="text-slate-400">主力净流入合计：</span>
            <span className={`ml-1 font-bold ${pctColor(t.mainNet)}`}>{fmtMoney(t.mainNet)}</span>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="mb-3 text-sm font-semibold text-slate-200">资金连续性（近5日 / 近10日主力净流入）</div>
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

      <div className="rounded-lg border border-white/5 bg-black/20 px-3 py-2 text-[11px] text-slate-500">
        数据来源与计算逻辑：{data.source}。主力=超大单+大单净额；散户=小单净额；游资=中单净额（东方财富分档口径，为行业通用近似分类，非交易所官方定义）。
      </div>
    </section>
  );
}
