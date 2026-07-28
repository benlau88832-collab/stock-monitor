import HealthDot from "./HealthDot";
import { getCurrentSession } from "../lib/tradingSession";

export type TabKey = "dashboard" | "fundline" | "radar" | "dragon" | "news";

const TABS: { key: TabKey; label: string }[] = [
  { key: "dashboard", label: "驾驶舱" },
  { key: "fundline", label: "资金主线" },
  { key: "radar", label: "个股雷达" },
  { key: "dragon", label: "龙虎榜复盘" },
  { key: "news", label: "消息面" },
];

interface Props {
  active: TabKey;
  onChange: (t: TabKey) => void;
  lastUpdated: string | null;
  loading: boolean;
  autoRefresh: boolean;
  onToggleAutoRefresh: () => void;
  onRefreshNow: () => void;
  countdown: number;
}

export default function TopNav({ active, onChange, loading, autoRefresh, onToggleAutoRefresh, onRefreshNow, countdown }: Props) {
  return (
    <nav className="sticky top-0 z-50 border-b border-white/10 bg-[#0b0f1a]/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1500px] items-center justify-between px-4 py-2">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-rose-500 text-sm font-black text-white">A</div>
          <div>
            <div className="text-sm font-bold text-slate-100 leading-tight">A股实时监控终端</div>
            <div className="text-[11px] text-slate-500">资金结构 · 涨跌幅 · 风险信号 · 机会信号</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => onChange(t.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                active === t.key ? "bg-amber-500/20 text-amber-300" : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
              }`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs">
          {(() => {
            const session = getCurrentSession();
            return (
              <>
                <span className="text-[11px] text-slate-600">{session.label}</span>
                {autoRefresh && countdown > 0 && (
                  <span className="text-slate-500">{countdown}s</span>
                )}
              </>
            );
          })()}
          <button onClick={onToggleAutoRefresh}
            className={`rounded px-2 py-1 ${autoRefresh ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-500/20 text-slate-400"}`}>
            {autoRefresh ? "自动刷新开" : "自动刷新关"}
          </button>
          <button onClick={onRefreshNow} disabled={loading}
            className="rounded px-2 py-1 bg-white/10 text-slate-300 hover:bg-white/20 disabled:opacity-40">
            {loading ? "刷新中…" : "手动刷新"}
          </button>
          <HealthDot />
        </div>
      </div>
    </nav>
  );
}
