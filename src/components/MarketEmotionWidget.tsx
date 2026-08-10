// ============================================================
// v9.96.0（批次 1）：市场情绪 Widget（VibeAlpha MarketSentimentWidget 对照）
// 红涨绿跌比例条（竖向三色）+ 涨/跌/平家数 + 涨停/跌停角标 + 成交额
// 数据复用 overview.breadth（零新增请求）
// ============================================================
import type { OverviewData } from "../App";

interface Props {
  overview: OverviewData | null;
}

export default function MarketEmotionWidget({ overview }: Props) {
  const breadth = overview?.breadth;
  const limitPool = overview?.limitPool;
  if (!breadth || breadth.total === 0) return null;

  const up = breadth.up;
  const down = breadth.down;
  const flat = breadth.flat;
  const total = breadth.total || 1;
  const upPct = (up / total) * 100;
  const downPct = (down / total) * 100;
  const flatPct = (flat / total) * 100;

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3 flex items-center gap-3">
      {/* 竖向红涨绿跌比例条 */}
      <div className="flex h-14 w-3 overflow-hidden rounded-full bg-slate-800 flex-col-reverse" title="红涨绿跌比例">
        <div className="w-full bg-emerald-500/80" style={{ height: `${downPct}%` }} />
        <div className="w-full bg-slate-500/70" style={{ height: `${flatPct}%` }} />
        <div className="w-full bg-rose-500/80" style={{ height: `${upPct}%` }} />
      </div>
      <div className="text-[11px] leading-relaxed">
        <div className="text-rose-300 font-bold">▲ 上涨 {up}</div>
        <div className="text-slate-400">— 平盘 {flat}</div>
        <div className="text-emerald-300 font-bold">▼ 下跌 {down}</div>
      </div>
      <div className="ml-auto text-right text-[11px] leading-relaxed">
        <div className="text-amber-300">涨停 <b>{limitPool?.limitUpCount ?? 0}</b></div>
        <div className="text-rose-300">跌停 <b>{limitPool?.limitDownCount ?? 0}</b></div>
        <div className="text-slate-500">
          成交 {(overview?.turnoverAmount ?? 0) / 1e8 >= 10000
            ? `${((overview?.turnoverAmount ?? 0) / 1e12).toFixed(2)}万亿`
            : `${((overview?.turnoverAmount ?? 0) / 1e8).toFixed(0)}亿`}
        </div>
      </div>
    </div>
  );
}
