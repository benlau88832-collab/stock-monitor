import { useState, useEffect } from "react";
import HealthDot from "./HealthDot";
import IntelligenceDrawer from "./IntelligenceDrawer";
import SettingsModal from "./SettingsModal";
// v9.50（G2）：StatusBar 并入 TopNav 顶部通栏（合成一个 sticky 头，减少首屏挤压）
import StatusBar from "./StatusBar";
import { getCurrentSession } from "../lib/tradingSession";
import { getTodayCalls } from "../lib/ai";
import type { OverviewData, FundStructureData } from "../App";
import {
  isSoundOn, isNotifyOn, setSoundOn, setNotifyOn,
  resumeAudio, requestNotifyPermission, getUnreadCount, clearUnread, getFeed,
  subscribe,
} from "../lib/alertBus";

export type TabKey = "dashboard" | "fundline" | "radar" | "dragon" | "news";

// P2-2：时间轴语义 —— 每个 Tab 标注所属交易时段（盘前/盘中/盘后/资金/消息）
// 保留 5 Tab 平铺 + URL hash 兼容；导航顶部显示"当前阶段"指示器
const TABS: { key: TabKey; label: string; phase: string }[] = [
  { key: "dashboard", label: "驾驶舱", phase: "盘前/盘中" },
  { key: "radar", label: "个股雷达", phase: "盘中" },
  { key: "fundline", label: "资金主线", phase: "资金" },
  { key: "dragon", label: "龙虎榜复盘", phase: "盘后" },
  { key: "news", label: "消息面", phase: "消息" },
];

/** 当前交易阶段 → 时间轴标签（P2-2 阶段指示器） */
const PHASE_LABEL: Record<string, string> = {
  pre: "⏰ 盘前准备",
  auction: "⏰ 集合竞价",
  trading: "🔴 盘中作战",
  post: "🌙 盘后复盘",
  empty: "⚪ 休市",
};

interface Props {
  active: TabKey;
  onChange: (t: TabKey) => void;
  lastUpdated: string | null;
  loading: boolean;
  autoRefresh: boolean;
  onToggleAutoRefresh: () => void;
  onRefreshNow: () => void;
  countdown: number;
  /** v9.26.10：下次自动刷新时间戳（App 不再每秒 setState 导致全树重渲染） */
  nextRefreshAt?: number;
  /** v9.50（G2）：并入顶部通栏的状态条数据 */
  overview?: OverviewData | null;
  fund?: FundStructureData | null;
}

export default function TopNav({ active, onChange, loading, autoRefresh, onToggleAutoRefresh, onRefreshNow, countdown, nextRefreshAt, lastUpdated, overview, fund }: Props) {
  const [soundOn, _setSoundOn] = useState(isSoundOn);
  const [notifyOn, _setNotifyOn] = useState(isNotifyOn);
  const [showBell, setShowBell] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // v9.77（P0-5 修复）：数据年龄展示 —— lastUpdated 原为死参数从未渲染；每 5s tick 一次更新相对年龄
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  // 修复：之前直接 const unread = getUnreadCount() 在每次 render 取值，bus 变化不会重渲染。
  // 改为订阅 alertBus，emit 触发时强制重渲染 → 角标实时更新。
  const [unread, setUnread] = useState(0);
  const [criticalCount, setCriticalCount] = useState(0);
  useEffect(() => {
    const refresh = () => {
      setUnread(getUnreadCount());
      setCriticalCount(getFeed().filter(e => e.severity === "critical").length);
    };
    refresh();
    return subscribe(refresh);
  }, []);

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

  // v9.26.10：本地每秒计算剩余秒数（不触发 App 重渲染）
  const [remainSec, setRemainSec] = useState(countdown);
  useEffect(() => {
    if (!autoRefresh) return;
    const tick = () => {
      if (nextRefreshAt != null) setRemainSec(Math.max(0, Math.ceil((nextRefreshAt - Date.now()) / 1000)));
      else setRemainSec(countdown);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [autoRefresh, nextRefreshAt, countdown]);
  const displaySec = nextRefreshAt != null ? remainSec : countdown;

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
            {/* P2-2：当前交易阶段指示器（时间轴感知） */}
            <span className="mr-1 hidden md:inline rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-bold text-slate-400"
              title="当前交易时段">
              {PHASE_LABEL[getCurrentSession().phase] ?? "⏰ 盘前"}
            </span>
            {TABS.map((t) => (
              <button key={t.key} onClick={() => onChange(t.key)} title={t.phase}
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
                  {autoRefresh && displaySec > 0 && (
                    <span className="text-slate-500">{displaySec}s</span>
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
            {/* v9.77（P0-5 修复）：数据年龄 —— "3秒决策"的前提是知道数据有多旧 */}
            {lastUpdated && (() => {
              const t = new Date(lastUpdated).getTime();
              if (Number.isNaN(t)) return <span className="text-[10px] text-slate-600" title={lastUpdated}>🕒 {lastUpdated}</span>;
              const sec = Math.max(0, Math.round((nowMs - t) / 1000));
              const age = sec < 60 ? `${sec}秒前` : sec < 3600 ? `${Math.floor(sec / 60)}分前` : new Date(lastUpdated).toTimeString().slice(0, 5);
              const stale = sec > 120;
              return (
                <span className={`text-[10px] ${stale ? "text-amber-400" : "text-slate-500"}`}
                  title={`上次数据刷新 ${new Date(lastUpdated).toTimeString().slice(0, 8)}${stale ? "（数据可能已过期）" : ""}`}>
                  🕒 {age}
                </span>
              );
            })()}
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
                  <span className="absolute -top-1 -right-1 rounded-full bg-rose-500 text-white text-xs font-bold w-4 h-4 flex items-center justify-center">
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
                <span className="absolute -top-1 -right-1 rounded-full bg-rose-500 text-white text-xs font-bold w-4 h-4 flex items-center justify-center">
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
        {/* v9.50（G2）：状态条并入顶部通栏（指数/成交/情绪常驻，不再独立占一层） */}
        <StatusBar overview={overview ?? null} fund={fund ?? null} />
      </nav>

      {/* AI 交易督导抽屉 */}
      <IntelligenceDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </>
  );
}
