import { useState, useEffect, useCallback, useRef } from "react";
import { fetchMarketAnnouncements, type MarketAnnouncement } from "../lib/api";
import { callAI, parseAIJSON } from "../lib/ai";
import type { AnnItem } from "../lib/llmNewsIntelligence";
import { upsertAnnouncements } from "../lib/dataStore";
import { getIndustryByCode, matchBoardsByText } from "../lib/boardMap";
// v9.32.1（缺口7）：公告类型聚类标签
import { clusterAnnouncement, ANN_CATEGORY_META } from "../lib/annCluster";

// ============== AI 公告归因结果 ==============
interface AnnAIScore {
  code: string;
  theme: string;
  score: number; // 1-5
  logic: string;
  watch: string;
}

// AI 归因缓存 key
function aiAnnCacheKey(): string {
  const d = new Date();
  return `ai:annrank:${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function loadAIScores(): Map<string, AnnAIScore> {
  try {
    const raw = localStorage.getItem(aiAnnCacheKey());
    if (!raw) return new Map();
    const arr: AnnAIScore[] = JSON.parse(raw);
    const map = new Map<string, AnnAIScore>();
    for (const s of arr) map.set(s.code, s);
    return map;
  } catch { return new Map(); }
}

function saveAIScores(map: Map<string, AnnAIScore>): void {
  try { localStorage.setItem(aiAnnCacheKey(), JSON.stringify([...map.values()])); } catch { /* 静默 */ }
}

// ============== 关键词打标正则 ==============
// 利好：命中即贴绿色标签
const GOOD_RE =
  /中标|成交|签订|框架协议|战略合作|投产|量产|涨价|提价|回购|增持|股权激励|实际控制人变更|重组|注入/;
// 利空：命中即贴红色标签
const BAD_RE =
  /减持|立案|警示函|问询|预亏|商誉减值|解禁|质押/;

// ============== 三级评级规则 ==============
// ★★★ → 置顶+金色左边框
const STAR3_RE = /中标|涨价|投产|重组|实际控制人变更/;
// ★★
const STAR2_RE = /框架协议|战略合作|增持|回购/;
// ★ → 其余利好/利空

// 提取命中的关键词作为标签文本
function extractTags(title: string): { good: string[]; bad: string[] } {
  const good: string[] = [];
  const bad: string[] = [];
  // 利好关键词逐个匹配
  const goodWords = [
    "中标", "成交", "签订", "框架协议", "战略合作", "投产", "量产",
    "涨价", "提价", "回购", "增持", "股权激励", "实际控制人变更", "重组", "注入",
  ];
  for (const w of goodWords) {
    if (title.includes(w) && !good.includes(w)) good.push(w);
  }
  // 利空关键词逐个匹配
  const badWords = ["减持", "立案", "警示函", "问询", "预亏", "商誉减值", "解禁", "质押"];
  for (const w of badWords) {
    if (title.includes(w) && !bad.includes(w)) bad.push(w);
  }
  return { good, bad };
}

// 计算评级星数
function rateAnnouncement(title: string): number {
  if (STAR3_RE.test(title)) return 3;
  if (STAR2_RE.test(title)) return 2;
  if (GOOD_RE.test(title) || BAD_RE.test(title)) return 1;
  return 0; // 无标签 → 不评级
}

// ============== 增量 + 缓存逻辑 ==============
// 当日缓存 key：ann:YYYY-MM-DD
function todayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `ann:${y}-${m}-${dd}`;
}

// 判断当前是否处于公告高峰期 15:05-19:00
function isAnnouncementPeak(): boolean {
  const now = new Date();
  const hhmm = now.getHours() * 100 + now.getMinutes();
  return hhmm >= 1505 && hhmm <= 1900;
}

interface CachedAnnData {
  items: MarketAnnouncement[];
  lastFetch: number; // timestamp
}

function loadCache(): CachedAnnData | null {
  try {
    const raw = localStorage.getItem(todayKey());
    if (!raw) return null;
    return JSON.parse(raw) as CachedAnnData;
  } catch {
    return null;
  }
}

function saveCache(data: CachedAnnData) {
  try {
    localStorage.setItem(todayKey(), JSON.stringify(data));
    // 跨日清理：只保留最近5个交易日的缓存
    cleanOldCache();
  } catch { /* localStorage 满了等极端情况静默忽略 */ }
}

function cleanOldCache() {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("ann:")) keys.push(k);
    }
    // 按日期倒序排列，删除超过5个的
    keys.sort().reverse();
    for (let i = 5; i < keys.length; i++) {
      localStorage.removeItem(keys[i]);
    }
  } catch { /* 静默 */ }
}

// ============== 聚合同股公告 ==============
interface EnrichedAnnouncement extends MarketAnnouncement {
  goodTags: string[];
  badTags: string[];
  stars: number;
  isNew: boolean;
}

interface GroupedAnnouncement {
  stockCode: string;
  stockName: string;
  items: EnrichedAnnouncement[];
  maxStars: number;
  hasNew: boolean;
}

type FilterType = "all" | "good" | "bad";

interface AnnPanelProps {
  onTopAnnouncements?: (items: AnnItem[]) => void;
}

export default function AnnouncementPanel({ onTopAnnouncements }: AnnPanelProps = {}) {
  const [items, setItems] = useState<EnrichedAnnouncement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>("all");
  const [aiScores, setAiScores] = useState<Map<string, AnnAIScore>>(() => loadAIScores());
  const aiTriggeredRef = useRef(false);
  const dailyFallbackRef = useRef(false);
  const lastCallbackHash = useRef("");
  // v9.26.10：items ref 镜像（loadAnnouncements 闭包 [] 依赖内读最新值）
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);

  // 向父组件回调 Top12 利好公告（含 AI 评分）
  useEffect(() => {
    if (!onTopAnnouncements || items.length === 0) return;
    // 利好排序：stars 降序 → AI score 降序
    const sorted = [...items]
      .filter(a => a.goodTags.length > 0 || a.stars >= 2)
      .sort((a, b) => b.stars - a.stars)
      .slice(0, 12);
    // 去重检查：与上次相同不重复调用
    const hash = sorted.map(a => a.artCode).join(",");
    if (hash === lastCallbackHash.current) return;
    lastCallbackHash.current = hash;
    const mapped: AnnItem[] = sorted.map(a => {
      const aiScore = aiScores.get(a.stockCode);
      return {
        artCode: a.artCode,
        stockCode: a.stockCode,
        stockName: a.stockName,
        title: a.title,
        columnName: a.columnName,
        boards: (() => { const ind = getIndustryByCode(a.stockCode); return ind ? [ind] : matchBoardsByText(`${a.title} ${a.stockName ?? ""}`); })(),
        score: aiScore?.score,
        logic: aiScore?.logic,
        url: a.url,
        time: a.time,
      };
    });
    onTopAnnouncements(mapped);
  }, [items, aiScores, onTopAnnouncements]);

  // AI 归因：新★★/★★★条目出现时批量调用
  // 修复：去重键统一为 stockCode（与 aiScores 的存取、UI 展示完全一致）。
  // 之前 has(a.artCode) 判断但存 s.code(stockCode) → 永远判"未评分" → 重复触发 AI 调用
  const triggerAIRank = useCallback(async (anns: EnrichedAnnouncement[]) => {
    const highStars = anns.filter(a => a.stars >= 2 && !aiScores.has(a.stockCode));
    if (highStars.length === 0) return;
    // 每次最多15条
    const batch = highStars.slice(0, 15);
    try {
      const result = await callAI("annRank", {
        announcements: batch.map(a => ({
          code: a.stockCode, name: a.stockName,
          title: a.title, column: a.columnName,
        })),
      });
      if (!result.degraded) {
        const parsed = parseAIJSON<AnnAIScore[]>(result.text, ["code", "score"]);
        if (parsed) {
          const updated = new Map(aiScores);
          for (const s of parsed) updated.set(s.code, s);
          setAiScores(updated);
          saveAIScores(updated);
        }
      }
    } catch { /* callAI 内部已降级 */ }
  }, [aiScores]);

  // 当 items 变化且有新★★★/★★时触发AI
  useEffect(() => {
    if (items.length === 0 || aiTriggeredRef.current) return;
    const highStars = items.filter(a => a.stars >= 2);
    if (highStars.length > 0) {
      aiTriggeredRef.current = true;
      triggerAIRank(items);
    }
  }, [items, triggerAIRank]);

  // 每日18:30兜底补一次
  useEffect(() => {
    const check = () => {
      if (dailyFallbackRef.current || items.length === 0) return;
      const now = new Date();
      const bj = new Date(now.getTime() + (now.getTimezoneOffset() + 480) * 60000);
      const hhmm = bj.getHours() * 100 + bj.getMinutes();
      if (hhmm >= 1830) {
        dailyFallbackRef.current = true;
        triggerAIRank(items);
      }
    };
    check();
    const t = setInterval(check, 300000); // 每5分钟检查
    return () => clearInterval(t);
  }, [items, triggerAIRank]);
  // 记录已知的 artCode 集合，用于标记 NEW
  const knownCodesRef = useRef<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 加载公告（含缓存逻辑）
  const loadAnnouncements = useCallback(async (isAutoRefresh = false) => {
    try {
      const cached = loadCache();
      const now = Date.now();

      // 非高峰且有缓存 → 直接用缓存，不发请求（进入时拉一次除外）
      if (isAutoRefresh && !isAnnouncementPeak() && cached) {
        return;
      }

      // 高峰期 10 分钟内有缓存 → 不重复拉
      if (isAutoRefresh && cached && now - cached.lastFetch < 10 * 60 * 1000) {
        return;
      }

      const rawList = await fetchMarketAnnouncements(100);

      // 从缓存获取已知 artCode 集合
      if (cached) {
        for (const item of cached.items) {
          knownCodesRef.current.add(item.artCode);
        }
      }

      // 标记增量 NEW：不在已知集合中的为新条目
      const enriched: EnrichedAnnouncement[] = rawList.map((item) => {
        const { good, bad } = extractTags(item.title);
        const stars = rateAnnouncement(item.title);
        const isNew = !isAutoRefresh ? false : !knownCodesRef.current.has(item.artCode);
        return { ...item, goodTags: good, badTags: bad, stars, isNew };
      });

      // 更新已知集合
      for (const item of enriched) {
        knownCodesRef.current.add(item.artCode);
      }

      // 合并缓存：保留缓存中本次未返回的旧条目（避免分页丢失）
      const newCodes = new Set(enriched.map((i) => i.artCode));
      const merged = [...enriched];
      if (cached) {
        for (const oldItem of cached.items) {
          if (!newCodes.has(oldItem.artCode)) {
            // 旧条目保留但不标 NEW
            const { good, bad } = extractTags(oldItem.title);
            const stars = rateAnnouncement(oldItem.title);
            merged.push({ ...oldItem, goodTags: good, badTags: bad, stars, isNew: false });
          }
        }
      }

      // 按时间倒序排列
      merged.sort((a, b) => b.time.localeCompare(a.time));

      setItems(merged);
      setError(null);

      // 保存缓存
      saveCache({ items: merged, lastFetch: now });

      // 写入全局存储（dataStore 去重+30天滚动）
      upsertAnnouncements(merged.map(a => {
        const aiScore = aiScores.get(a.stockCode);
        return {
          artCode: a.artCode, stockCode: a.stockCode, stockName: a.stockName,
          title: a.title, columnName: a.columnName,
          boards: (() => { const ind = getIndustryByCode(a.stockCode); return ind ? [ind] : matchBoardsByText(`${a.title} ${a.stockName ?? ""}`); })(),
          score: aiScore?.score, logic: aiScore?.logic,
          url: a.url, time: a.time,
        };
      }));
    } catch {
      // 接口失败时显示"待接入"（v9.26.10：读 ref 最新值，闭包旧值判断失效）
      if (itemsRef.current.length === 0) {
        setError("待接入");
      }
      // 有缓存数据时保留显示
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 初始加载：先尝试读缓存秒读，然后拉一次最新
  useEffect(() => {
    const cached = loadCache();
    if (cached && cached.items.length > 0) {
      // 秒读缓存
      const enriched: EnrichedAnnouncement[] = cached.items.map((item) => {
        const { good, bad } = extractTags(item.title);
        const stars = rateAnnouncement(item.title);
        return { ...item, goodTags: good, badTags: bad, stars, isNew: false };
      });
      setItems(enriched);
      setLoading(false);
      // 记录已知 codes
      for (const item of enriched) {
        knownCodesRef.current.add(item.artCode);
      }
    }
    // 无论有无缓存都拉一次最新
    loadAnnouncements(false);
  }, [loadAnnouncements]);

  // 高峰期自动刷新：每 10 分钟检查
  useEffect(() => {
    timerRef.current = setInterval(() => {
      loadAnnouncements(true);
    }, 10 * 60 * 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [loadAnnouncements]);

  // ============== 筛选逻辑 ==============
  const filtered = items.filter((item) => {
    if (filter === "good") return item.goodTags.length > 0;
    if (filter === "bad") return item.badTags.length > 0;
    return true;
  });

  // ============== 同股合并 ==============
  const groupedMap = new Map<string, GroupedAnnouncement>();
  for (const item of filtered) {
    const key = item.stockCode || item.artCode; // 无股票代码的用 artCode
    const existing = groupedMap.get(key);
    if (existing) {
      existing.items.push(item);
      existing.maxStars = Math.max(existing.maxStars, item.stars);
      existing.hasNew = existing.hasNew || item.isNew;
    } else {
      groupedMap.set(key, {
        stockCode: item.stockCode,
        stockName: item.stockName,
        items: [item],
        maxStars: item.stars,
        hasNew: item.isNew,
      });
    }
  }
  // ★★★ 置顶，然后按时间倒序
  const grouped = [...groupedMap.values()].sort((a, b) => {
    if (a.maxStars !== b.maxStars) return b.maxStars - a.maxStars;
    return b.items[0].time.localeCompare(a.items[0].time);
  });

  // ============== 统计 ==============
  const goodCount = items.filter((i) => i.goodTags.length > 0).length;
  const badCount = items.filter((i) => i.badTags.length > 0).length;
  const newCount = items.filter((i) => i.isNew).length;

  // ============== 渲染 ==============
  if (loading && items.length === 0) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/5 p-4">
        <div className="text-xs text-slate-400 animate-pulse">加载公告数据中…</div>
      </div>
    );
  }

  if (error && items.length === 0) {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-amber-300">📋 公告淘金</span>
          <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[11px] text-amber-300">{error}</span>
        </div>
        <div className="mt-2 text-xs text-slate-400">
          全市场公告接口暂时无法访问，请稍后重试。
          <a href="https://data.eastmoney.com/notices/" target="_blank" rel="noopener noreferrer"
            className="ml-2 text-amber-300 underline hover:text-amber-200">
            手动查看 →
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-3">
      {/* 标题栏 */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-amber-200">📋 公告淘金</span>
          <span className="text-[11px] text-slate-500">
            共{items.length}条
            {newCount > 0 && (
              <span className="ml-1 text-emerald-400 font-bold">+{newCount} NEW</span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* 筛选按钮 */}
          <div className="flex rounded-md overflow-hidden border border-white/10">
            {([
              { key: "all" as FilterType, label: `全部`, count: items.length },
              { key: "good" as FilterType, label: `利好`, count: goodCount },
              { key: "bad" as FilterType, label: `利空`, count: badCount },
            ]).map(({ key, label, count }) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`px-2.5 py-1 text-[11px] transition ${
                  filter === key
                    ? "bg-amber-500/20 text-amber-200 font-bold"
                    : "bg-black/20 text-slate-400 hover:text-slate-300"
                }`}
              >
                {label}({count})
              </button>
            ))}
          </div>
          <span className="text-[11px] text-slate-500">
            {isAnnouncementPeak() ? "📡 高峰期·10min刷新" : "💤 非高峰·首次加载"}
          </span>
          <a href="https://data.eastmoney.com/notices/" target="_blank" rel="noopener noreferrer"
            className="text-[11px] text-amber-300 hover:text-amber-200 shrink-0">
            公告大全 →
          </a>
        </div>
      </div>

      {/* 说明栏 */}
      <div className="text-[11px] text-slate-500 flex items-center gap-3">
        <span>★★★=中标/涨价/投产/重组/控制人变更</span>
        <span>★★=合作/增持/回购</span>
        <span>★=其余利好利空</span>
        <span className="text-emerald-400">■利好</span>
        <span className="text-rose-400">■利空</span>
      </div>

      {/* 公告列表 */}
      <div className="max-h-[400px] overflow-y-auto [scrollbar-width:thin] space-y-0.5">
        {grouped.length === 0 ? (
          <div className="text-xs text-slate-500 text-center py-4">暂无匹配公告</div>
        ) : (
          grouped.map((group) => (
            <AnnGroup key={group.stockCode || group.items[0].artCode} group={group} aiScores={aiScores} />
          ))
        )}
      </div>
    </div>
  );
}

// ============== 单个分组（同股合并）渲染 ==============
function AnnGroup({ group, aiScores }: { group: GroupedAnnouncement; aiScores: Map<string, AnnAIScore> }) {
  const [expanded, setExpanded] = useState(false);
  const firstItem = group.items[0];
  const hasMultiple = group.items.length > 1;

  // ★★★ 金色左边框
  const borderClass =
    group.maxStars >= 3
      ? "border-l-2 border-amber-400 bg-amber-500/5"
      : "";

  return (
    <div className={`${borderClass}`}>
      {/* 主行：显示第一条公告 */}
      <AnnRow item={firstItem} showStock={true} badge={hasMultiple ? group.items.length : undefined} aiScore={aiScores.get(firstItem.stockCode)} />

      {/* 多条公告展开 */}
      {hasMultiple && (
        <>
          <button
            onClick={() => setExpanded(!expanded)}
            className="ml-10 text-[11px] text-amber-300/70 hover:text-amber-200 py-0.5"
          >
            {expanded ? "▲ 收起" : `▼ 展开另外${group.items.length - 1}条公告`}
          </button>
          {expanded &&
            group.items.slice(1).map((item) => (
              <AnnRow key={item.artCode} item={item} showStock={false} aiScore={aiScores.get(item.stockCode)} />
            ))}
        </>
      )}
    </div>
  );
}

// ============== 单行公告渲染 ==============
function AnnRow({
  item,
  showStock,
  badge,
  aiScore,
}: {
  item: EnrichedAnnouncement;
  showStock: boolean;
  badge?: number;
  aiScore?: AnnAIScore;
}) {
  // 标题截断60字
  const displayTitle =
    item.title.length > 60 ? item.title.slice(0, 60) + "…" : item.title;

  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 px-3 py-1.5 hover:bg-white/5 transition group"
    >
      {/* 时间 */}
      <span className="shrink-0 text-[11px] text-slate-500 w-[42px]">
        {item.time.slice(11, 16) || item.time.slice(5, 10)}
      </span>

      {/* 股票名 */}
      {showStock && (
        <span className="shrink-0 text-[11px] font-bold text-slate-300 w-[56px] truncate">
          {item.stockName || "—"}
          {badge && badge > 1 && (
            <span className="ml-0.5 inline-flex items-center justify-center rounded-full bg-amber-500/20 text-amber-300 text-[9px] font-bold w-4 h-4 leading-none">
              {badge}
            </span>
          )}
        </span>
      )}

      {/* 标签 */}
      <span className="shrink-0 flex gap-0.5">
        {/* v9.32.1（缺口7）：公告类型聚类标签 */}
        <span className={`rounded px-1 py-0.5 text-[10px] font-bold ${ANN_CATEGORY_META[clusterAnnouncement(item.title, item.columnName)].color}`}>
          {ANN_CATEGORY_META[clusterAnnouncement(item.title, item.columnName)].short}
        </span>
        {item.goodTags.map((t) => (
          <span
            key={t}
            className="rounded px-1 py-0.5 text-[10px] font-bold bg-emerald-500/20 text-emerald-300"
          >
            {t}
          </span>
        ))}
        {item.badTags.map((t) => (
          <span
            key={t}
            className="rounded px-1 py-0.5 text-[10px] font-bold bg-rose-500/20 text-rose-300"
          >
            {t}
          </span>
        ))}
      </span>

      {/* NEW 标记 */}
      {item.isNew && (
        <span className="shrink-0 rounded px-1 py-0.5 text-[9px] font-bold bg-emerald-500/30 text-emerald-200 animate-pulse">
          NEW
        </span>
      )}

      {/* 标题 */}
      <span className="flex-1 min-w-0 text-xs text-slate-300 truncate group-hover:text-slate-100">
        {displayTitle}
      </span>

      {/* AI评分 */}
      {aiScore && (
        <span className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-bold ${
          aiScore.score >= 4 ? "bg-emerald-500/20 text-emerald-300" :
          aiScore.score >= 3 ? "bg-amber-500/20 text-amber-300" :
          "bg-slate-500/20 text-slate-400"
        }`} title={`${aiScore.logic} · ${aiScore.watch}`}>
          AI{aiScore.score}
        </span>
      )}

      {/* 星级 */}
      {item.stars > 0 && (
        <span className="shrink-0 text-amber-400 text-[11px]">
          {"★".repeat(item.stars)}{"☆".repeat(3 - item.stars)}
        </span>
      )}
    </a>
  );
}
