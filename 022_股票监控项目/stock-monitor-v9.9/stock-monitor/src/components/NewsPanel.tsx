import { useState, useEffect, useRef, useCallback } from "react";
import { fetchFastNews, type FastNewsItem } from "../lib/api";
import AnnouncementPanel from "./AnnouncementPanel";
import { callAI, type AIResult } from "../lib/ai";
import { getCurrentSession } from "../lib/tradingSession";
import { exportMemoBackup, importMemoBackup } from "../lib/newsMemoStore";
import IntelligenceDashboard from "./IntelligenceDashboard";
import type { AnnItem, NewsItem as IntelNewsItem } from "../lib/llmNewsIntelligence";
import { upsertNews } from "../lib/dataStore";
import { matchBoardsByText } from "../lib/boardMap";

// 板块归类改为数据驱动（boardMap.ts），不再硬编码

// ============== 重要程度关键词 ==============
// 3星：仅限最高层级政策/央行/突发大事件
const STAR3_KEYWORDS = ["国常会", "国务院常务会议", "央行", "中国人民银行", "证监会", "降准", "降息", "加息", "美联储"];
// 2星：政策/监管/重大公司事件
const STAR2_KEYWORDS = ["发改委", "财政部", "重磅", "突发", "政策", "监管", "IPO", "退市", "暂停上市", "证交所"];
// 其余默认1星

// ============== 外围关键词 ==============
const FOREIGN_KEYWORDS = [
  "美国", "美联储", "美股", "美元", "华尔街", "白宫", "特朗普", "拜登",
  "欧洲", "欧央行", "欧盟", "英国", "德国", "法国",
  "日本", "日央行", "日经", "日元", "韩国", "韩元", "台湾", "台积电",
  "印度", "印尼", "越南", "俄罗斯", "乌克兰", "莫斯科",
  "IMF", "WTO", "OPEC", "G7", "G20",
  "高盛", "摩根", "花旗", "瑞银", "巴克莱", "汇丰", "贝莱德",
  "纳斯达克", "道琼斯", "标普", "恒生", "港股",
  "比特币", "加密", "关税", "制裁", "地缘", "霍尔木兹",
  "中东", "沙特", "以色列", "伊朗",
];

interface EnrichedNews extends FastNewsItem {
  boards: string[];
  sentiment: "positive" | "negative" | "neutral";
  stars: number;
  isOverseas: boolean;
  /** v9.24-P1-3：命中的今日主线名（PRD E1 关联主线） */
  mainlineHit: string | null;
  /** v9.24-P1-3：定价状态（尚未反应/已部分反应/已充分反应，按命中主线涨停家数近似） */
  pricing: string | null;
}

// v9.24-P1-3：消息 ↔ 主线关键词匹配（PRD E1）
// 主线名拆子词匹配（"机器人/减速器" → "机器人"/"减速器"），子词长度≥2 防误命中
export function matchMainlineByText(text: string, mainlines: Array<{ name: string; ztCount: number }>): { hit: string | null; ztCount: number } {
  for (const m of mainlines) {
    const subs = m.name.split(/[/·、,，\s]+/).filter(s => s.length >= 2);
    for (const sub of subs) {
      if (text.includes(sub)) return { hit: m.name, ztCount: m.ztCount };
    }
  }
  return { hit: null, ztCount: 0 };
}

// 定价状态：命中主线已涨停 N 只 → 板块已反应程度（PRD E1 近似规则）
function pricingOf(ztCount: number): string {
  if (ztCount >= 10) return "已充分反应";
  if (ztCount >= 5) return "已部分反应";
  if (ztCount >= 1) return "反应中";
  return "尚未反应";
}

function enrichNews(item: FastNewsItem, mainlines: Array<{ name: string; ztCount: number }>): EnrichedNews {
  const text = item.title + item.summary;
  const boards = matchBoardsByText(text);
  const isNeg = /下跌|利空|暴雷|退市|亏损|减持|违规|处罚|风险|预警|暴跌|崩盘|反倾销|调查|关税|诉讼|制裁|违约|爆仓|踩雷|破产|清仓|被罚|终止|叫停|停牌核查/.test(text);
  const isPos = /利好|上涨|增持|分红|业绩预增|中标|新高|扭亏|大涨|重磅利好|突破|批准|获批|合作|签约|中标|回购/.test(text);
  const sentiment = isNeg ? "negative" as const : isPos ? "positive" as const : "neutral" as const;
  let stars = 1;
  if (STAR3_KEYWORDS.some(kw => text.includes(kw))) stars = 3;
  else if (STAR2_KEYWORDS.some(kw => text.includes(kw))) stars = 2;
  const isOverseas = FOREIGN_KEYWORDS.some(kw => text.includes(kw));
  const { hit, ztCount } = matchMainlineByText(text, mainlines);
  return { ...item, boards, sentiment, stars, isOverseas, mainlineHit: hit, pricing: hit ? pricingOf(ztCount) : null };
}

