import { useState, useEffect, useRef, useCallback } from "react";
import { fetchFastNews, type FastNewsItem } from "../lib/api";

// ============== 板块关键词匹配 ==============
const BOARD_KEYWORDS: Array<{ keywords: string[]; board: string }> = [
  { keywords: ["芯片", "半导体", "光刻", "封装", "台积电"], board: "半导体" },
  { keywords: ["AI", "人工智能", "算力", "大模型", "ChatGPT", "Kimi"], board: "AI概念" },
  { keywords: ["新能源", "锂电", "光伏", "储能", "风电"], board: "新能源" },
  { keywords: ["汽车", "整车", "新能源车", "特斯拉", "比亚迪"], board: "汽车" },
  { keywords: ["医药", "医疗", "生物", "创新药", "疫苗"], board: "医药" },
  { keywords: ["军工", "航天", "国防", "导弹"], board: "军工" },
  { keywords: ["银行", "保险", "证券", "券商", "金融"], board: "金融" },
  { keywords: ["地产", "房地产", "楼市", "房价"], board: "地产" },
  { keywords: ["消费", "白酒", "食品", "零售", "旅游"], board: "消费" },
  { keywords: ["黄金", "贵金属", "金价"], board: "黄金" },
  { keywords: ["石油", "原油", "天然气", "化工"], board: "能源化工" },
  { keywords: ["ETF", "基金", "指数", "沪深300"], board: "基金" },
];

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
}

function enrichNews(item: FastNewsItem): EnrichedNews {
  const text = item.title + item.summary;
  const boards = BOARD_KEYWORDS.filter(b => b.keywords.some(kw => text.includes(kw))).map(b => b.board);
  const isNeg = /下跌|利空|暴雷|退市|亏损|减持|违规|处罚|风险|预警|暴跌|崩盘|反倾销|调查|关税|诉讼|制裁|违约|爆仓|踩雷|破产|清仓|被罚|终止|叫停|停牌核查/.test(text);
  const isPos = /利好|上涨|增持|分红|业绩预增|中标|新高|扭亏|大涨|重磅利好|突破|批准|获批|合作|签约|中标|回购/.test(text);
  const sentiment = isNeg ? "negative" as const : isPos ? "positive" as const : "neutral" as const;
  let stars = 1;
  if (STAR3_KEYWORDS.some(kw => text.includes(kw))) stars = 3;
  else if (STAR2_KEYWORDS.some(kw => text.includes(kw))) stars = 2;
  const isOverseas = FOREIGN_KEYWORDS.some(kw => text.includes(kw));
  return { ...item, boards, sentiment, stars, isOverseas };
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
                <span key={b} className="rounded px-1 py-0.5 text-[11px] font-bold bg-sky-500/20 text-sky-300">{b}</span>
              ))}
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

export default function NewsPanel({ autoRefresh = true }: { autoRefresh?: boolean }) {
  const [allNews, setAllNews] = useState<EnrichedNews[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [boardFilter, setBoardFilter] = useState<string>("");

  const load = useCallback(async () => {
    try {
      const list = await fetchFastNews(60);
      if (list.length > 0) { setAllNews(list.map(enrichNews)); setError(null); }
      else setError("快讯数据暂时无法获取");
    } catch { setError("快讯数据暂时无法获取"); }
    finally { setLoading(false); }
  }, []);

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
        <ScrollColumn title="外围国际消息" icon="🌍" color="text-sky-400" news={overseas} linkUrl="https://kuaixun.eastmoney.com/" />
      </div>
    </section>
  );
}
