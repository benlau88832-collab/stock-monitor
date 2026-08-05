import { useState, useEffect, useRef, useCallback } from "react";
import { generateDailyIntelligence, type NewsItem, type AnnItem } from "../lib/llmNewsIntelligence";
import { getRecentMemos, loadDailyMemo, getSegmentMemos, type DailyNewsMemo, type IntelSlot } from "../lib/newsMemoStore";
import { getAllSince, getAllOnDate, getChainItems, getStats, fetchAnalysisDataFromCloud, type CloudAnalysisData } from "../lib/dataStore";
import { getAllBoards } from "../lib/boardMap";
import { hasAvailableAI, hasAIOptimistic } from "../lib/ai";
import { getCurrentSession } from "../lib/tradingSession";
import { fetchLimitPoolSummary } from "../lib/api";
import { isLocalServer } from "../lib/cloudStore";
import type { MarketSnapshotForNews } from "./NewsPanel";

// ============== 工具 ==============
function getBJDate(): string {
  const n = new Date();
  const bj = new Date(n.getTime() + (n.getTimezoneOffset() + 480) * 60000);
  return `${bj.getFullYear()}${String(bj.getMonth() + 1).padStart(2, "0")}${String(bj.getDate()).padStart(2, "0")}`;
}
function getBJHHMM(): number {
  const n = new Date();
  const bj = new Date(n.getTime() + (n.getTimezoneOffset() + 480) * 60000);
  return bj.getHours() * 100 + bj.getMinutes();
}
function fmtTime(): string {
  const n = new Date();
  const bj = new Date(n.getTime() + (n.getTimezoneOffset() + 480) * 60000);
  return `${String(bj.getHours()).padStart(2, "0")}:${String(bj.getMinutes()).padStart(2, "0")}`;
}
function dateForStore(d: string): string {
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

// ============== 分段触发持久化（刷新不重跑） ==============
const TRIG_KEY = (d: string) => `intel_triggered_${d}`;
function loadTrig(d: string): Set<IntelSlot> {
  try { return new Set(JSON.parse(localStorage.getItem(TRIG_KEY(d)) || "[]") as IntelSlot[]); }
  catch { return new Set(); }
}
function saveTrig(d: string, s: Set<IntelSlot>) {
  try { localStorage.setItem(TRIG_KEY(d), JSON.stringify([...s])); } catch { /* 静默 */ }
}

const STAGE_COLORS: Record<string, string> = {
  "启动期": "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  "发酵期": "bg-amber-500/20 text-amber-300 border-amber-500/30",
  "高潮期": "bg-rose-500/20 text-rose-300 border-rose-500/30",
  "分歧期": "bg-slate-500/20 text-slate-300 border-slate-500/30",
  "退潮期": "bg-slate-600/20 text-slate-400 border-slate-600/30",
};
const SLOT_LABELS: Record<IntelSlot, string> = {
  pre: "盘前", morning: "早盘", noon: "午盘", afterclose: "盘后", final: "终盘", manual: "手动",
};

// ============== Props ==============
interface Props {
  news: NewsItem[];
  announcements: AnnItem[];
  strongBoards: string[];
  slot?: IntelSlot;
  marketSnapshot?: MarketSnapshotForNews;
}

export default function IntelligenceDashboard({ news, announcements, strongBoards, slot, marketSnapshot }: Props) {
  const today = getBJDate();
  const [memo, setMemo] = useState<DailyNewsMemo | null>(() => loadDailyMemo(today));
  const [loading, setLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [boardFilter, setBoardFilter] = useState("");
  const [boardItems, setBoardItems] = useState<Array<{ title: string; time: string; url: string; tag: "新闻" | "公告" }>>([]);
  const [lastUpdateTime, setLastUpdateTime] = useState<string>("");
  const [sourceCount, setSourceCount] = useState({ news: 0, ann: 0 });
  const [scopeDays, setScopeDays] = useState<number>(3);
  const [scopeLabel, setScopeLabel] = useState<string>("");
  // 指定日期分析：用户可选某一天，"📅 分析该日"时只取该天数据
  const [customDate, setCustomDate] = useState<string>("");
  const triggeredSlots = useRef<Set<IntelSlot>>(loadTrig(today));
  // v9.26.8：本地部署时缓存 PG 全量数据（供分析直接用，绕过 localStorage 5MB 限制）
  const cloudDataRef = useRef<CloudAnalysisData | null>(null);
  const cloudLoadedRef = useRef(false);

  // v9.26.8：分析取数统一入口 —— 本地部署优先 PG 全量；线上回退 localStorage
  const getAnalysisData = useCallback(async (days: number) => {
    if (isLocalServer() && !cloudLoadedRef.current) {
      try {
        cloudDataRef.current = await fetchAnalysisDataFromCloud(days);
      } catch { cloudDataRef.current = null; }
      cloudLoadedRef.current = true;
    }
    if (cloudDataRef.current) return cloudDataRef.current;
    return null; // 线上 → 调用方用 localStorage
  }, []);

  // 运行情报引擎（合并：limitPool + 智能窗口 + 手动全量 + 指定日期）
  const runIntelligence = useCallback(async (targetSlot: IntelSlot, scopeDaysArg?: number, customDateArg?: string) => {
    setLoading(true);
    try {
      const todayStore = dateForStore(today);
      const normDate = (s: string) => s.includes("-") ? s : `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
      const minusDays = (base: string, back: number) => {
        const d = new Date(normDate(base)); d.setDate(d.getDate() - back);
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
      };

      // 取数优先级：① customDate 精确单日 → ② scopeDays 近N天 → ③ 自动智能窗口
      // v9.26.8：本地部署时优先 PG 全量（cloudData），线上用 localStorage
      const cloudData = await getAnalysisData(Math.max(scopeDaysArg ?? 3, 30));
      const pickFrom = (base: { news: NewsItem[]; ann: AnnItem[] }, cutoff: string) => {
        if (!base) return { news: [], ann: [] };
        return {
          news: (base.news ?? []).filter((n: NewsItem) => (n.time ?? "").slice(0, 10) >= cutoff),
          ann: (base.ann ?? []).filter((a: AnnItem) => (a.time ?? "").slice(0, 10) >= cutoff),
        };
      };
      const localSince = (base: string, back: number) => {
        const d = new Date(normDate(base)); d.setDate(d.getDate() - back);
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
      };
      const isCloud = Boolean(cloudData);
      const cloudBase = cloudData ? { news: cloudData.news, ann: cloudData.ann } : null;

      let accumulated;
      let label: string;
      if (customDateArg) {
        // 指定日期：精确取该天
        if (isCloud && cloudBase) {
          accumulated = {
            news: (cloudBase.news ?? []).filter((n: NewsItem) => (n.time ?? "").slice(0, 10) === customDateArg),
            ann: (cloudBase.ann ?? []).filter((a: AnnItem) => (a.time ?? "").slice(0, 10) === customDateArg),
          };
        } else {
          accumulated = getAllOnDate(customDateArg);
        }
        label = `指定·${customDateArg}`;
      } else if (scopeDaysArg != null) {
        accumulated = isCloud
          ? pickFrom(cloudBase!, localSince(todayStore, scopeDaysArg - 1))
          : getAllSince(minusDays(todayStore, scopeDaysArg - 1));
        label = `手动·近${scopeDaysArg}天`;
      } else {
        let cutoff = todayStore;
        accumulated = isCloud ? pickFrom(cloudBase!, cutoff) : getAllSince(cutoff);
        let total = accumulated.news.length + accumulated.ann.length;
        for (let back = 1; back <= 3 && total < 25; back++) {
          cutoff = minusDays(todayStore, back);
          accumulated = isCloud ? pickFrom(cloudBase!, cutoff) : getAllSince(cutoff);
          total = accumulated.news.length + accumulated.ann.length;
        }
        if (targetSlot === "final") accumulated = isCloud ? pickFrom(cloudBase!, minusDays(todayStore, 1)) : getAllSince(minusDays(todayStore, 1));
        label = SLOT_LABELS[targetSlot] ?? "";
      }
      const allNews = accumulated.news.length > 0 ? accumulated.news : news;
      const allAnn = accumulated.ann.length > 0 ? accumulated.ann : announcements;
      setSourceCount({ news: allNews.length, ann: allAnn.length });
      setScopeLabel(label);

      // 涨停梯队/炸板率 = "市场在交易什么"硬证据
      let limitPool: { limitUpCount: number; blastedRate: number; maxBoard: number | null } | null = null;
      try {
        const lp = await fetchLimitPoolSummary();
        const heights = Object.keys(lp.boardCounts).map(Number).filter(k => lp.boardCounts[k] > 0);
        limitPool = { limitUpCount: lp.limitUpCount, blastedRate: lp.blastedRate, maxBoard: heights.length ? Math.max(...heights) : null };
      } catch { limitPool = null; }

      // 指定日期时用该日期作为情报日期标识（便于历史区分）
      const reportDate = customDateArg
        ? customDateArg.replace(/-/g, "")
        : today;
      const result = await generateDailyIntelligence({
        date: reportDate, slot: targetSlot, news: allNews, announcements: allAnn,
        strongBoards, marketSnapshot, limitPool,
      });
      if (result) { setMemo(result); setLastUpdateTime(fmtTime()); }
    } catch { /* callAI 内部已降级 */ }
    finally { setLoading(false); }
  }, [today, news, announcements, strongBoards, marketSnapshot, getAnalysisData]);

  // 段末触发（持久化，刷新不重跑）
  useEffect(() => {
    const check = () => {
      const session = getCurrentSession();
      const hhmm = getBJHHMM();
      const ph = session.phase;
      let targetSlot: IntelSlot | null = null;
      if ((ph === "pre" || ph === "auction") && hhmm >= 830 && hhmm <= 914) targetSlot = "pre";
      else if ((ph === "trading" && hhmm >= 1125) || (ph === "lunch" && hhmm <= 1135)) targetSlot = "morning";
      else if ((ph === "trading" && hhmm >= 1455) || (ph === "post" && hhmm <= 1505)) targetSlot = "noon";
      else if (ph === "post" && hhmm > 1505 && hhmm < 2200) targetSlot = "afterclose";
      else if (hhmm >= 2200) targetSlot = "final";
      if (targetSlot && !triggeredSlots.current.has(targetSlot) && (news.length > 0 || announcements.length > 0)) {
        triggeredSlots.current.add(targetSlot);
        saveTrig(today, triggeredSlots.current);
        runIntelligence(targetSlot); // 自动=智能窗口(不传manualScopeDays)
      }
    };
    check();
    const t = setInterval(check, 60000);
    return () => clearInterval(t);
  }, [runIntelligence, news, announcements, today]);

  // 产业链追溯（v9.26.8：本地部署优先 PG 全量）
  useEffect(() => {
    if (!boardFilter) { setBoardItems([]); return; }
    const doChain = () => {
      const { news: chainNews, ann: chainAnn } = getChainItems(boardFilter, 30);
      const merged = [
        ...chainNews.map(n => ({ title: n.title, time: n.time, url: n.url, tag: "新闻" as const })),
        ...chainAnn.map(a => ({ title: `${a.stockName}：${a.title}`, time: a.time, url: a.url, tag: "公告" as const })),
      ].sort((a, b) => b.time.localeCompare(a.time));
      setBoardItems(merged);
    };
    if (isLocalServer() && cloudDataRef.current) {
      // 用 PG 数据自建板块链（突破 localStorage 上限）
      const c = cloudDataRef.current;
      const kw = boardFilter;
      const chainNews = (c.news ?? []).filter(n => (n.boards ?? []).some((b: string) => b.includes(kw) || kw.includes(b)));
      const chainAnn = (c.ann ?? []).filter(a => (a.boards ?? []).some((b: string) => b.includes(kw) || kw.includes(b)));
      const merged = [
        ...chainNews.map(n => ({ title: n.title, time: n.time, url: n.url, tag: "新闻" as const })),
        ...chainAnn.map(a => ({ title: `${a.stockName}：${a.title}`, time: a.time, url: a.url, tag: "公告" as const })),
      ].sort((a, b) => b.time.localeCompare(a.time));
      setBoardItems(merged);
    } else {
      doChain();
    }
  }, [boardFilter]);

  const historyMemos = showHistory ? getRecentMemos(5) : [];
  const segments = showTimeline ? getSegmentMemos(today) : [];
  // v9.26.7：AI 可用性（浏览器 Key 或服务端中转均可），不再误判"未配置 Key"
  const [aiAvailable, setAiAvailable] = useState<boolean>(hasAIOptimistic());
  useEffect(() => { hasAvailableAI().then(setAiAvailable); }, []);
  const noAI = !aiAvailable;
  const stageClass = memo ? (STAGE_COLORS[memo.cycleStage] ?? STAGE_COLORS["分歧期"]) : "";
  const stats = getStats();

  return (
    <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-4 space-y-3">
      {/* 标题 + 操作栏 */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-violet-300">🧠 全栈情报分析台</span>
          {memo && (
            <span className={`rounded-lg px-2 py-0.5 text-xs font-black border ${stageClass}`}>
              【{memo.cycleStage}】
            </span>
          )}
        </div>
        <div className="flex flex-col gap-1.5 items-end">
          {/* 第一行：范围分析 + 时间轴/历史 */}
          <div className="flex items-center gap-2 flex-wrap">
            <select value={scopeDays} onChange={e => setScopeDays(Number(e.target.value))}
              className="rounded border border-white/10 bg-slate-800 px-2 py-1 text-xs">
              <option value={1}>今日</option>
              <option value={3}>近3天</option>
              <option value={7}>近7天</option>
              <option value={30}>近30天(全库)</option>
            </select>
            <button onClick={() => runIntelligence("manual", scopeDays)} disabled={loading || noAI}
              className="rounded bg-sky-600 px-3 py-1.5 text-xs hover:bg-sky-500 disabled:opacity-50">
              {loading ? "分析中…" : "🤖 立即分析"}
            </button>
            <button onClick={() => setShowTimeline(v => !v)} className="text-[11px] text-slate-500 hover:text-slate-300">
              {showTimeline ? "收起时间轴" : "📊 分段时间轴"}
            </button>
            <button onClick={() => setShowHistory(v => !v)} className="text-[11px] text-slate-500 hover:text-slate-300">
              {showHistory ? "收起历史" : "📜 5日回看"}
            </button>
          </div>
          {/* 第二行：指定日期分析（精确取该天全部素材） */}
          <div className="flex items-center gap-2">
            <input type="date" value={customDate}
              onChange={e => setCustomDate(e.target.value)}
              className="rounded border border-white/10 bg-slate-800 px-2 py-1 text-xs text-slate-200" />
            <button onClick={() => customDate && runIntelligence("manual", undefined, customDate)}
              disabled={loading || !customDate}
              className="rounded bg-violet-600 px-3 py-1.5 text-xs hover:bg-violet-500 disabled:opacity-50">
              {loading ? "分析中…" : "📅 分析该日"}
            </button>
          </div>
        </div>
      </div>

      {/* 状态条 + 存储说明（v9.26.8：本地部署显示 PG 存储状态） */}
      <div className="text-[11px] text-slate-600">
        本次基于 {sourceCount.news}条快讯+{sourceCount.ann}条公告 · {scopeLabel || SLOT_LABELS[slot ?? "afterclose"]} · 更新{lastUpdateTime || "—"}
        {isLocalServer()
          ? <span className="ml-2">📀 数据已存本地 PostgreSQL · 可回溯至 {cloudDataRef.current?.oldestDate ?? stats.oldestDate ?? "—"}</span>
          : stats.totalCount > 0 && <span className="ml-2">累积库{stats.totalCount}条{stats.oldestDate ? `（最早${stats.oldestDate}）` : ""}</span>}
      </div>
      {/* 容量说明：本地部署已接入 PG → 提示自动消失；仅线上提示 */}
      {!isLocalServer() && (
        <div className="text-[11px] text-slate-700">
          网页存储容量有限，仅保留近期数据；完整月级追溯请在本地部署后接入 PostgreSQL（存储抽象层已就绪）。
        </div>
      )}

      {noAI && !memo && (
        <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-[11px] text-amber-300">
          ⚠️ AI 暂不可用：浏览器未填 API Key 且本地服务端 AI 中转未启用。请检查：① 右上角 ⚙️ 设置（推荐 Agnes 2.5 Flash） ② 服务端 server/.env 是否配置 AI_API_KEY
        </div>
      )}

      {/* 情报内容 */}
      {memo && (
        <div className="space-y-3">
          {(memo.whatMarketTrades || memo.trend) && (
            <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
              {memo.whatMarketTrades && (
                <div className="rounded-lg bg-black/20 p-2">
                  <div className="text-[11px] text-slate-500 mb-1">📌 市场在交易什么</div>
                  <div className="text-xs text-slate-200 leading-relaxed">{memo.whatMarketTrades}</div>
                </div>
              )}
              {memo.trend && (
                <div className="rounded-lg bg-black/20 p-2">
                  <div className="text-[11px] text-slate-500 mb-1">📈 当前趋势</div>
                  <div className="text-xs text-slate-200 leading-relaxed">{memo.trend}</div>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="space-y-2">
              {memo.focusThemes.length > 0 && (
                <div>
                  <div className="text-[11px] text-slate-500 mb-1">📌 当日主线</div>
                  <div className="flex flex-wrap gap-1">
                    {memo.focusThemes.map(t => <span key={t} className="rounded px-1.5 py-0.5 text-[11px] font-bold bg-amber-500/20 text-amber-300">{t}</span>)}
                  </div>
                </div>
              )}
              {memo.positiveIndustries.length > 0 && (
                <div>
                  <div className="text-[11px] text-slate-500 mb-1">🟢 利好聚集行业</div>
                  {memo.positiveIndustries.map(ind => (
                    <div key={ind.name} className="text-[11px] py-0.5">
                      <span className="text-slate-200 font-medium">{ind.name}</span>
                      {ind.resonance && <span className="text-rose-400 ml-1">🔥共振</span>}
                      <span className="text-slate-500 ml-1">({ind.count}条)</span>
                      {ind.source && <span className="text-slate-600 ml-1 text-[10px]">[{ind.source.slice(0, 25)}]</span>}
                    </div>
                  ))}
                </div>
              )}
              {memo.negativeIndustries.length > 0 && (
                <div>
                  <div className="text-[11px] text-slate-500 mb-1">🔴 利空聚集</div>
                  {memo.negativeIndustries.map(ind => (
                    <div key={ind.name} className="text-[11px] text-slate-400 py-0.5">
                      {ind.name} ({ind.count}条)
                      {ind.source && <span className="text-slate-600 ml-1 text-[10px]">[{ind.source.slice(0, 25)}]</span>}
                    </div>
                  ))}
                </div>
              )}
              {memo.topEvents.length > 0 && (
                <div>
                  <div className="text-[11px] text-slate-500 mb-1">⭐ 核心事件</div>
                  {memo.topEvents.map((ev, i) => (
                    <div key={i} className="text-[11px] py-0.5">
                      <span className="text-amber-400">{"★".repeat(ev.stars)}</span>
                      <span className="text-slate-200 ml-1">{ev.title}</span>
                      {ev.impact && <span className="text-slate-400 ml-1">— {ev.impact}</span>}
                      <div className="text-[10px] text-slate-600 ml-4">
                        📎来源：{ev.sourceUrl
                          ? <a href={ev.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-violet-400 hover:text-violet-300 hover:underline">{ev.source.slice(0, 40)}</a>
                          : <span>{ev.source.slice(0, 40)}</span>
                        }
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <div><div className="text-[11px] text-slate-500 mb-1">🎯 方向指引</div><div className="text-xs text-slate-200 leading-relaxed">{memo.directionAdvice || "—"}</div></div>
              {memo.rawSummary && (
                <div><div className="text-[11px] text-slate-500 mb-1">📝 全盘研判</div><div className="text-[11px] text-slate-300 leading-relaxed whitespace-pre-wrap max-h-[150px] overflow-y-auto [scrollbar-width:thin]">{memo.rawSummary}</div></div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 产业链追溯 */}
      <div className="border-t border-white/10 pt-2">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="text-[11px] text-slate-500">🔍 产业链追溯（30天）</span>
          <select value={boardFilter} onChange={e => setBoardFilter(e.target.value)}
            className="rounded bg-black/30 border border-white/10 px-2 py-0.5 text-[11px] text-slate-300 outline-none max-w-[140px]">
            <option value="">选择板块</option>
            {getAllBoards().slice(0, 200).map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          <input value={boardFilter} onChange={e => setBoardFilter(e.target.value)}
            placeholder="或输入板块名" className="rounded bg-black/30 border border-white/10 px-2 py-0.5 text-[11px] text-slate-300 outline-none w-24" />
          {boardFilter && <span className="text-[11px] text-slate-600">{boardItems.length}条相关</span>}
        </div>
        {boardFilter && boardItems.length > 0 && (
          <div className="max-h-[180px] overflow-y-auto [scrollbar-width:thin] space-y-0.5">
            {boardItems.slice(0, 40).map((item, i) => (
              <div key={i} className="flex items-center gap-1 text-[11px] py-0.5 hover:bg-white/5">
                <span className={`rounded px-1 py-0.5 text-[9px] shrink-0 ${item.tag === "公告" ? "bg-amber-500/20 text-amber-300" : "bg-slate-500/20 text-slate-400"}`}>{item.tag}</span>
                <span className="text-slate-500 w-14 shrink-0">{item.time?.slice(5, 10)}</span>
                <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-slate-300 hover:text-amber-300 truncate flex-1">{item.title}</a>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 分段时间轴 */}
      {showTimeline && (
        <div className="border-t border-white/10 pt-2">
          <div className="text-[11px] text-slate-500 mb-1">📊 当日分段时间轴</div>
          {segments.length === 0 ? (
            <div className="text-[11px] text-slate-600">暂无分段快照</div>
          ) : (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {segments.map(seg => (
                <button key={seg.slot} onClick={() => setMemo(seg)}
                  className={`shrink-0 rounded-lg border px-3 py-1.5 text-[11px] ${
                    memo === seg ? "border-violet-400 bg-violet-500/10" : "border-white/10 bg-black/20"
                  } hover:bg-white/5`}>
                  <div className="font-bold text-slate-200">{SLOT_LABELS[seg.slot]}</div>
                  <div className="text-slate-500">{seg.slotTime}</div>
                  <div className={`text-[10px] ${STAGE_COLORS[seg.cycleStage]?.split(" ")[1] ?? "text-slate-400"}`}>{seg.cycleStage}</div>
                  <div className="text-[10px] text-slate-600 truncate max-w-[80px]">{seg.focusThemes.join("/")}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 历史回看 */}
      {showHistory && (
        <div className="border-t border-white/10 pt-2">
          <div className="text-[11px] text-slate-500 mb-1">📜 过去5日主线演进</div>
          {historyMemos.length === 0 ? (
            <div className="text-[11px] text-slate-600">暂无历史记忆</div>
          ) : historyMemos.map(m => (
            <div key={m.date} className="flex items-center gap-2 text-[11px] py-0.5">
              <span className="text-slate-500 w-14 shrink-0">{m.date.slice(4, 6)}-{m.date.slice(6, 8)}</span>
              <span className={`rounded px-1 py-0.5 text-[9px] font-bold ${STAGE_COLORS[m.cycleStage]?.split(" ").slice(0, 2).join(" ") ?? ""}`}>{m.cycleStage}</span>
              <span className="text-slate-300 truncate flex-1">{m.focusThemes.join("/") || "—"}</span>
              <span className="text-slate-500 shrink-0 truncate max-w-[100px]">{m.directionAdvice?.slice(0, 18)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