function SentimentDot({ s }: { s: "positive" | "negative" | "neutral" }) {
  const c = s === "positive" ? "bg-emerald-400" : s === "negative" ? "bg-rose-400" : "bg-slate-400";
  return <span className={`inline-block w-2 h-2 rounded-full ${c} mr-1`} />;
}

function Stars({ n }: { n: number }) {
  return <span className="text-amber-400 text-[11px]">{"★".repeat(n)}{"☆".repeat(3 - n)}</span>;
}

function NewsCard({ item, highlight }: { item: EnrichedNews; highlight: boolean }) {
  return (
    <a href={item.url} target="_blank" rel="noopener noreferrer"
      className={`block px-3 py-2.5 hover:bg-white/5 transition ${highlight ? "bg-amber-500/5 border-l-2 border-amber-400" : ""}`}>
      <div className="flex items-start gap-2">
        <SentimentDot s={item.sentiment} />
        <div className="flex-1 min-w-0">
          <div className={`text-xs leading-snug line-clamp-2 ${highlight ? "font-bold text-amber-200" : "font-medium text-slate-200"}`}>
            {item.title}
          </div>
          {item.boards.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {item.boards.map(b => (
                <span key={b} className="rounded px-1 py-0.5 text-[11px] font-bold bg-slate-500/20 text-slate-300">{b}</span>
              ))}
            </div>
          )}
          {/* v9.24-P1-3：命中主线 + 定价状态（PRD E1） */}
          {item.mainlineHit && (
            <div className="flex flex-wrap gap-1 mt-1">
              <span className="rounded px-1 py-0.5 text-[11px] font-bold bg-amber-500/20 text-amber-300">⚡命中主线：{item.mainlineHit}</span>
              {item.pricing && (
                <span className="rounded px-1 py-0.5 text-[11px] font-bold bg-sky-500/20 text-sky-300">定价：{item.pricing}</span>
              )}
            </div>
          )}
        </div>
        <div className="shrink-0 text-right">
          <Stars n={item.stars} />
          {item.time && <div className="text-[11px] text-slate-500">{item.time.slice(11, 16)}</div>}
        </div>
      </div>
    </a>
  );
}

function ScrollColumn({ title, icon, color, news, linkUrl }: {
  title: string; icon: string; color: string; news: EnrichedNews[]; linkUrl: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || news.length === 0) return;
    let lastTs = 0;
    function step(ts: number) {
      if (!el) return;
      if (!lastTs) lastTs = ts;
      const dt = (ts - lastTs) / 1000; lastTs = ts;
      if (!paused) { el.scrollTop += 22 * dt; if (el.scrollTop >= el.scrollHeight - el.clientHeight - 1) el.scrollTop = 0; }
      rafRef.current = requestAnimationFrame(step);
    }
    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [news, paused]);

  // 3星置顶
  const sorted = [...news].sort((a, b) => b.stars - a.stars);

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between mb-2">
        <div className={`text-xs font-bold ${color}`}>{icon} {title}</div>
        <a href={linkUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-amber-300 hover:text-amber-200">查看全部 →</a>
      </div>
      <div ref={scrollRef} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
        className="h-72 overflow-y-auto rounded-lg border border-white/10 bg-black/20 [scrollbar-width:thin]">
        {sorted.length === 0 ? (
          <div className="flex items-center justify-center h-full text-xs text-slate-500">暂无消息</div>
        ) : (
          <div className="divide-y divide-white/5">
            {sorted.map((n, i) => <NewsCard key={`${n.code}-${i}`} item={n} highlight={n.stars >= 3} />)}
          </div>
        )}
      </div>
    </div>
  );
}

/** 市场快照（由 App 传入，供情报分析台使用） */
export interface MarketSnapshotForNews {
  sentiment: number;
  indices: Array<{ name: string; pct: number }>;
  mainNet: number;
  mainNet5d: number;
  mainNet10d: number;
}

