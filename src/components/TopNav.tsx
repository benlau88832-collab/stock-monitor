import { fmtTime } from "../lib/format";

export type TabKey = "market" | "fund" | "mainline" | "stock" | "pitfalls";

const TABS: { key: TabKey; label: string }[] = [
  { key: "market", label: "市场监控" },
  { key: "fund", label: "资金结构" },
  { key: "mainline", label: "主线与潜力" },
  { key: "stock", label: "个股监控" },
  { key: "pitfalls", label: "避坑指南" },
];

export default function TopNav(props: {
  active: TabKey;
  onChange: (t: TabKey) => void;
  lastUpdated: string | null;
  loading: boolean;
  autoRefresh: boolean;
  onToggleAutoRefresh: () => void;
  onRefreshNow: () => void;
}) {
  const { active, onChange, lastUpdated, loading, autoRefresh, onToggleAutoRefresh, onRefreshNow } = props;
  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-[#070a12]/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-3 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-rose-500 to-amber-400 text-sm font-black text-black">
            A
          </div>
          <div>
            <div className="text-sm font-bold tracking-wide text-slate-50">A股实时监控终端</div>
            <div className="text-[10px] text-slate-500">资金结构 &gt; 涨跌幅 · 风险信号 &gt; 机会信号</div>
          </div>
        </div>

        <nav className="ml-2 flex flex-1 flex-wrap gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => onChange(t.key)}
              className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition ${
                active === t.key
                  ? "bg-amber-400 text-black shadow"
                  : "text-slate-300 hover:bg-white/5 hover:text-white"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-3 text-xs text-slate-400">
          <span className="flex items-center gap-1">
            <span className={`h-2 w-2 rounded-full ${loading ? "bg-amber-400 animate-pulse" : "bg-emerald-400 animate-pulse"}`} />
            {loading ? "刷新中" : "已更新"} {fmtTime(lastUpdated)}
          </span>
          <button
            onClick={onToggleAutoRefresh}
            className={`rounded px-2 py-1 font-medium ${autoRefresh ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-700/40 text-slate-300"}`}
          >
            自动刷新{autoRefresh ? "开" : "关"}
          </button>
          <button
            onClick={onRefreshNow}
            className="rounded bg-white/10 px-2 py-1 font-medium text-slate-100 hover:bg-white/20"
          >
            手动刷新
          </button>
        </div>
      </div>
    </header>
  );
}
