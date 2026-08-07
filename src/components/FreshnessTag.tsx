// 数据时效标签（v9.18-U1）
// 统一标注数据更新时点：实时 / 准实时 / T+1复盘
// 用途：重建用户信任，避免把 T+1 复盘数据误用于盘中决策

export type DataFreshness = "realtime" | "near_realtime" | "t_plus_1";

const FRESHNESS_META: Record<DataFreshness, { label: string; color: string; tip: string }> = {
  realtime: {
    label: "实时",
    color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    tip: "数据更新延迟约 1 分钟以内",
  },
  near_realtime: {
    label: "准实时",
    color: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    tip: "数据更新延迟约 5-15 分钟",
  },
  t_plus_1: {
    label: "T+1 复盘",
    color: "bg-sky-500/15 text-sky-400 border-sky-500/30",
    tip: "数据于交易日收盘后 16:00 起陆续更新，仅用于复盘及次日参考，不可用于盘中实时决策",
  },
};

export default function FreshnessTag({ type, text }: { type: DataFreshness; text?: string }) {
  const meta = FRESHNESS_META[type];
  return (
    <span className={`ml-1 inline-flex items-center gap-0.5 rounded border px-1 py-0.5 text-xs font-bold ${meta.color}`} title={meta.tip}>
      {text ?? meta.label}
    </span>
  );
}