/** slot 枚举：盘前/早盘/午盘/盘后/终盘 */
export type IntelSlot = "pre" | "morning" | "noon" | "afterclose" | "final" | "manual";

function inferSlot(): IntelSlot {
  const session = getCurrentSession();
  const n = new Date();
  const bj = new Date(n.getTime() + (n.getTimezoneOffset() + 480) * 60000);
  const hhmm = bj.getHours() * 100 + bj.getMinutes();
  if (session.phase === "pre" || session.phase === "auction") return "pre";
  if (session.phase === "trading" && hhmm <= 1130) return "morning";
  if (session.phase === "trading" || session.phase === "lunch") return "noon";
  if (hhmm >= 2200) return "final";
  return "afterclose";
}

interface NewsPanelProps {
  autoRefresh?: boolean;
  strongBoards?: string[];
  marketSnapshot?: MarketSnapshotForNews | null;
  /** v9.24-P1-3：今日主线列表（名称+涨停家数），用于消息-主线联动 */
  mainlines?: Array<{ name: string; ztCount: number }>;
}

export default function NewsPanel({ autoRefresh = true, strongBoards = [], marketSnapshot, mainlines = [] }: NewsPanelProps) {
  const [allNews, setAllNews] = useState<EnrichedNews[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [boardFilter, setBoardFilter] = useState<string>("");

  // AI 快讯三行
  const [aiDigest, setAiDigest] = useState<string | null>(null);
  const [aiDegraded, setAiDegraded] = useState(false);
  const [aiDigestLoading, setAiDigestLoading] = useState(false);
  const lastDigestSlot = useRef<string>("");
  const [memoToast, setMemoToast] = useState<string | null>(null);
  const [topAnnouncements, setTopAnnouncements] = useState<AnnItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const generateDigest = useCallback(async (news: EnrichedNews[]) => {
    if (news.length === 0) return;
    setAiDigestLoading(true);
    try {
      // 粗筛到60条
      const headlines = news.slice(0, 60).map(n => n.title);
      const result: AIResult = await callAI("newsDigest", { headlines });
      setAiDigest(result.text);
      setAiDegraded(result.degraded);
    } catch { /* 中枢已降级 */ }
    finally { setAiDigestLoading(false); }
  }, []);

  // 盘中每30分钟自动触发
  useEffect(() => {
    if (allNews.length === 0) return;
    const check = () => {
      const session = getCurrentSession();
      if (session.phase !== "trading") return;
      const now = new Date();
      const bj = new Date(now.getTime() + (now.getTimezoneOffset() + 480) * 60000);
      const min = bj.getMinutes();
      const slot = `${bj.getHours()}:${min < 30 ? "00" : "30"}`;
      if (slot !== lastDigestSlot.current) {
        lastDigestSlot.current = slot;
        generateDigest(allNews);
      }
    };
    check();
    const t = setInterval(check, 60000);
    return () => clearInterval(t);
  }, [allNews, generateDigest]);

  const load = useCallback(async () => {
    try {
      const list = await fetchFastNews(60);
      if (list.length > 0) {
        const enriched = list.map(n => enrichNews(n, mainlines));
        setAllNews(enriched);
        setError(null);
        // 写入全局存储（dataStore 去重+30天滚动）
        upsertNews(enriched.map(n => ({
          code: n.code, title: n.title, summary: n.summary ?? "",
          boards: n.boards, sentiment: n.sentiment, stars: n.stars,
          isOverseas: n.isOverseas, time: n.time, url: n.url,
        })));
      }
      else setError("快讯数据暂时无法获取");
    } catch { setError("快讯数据暂时无法获取"); }
    finally { setLoading(false); }
  // v9.26.10：mainlines 入依赖（此前闭包捕获首渲染空数组 → "命中主线"标签失效）
  }, [mainlines]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!autoRefresh) return; const t = setInterval(load, 30000); return () => clearInterval(t); }, [autoRefresh, load]);

  if (loading) return <div className="text-slate-400 text-sm">加载快讯中…</div>;
  if (error && allNews.length === 0) return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-300">
      {error} <a href="https://kuaixun.eastmoney.com/" target="_blank" rel="noopener noreferrer" className="ml-2 underline">点击查看 →</a>
    </div>
  );

  // 分类 + 筛选
  let domestic = allNews.filter(n => !n.isOverseas);
  let overseas = allNews.filter(n => n.isOverseas);
  if (boardFilter) {
    domestic = domestic.filter(n => n.boards.includes(boardFilter));
    overseas = overseas.filter(n => n.boards.includes(boardFilter));
  }

  // 所有出现过的板块
  const allBoards = [...new Set(allNews.flatMap(n => n.boards))].sort();

  return (
    <section className="space-y-3">
      {/* 情报库备份/恢复 */}
      <div className="flex items-center justify-end gap-2">
        <button onClick={() => { exportMemoBackup(); setMemoToast("备份已下载"); setTimeout(() => setMemoToast(null), 3000); }}
          className="rounded px-2 py-1 text-[11px] bg-white/5 text-slate-400 hover:text-slate-200 hover:bg-white/10 border border-white/10">
          📥 备份情报库
        </button>
        <button onClick={() => fileInputRef.current?.click()}
          className="rounded px-2 py-1 text-[11px] bg-white/5 text-slate-400 hover:text-slate-200 hover:bg-white/10 border border-white/10">
          📤 恢复情报库
        </button>
        <input ref={fileInputRef} type="file" accept=".json" className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
              const ok = importMemoBackup(reader.result as string);
              setMemoToast(ok ? "记忆恢复成功" : "文件格式错误");
              setTimeout(() => setMemoToast(null), 3000);
            };
            reader.readAsText(file);
            e.target.value = ""; // 允许重复选择同一文件
          }}
        />
        {memoToast && (
          <span className="rounded px-2 py-0.5 text-[11px] bg-emerald-500/20 text-emerald-300 animate-pulse">
            {memoToast}
          </span>
        )}
      </div>

      {/* 全栈情报分析台 */}
      <IntelligenceDashboard
        news={allNews.map(n => ({
          code: n.code, title: n.title, summary: n.summary ?? "",
          boards: n.boards, sentiment: n.sentiment, stars: n.stars,
          isOverseas: n.isOverseas, time: n.time, url: n.url,
        } as IntelNewsItem))}
        announcements={topAnnouncements}
        strongBoards={strongBoards}
        slot={inferSlot()}
        marketSnapshot={marketSnapshot ?? undefined}
      />

      {/* 公告淘金分区：盘后全市场公告扫描 */}
      <AnnouncementPanel onTopAnnouncements={setTopAnnouncements} />

      {/* AI 快讯三行：固定在滚动条上方 */}
      <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 px-3 py-2 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-violet-300">🤖 AI要点</span>
          <div className="flex items-center gap-2">
            {aiDegraded && <span className="rounded px-1 py-0.5 text-[9px] font-bold bg-amber-500/20 text-amber-300">规则版</span>}
            <button onClick={() => generateDigest(allNews)} disabled={aiDigestLoading}
              className="text-[11px] text-violet-400 hover:text-violet-300 disabled:opacity-40">
              {aiDigestLoading ? "生成中…" : "刷新"}
            </button>
          </div>
        </div>
        {aiDigest ? (
          <div className="text-[11px] text-slate-300 leading-relaxed whitespace-pre-wrap">{aiDigest}</div>
        ) : (
          <div className="text-[11px] text-slate-500">{aiDigestLoading ? "AI分析快讯中…" : "点击刷新生成AI要点摘要"}</div>
        )}
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2">
        <span className="text-xs text-slate-400">
          数据源：东方财富 7x24（{autoRefresh ? "每30秒刷新" : "已暂停"}）· ★★★重要消息置顶加粗 · <SentimentDot s="positive" />利好 <SentimentDot s="negative" />利空 <SentimentDot s="neutral" />中性
        </span>
        <div className="flex items-center gap-2">
          <select value={boardFilter} onChange={e => setBoardFilter(e.target.value)}
            className="rounded bg-black/30 border border-white/10 px-2 py-1 text-[11px] text-slate-300 outline-none">
            <option value="">全部板块</option>
            {allBoards.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          <a href="https://kuaixun.eastmoney.com/" target="_blank" rel="noopener noreferrer" className="text-[11px] text-amber-300 hover:text-amber-200 shrink-0">查看全部 →</a>
        </div>
      </div>

      <div className="flex gap-4">
        <ScrollColumn title="国内重要消息" icon="🇨🇳" color="text-rose-400" news={domestic} linkUrl="https://kuaixun.eastmoney.com/" />
        <ScrollColumn title="外围国际消息" icon="🌍" color="text-slate-400" news={overseas} linkUrl="https://kuaixun.eastmoney.com/" />
      </div>
    </section>
  );
}
