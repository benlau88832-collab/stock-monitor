import { useState } from "react";
import HealthDot from "./HealthDot";
import IntelligenceDrawer from "./IntelligenceDrawer";
import SettingsModal from "./SettingsModal";
import { getCurrentSession } from "../lib/tradingSession";
import { getTodayCalls } from "../lib/ai";
import {
  isSoundOn, isNotifyOn, setSoundOn, setNotifyOn,
  resumeAudio, requestNotifyPermission, getUnreadCount, clearUnread, getFeed,
} from "../lib/alertBus";

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
  const [soundOn, _setSoundOn] = useState(isSoundOn);
  const [notifyOn, _setNotifyOn] = useState(isNotifyOn);
  const [showBell, setShowBell] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const unread = getUnreadCount();

  // 计算督导徽标数：critical 级警报数
  const criticalCount = getFeed().filter(e => e.severity === "critical").length;

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    _setSoundOn(next);
    if (next) resumeAudio();
  };

  const toggleNotify = () => {
    const next = !notifyOn;
    setNotifyOn(next);
    _setNotifyOn(next);
    if (next) requestNotifyPermission();
  };

  return (
    <>
      <nav className="sticky top-0 z-50 border-b border-white/10 bg-[#0b0f1a]/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between px-4 py-2">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-rose-500 text-sm font-black text-white">A</div>
            <div className="hidden sm:block">
              <div className="text-sm font-bold text-slate-100 leading-tight">A股实时监控终端</div>
              <div className="text-[11px] text-slate-500">资金结构 · 涨跌幅 · 风险信号 · 机会信号</div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {TABS.map((t) => (
              <button key={t.key} onClick={() => onChange(t.key)}
                className={`rounded-lg px-2 py-1 sm:px-3 sm:py-1.5 text-xs font-semibold transition ${
                  active === t.key ? "bg-amber-500/20 text-amber-300" : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
                }`}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            {(() => {
              const session = getCurrentSession();
              return (
                <>
                  <span className="text-[11px] text-slate-600 hidden sm:inline">{session.label}</span>
                  {autoRefresh && countdown > 0 && (
                    <span className="text-slate-500">{countdown}s</span>
                  )}
                </>
              );
            })()}
            <button onClick={onToggleAutoRefresh}
              className={`rounded px-1.5 py-1 hidden sm:inline ${autoRefresh ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-500/20 text-slate-400"}`}>
              {autoRefresh ? "自动" : "手动"}
            </button>
            <button onClick={onRefreshNow} disabled={loading}
              className="rounded px-1.5 py-1 bg-white/10 text-slate-300 hover:bg-white/20 disabled:opacity-40">
              {loading ? "…" : "刷新"}
            </button>
            {/* 声音/通知开关 */}
            <button onClick={toggleSound} title={soundOn ? "关闭声音" : "开启声音"}
              className={`rounded px-1.5 py-1 text-[11px] ${soundOn ? "bg-amber-500/20 text-amber-300" : "bg-slate-500/20 text-slate-500"}`}>
              {soundOn ? "🔊" : "🔇"}
            </button>
            <button onClick={toggleNotify} title={notifyOn ? "关闭通知" : "开启通知"}
              className={`rounded px-1.5 py-1 text-[11px] ${notifyOn ? "bg-amber-500/20 text-amber-300" : "bg-slate-500/20 text-slate-500"}`}>
              {notifyOn ? "🔔" : "🔕"}
            </button>
            {/* 铃铛 */}
            <div className="relative">
              <button onClick={() => { setShowBell(v => !v); clearUnread(); }}
                className="rounded px-1.5 py-1 bg-white/10 text-slate-300 hover:bg-white/20 relative">
                🔔
                {unread > 0 && (
                  <span className="absolute -top-1 -right-1 rounded-full bg-rose-500 text-white text-[9px] font-bold w-4 h-4 flex items-center justify-center">
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </button>
              {showBell && (
                <div className="absolute right-0 top-full mt-1 w-72 max-h-60 overflow-y-auto rounded-lg border border-white/10 bg-[#0b0f1a] shadow-xl z-50 p-2">
                  <div className="text-[11px] text-slate-400 mb-1">最近预警</div>
                  {getFeed().slice(0, 15).map((e, i) => (
                    <div key={i} className={`text-[11px] py-0.5 ${e.severity === "critical" ? "text-rose-400" : e.severity === "warning" ? "text-amber-300" : "text-slate-400"}`}>
                      <span className="text-slate-600 mr-1">{new Date(e.ts).toTimeString().slice(0, 5)}</span>
                      {e.message}
                    </div>
                  ))}
                  {getFeed().length === 0 && <div className="text-[11px] text-slate-600">暂无预警</div>}
                </div>
              )}
            </div>
            {/* AI 次数 */}
            <span className="text-[11px] text-violet-400 hidden sm:inline" title={`今日AI调用${getTodayCalls()}次`}>
              🤖{getTodayCalls() || 0}
            </span>
            {/* AI 交易督导按钮 */}
            <button onClick={() => setDrawerOpen(true)}
              className="relative rounded px-2 py-1 bg-violet-500/20 text-violet-300 hover:bg-violet-500/30 border border-violet-500/30 font-semibold text-[11px]">
              💬 AI督导
              {criticalCount > 0 && (
                <span className="absolute -top-1 -right-1 rounded-full bg-rose-500 text-white text-[9px] font-bold w-4 h-4 flex items-center justify-center">
                  {criticalCount > 9 ? "9+" : criticalCount}
                </span>
              )}
            </button>
            {/* 设置按钮 */}
            <button onClick={() => setShowSettings(true)} title="模型与数据设置"
              className="rounded px-1.5 py-1 bg-white/10 text-slate-300 hover:bg-white/20 text-[11px]">
              ⚙️
            </button>
            <HealthDot />
          </div>
        </div>
      </nav>

      {/* AI 交易督导抽屉 */}
      <IntelligenceDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </>
  );
}
