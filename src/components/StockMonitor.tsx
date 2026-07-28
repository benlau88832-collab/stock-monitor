import { useState, useEffect, useCallback } from "react";
import { fmtMoney, fmtPct, pctColor } from "../lib/format";
import { stockRealUrl } from "../lib/realLinks";
import { fetchStockOne, fetchStockNews, fetchStockAnnouncements, type StockNewsItem, type StockAnnouncement } from "../lib/api";

const WATCHLIST_KEY = "stock_watchlist_v1";

function loadWatchlist(): Array<{ code: string; name: string }> {
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveWatchlist(list: Array<{ code: string; name: string }>) {
  try {
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list));
  } catch {
    /* localStorage不可用时静默忽略，不影响主功能 */
  }
}

// 根据新闻标题/摘要关键词做简单的利好/利空/中性判断（真实文本关键词匹配，非编造情绪值）
function judgeSentiment(text: string): "利好" | "利空" | "中性" {
  const bullish = ["增持", "回购", "中标", "签约", "扭亏", "上调", "获批", "涨停", "大涨", "净利润增长", "预增", "创新高", "订单", "合作", "分红"];
  const bearish = ["减持", "亏损", "下调", "跌停", "大跌", "预减", "问询", "处罚", "违规", "诉讼", "冻结", "质押", "退市", "商誉减值", "业绩下滑"];
  const hasBullish = bullish.some((k) => text.includes(k));
  const hasBearish = bearish.some((k) => text.includes(k));
  if (hasBullish && !hasBearish) return "利好";
  if (hasBearish && !hasBullish) return "利空";
  return "中性";
}

function SentimentTag({ text }: { text: string }) {
  const s = judgeSentiment(text);
  const cls =
    s === "利好" ? "bg-rose-500/20 text-rose-300" :
    s === "利空" ? "bg-emerald-500/20 text-emerald-300" :
    "bg-slate-500/20 text-slate-300";
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${cls}`}>{s}</span>;
}

export default function StockMonitor() {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [watchlist, setWatchlist] = useState<Array<{ code: string; name: string }>>([]);
  const [news, setNews] = useState<StockNewsItem[]>([]);
  const [announcements, setAnnouncements] = useState<StockAnnouncement[]>([]);
  const [newsLoading, setNewsLoading] = useState(false);

  useEffect(() => {
    setWatchlist(loadWatchlist());
  }, []);

  const loadNewsAndAnnouncements = useCallback(async (targetCode: string, targetName: string) => {
    setNewsLoading(true);
    try {
      const [newsRes, annRes] = await Promise.allSettled([
        fetchStockNews(targetName || targetCode, 10),
        fetchStockAnnouncements(targetCode, 10),
      ]);
      setNews(newsRes.status === "fulfilled" ? newsRes.value : []);
      setAnnouncements(annRes.status === "fulfilled" ? annRes.value : []);
    } finally {
      setNewsLoading(false);
    }
  }, []);

  async function search(c?: string) {
    const target = (c ?? code).trim();
    if (!/^\d{6}$/.test(target)) {
      setError("请输入正确的 6 位股票代码，如 600519");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await fetchStockOne(target);
      if (!result) {
        setError("未找到该股票");
        setData(null);
      } else {
        setData(result);
        setCode(target);
        loadNewsAndAnnouncements(result.code, result.name);
      }
    } catch (e: any) {
      setError("网络请求失败：" + e?.message);
    } finally {
      setLoading(false);
    }
  }

  const isWatched = data ? watchlist.some((w) => w.code === data.code) : false;

  function toggleWatch() {
    if (!data) return;
    let next: Array<{ code: string; name: string }>;
    if (isWatched) {
      next = watchlist.filter((w) => w.code !== data.code);
    } else {
      next = [...watchlist, { code: data.code, name: data.name }];
    }
    setWatchlist(next);
    saveWatchlist(next);
  }

  function removeFromWatch(c: string) {
    const next = watchlist.filter((w) => w.code !== c);
    setWatchlist(next);
    saveWatchlist(next);
  }

  // 计算一票否决
  const vetoTriggered = data ? data.mainNet < 0 && data.smallNet > 0 && data.mainNet5d < 0 : false;
  const vetoReason = vetoTriggered
    ? "主力净流出+散户净流入+近5日持续流出=结构危险，不建议加仓"
    : data ? (data.mainNet > 0 ? "资金面暂无明显风险信号" : "资金面偏弱，需结合其他信号判断") : "";

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="输入6位股票代码，如 600519"
          className="w-64 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-amber-400"
        />
        <button
          onClick={() => search()}
          disabled={loading}
          className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-bold text-black hover:bg-amber-300 disabled:opacity-50"
        >
          {loading ? "查询中…" : "查询"}
        </button>
        {["600519", "300750", "000001", "002594", "601318", "000858"].map((c) => (
          <button key={c} onClick={() => search(c)} disabled={loading}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-400 hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed">
            {c}
          </button>
        ))}
      </div>

      {watchlist.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-3">
          <div className="mb-2 text-xs font-bold text-slate-300">我的关注（{watchlist.length}）</div>
          <div className="flex flex-wrap gap-2">
            {watchlist.map((w) => (
              <div key={w.code} className="flex items-center gap-1 rounded-lg border border-amber-400/30 bg-amber-400/5 px-2 py-1">
                <button onClick={() => search(w.code)} className="text-xs text-amber-300 hover:text-amber-200">
                  {w.name}（{w.code}）
                </button>
                <button onClick={() => removeFromWatch(w.code)} className="text-xs text-slate-500 hover:text-rose-400" title="取消关注">
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-rose-300">{error}</div>}

      {data && (
        <div className="space-y-4">
          <div className={`rounded-xl border p-4 ${vetoTriggered ? "border-rose-500/50 bg-rose-500/10" : "border-emerald-500/30 bg-emerald-500/5"}`}>
            <div className="flex items-center justify-between">
              <a href={stockRealUrl(data.code)} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 hover:opacity-80 transition">
                <div className="text-xl font-black text-slate-50">
                  {data.name} <span className="text-sm text-slate-500">{data.code}</span>
                </div>
              </a>
              <div className="flex items-center gap-3">
                <button
                  onClick={toggleWatch}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
                    isWatched
                      ? "border-amber-400/50 bg-amber-400/20 text-amber-300 hover:bg-amber-400/30"
                      : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
                  }`}
                >
                  {isWatched ? "★ 已关注" : "☆ 保存关注"}
                </button>
                <div className="text-right">
                  <div className="text-2xl font-bold text-slate-50">{data.price}</div>
                  <div className={`font-semibold ${pctColor(data.pct)}`}>{fmtPct(data.pct)}</div>
                </div>
              </div>
            </div>
            <div className="text-[11px] text-amber-300">点击股票名称查看东方财富实时行情页面 →</div>
            <div className={`mt-3 rounded-lg px-3 py-2 text-sm font-semibold ${vetoTriggered ? "bg-rose-500/20 text-rose-200" : "bg-black/20 text-slate-300"}`}>
              {vetoTriggered ? "🚨 " : ""}{vetoReason}
            </div>
            <div className="mt-3">
              <a href={stockRealUrl(data.code)} target="_blank" rel="noopener noreferrer"
                className="rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-white/5 transition inline-block">
                打开东方财富行情页 →
              </a>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs text-slate-400">今日主力净额</div>
              <div className={`mt-1 text-lg font-bold ${pctColor(data.mainNet)}`}>{fmtMoney(data.mainNet)}</div>
              <div className="mt-2 text-xs text-slate-500">
                超大单 {fmtMoney(data.extraLargeNet)} / 大单 {fmtMoney(data.largeNet)}
              </div>
              <div className="text-xs text-slate-500">
                中单(游资) {fmtMoney(data.mediumNet)} / 小单(散户) {fmtMoney(data.smallNet)}
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs text-slate-400">近5日 / 近10日主力净额</div>
              <div className={`mt-1 text-lg font-bold ${pctColor(data.mainNet5d)}`}>{fmtMoney(data.mainNet5d)}</div>
              <div className={`text-sm font-semibold ${pctColor(data.mainNet10d)}`}>{fmtMoney(data.mainNet10d)}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs text-slate-400">交易指标</div>
              <div className="mt-1 text-sm text-slate-300">换手率 {data.turnoverRate?.toFixed(2)}%</div>
              <div className="text-sm text-slate-300">量比 {data.volumeRatio?.toFixed(2)}</div>
              <div className="text-sm text-slate-300">市盈率(动) {data.pe?.toFixed(2)}</div>
            </div>
          </div>

          {/* 利好利空新闻监控 */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-sm font-bold text-slate-200">📰 {data.name} 相关资讯（利好利空监控）</h4>
              <span className="text-[11px] text-amber-300">数据来自东方财富全文检索接口，真实抓取</span>
            </div>
            {newsLoading ? (
              <div className="text-sm text-slate-500">加载中…</div>
            ) : news.length === 0 ? (
              <div className="text-sm text-slate-500">暂无相关资讯</div>
            ) : (
              <div className="space-y-2">
                {news.map((n, i) => (
                  <a key={`${n.code}-${i}`} href={n.url} target="_blank" rel="noopener noreferrer"
                    className="block rounded-lg border border-white/5 bg-black/20 p-3 hover:bg-black/30 transition">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <SentimentTag text={n.title + n.summary} />
                        <span className="text-sm font-medium text-slate-200">{n.title}</span>
                      </div>
                      <span className="shrink-0 text-[11px] text-slate-500">{n.time.slice(0, 16)}</span>
                    </div>
                    {n.summary && (
                      <div className="mt-1 line-clamp-2 text-[12px] text-slate-400">{n.summary}</div>
                    )}
                    <div className="mt-1 text-[11px] text-amber-300/70">来源：{n.source || "东方财富"} · 点击查看原文 →</div>
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* 公告/资金面重大事项监控 */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-sm font-bold text-slate-200">📋 {data.name} 公司公告（资金面/重大事项监控）</h4>
              <span className="text-[11px] text-amber-300">数据来自东方财富公告接口，真实抓取</span>
            </div>
            {newsLoading ? (
              <div className="text-sm text-slate-500">加载中…</div>
            ) : announcements.length === 0 ? (
              <div className="text-sm text-slate-500">暂无最新公告</div>
            ) : (
              <div className="space-y-2">
                {announcements.map((a, i) => (
                  <a key={`${a.code}-${i}`} href={a.url} target="_blank" rel="noopener noreferrer"
                    className="block rounded-lg border border-white/5 bg-black/20 p-3 hover:bg-black/30 transition">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {a.columnName && <span className="rounded bg-slate-500/20 px-1.5 py-0.5 text-[11px] font-bold text-slate-300">{a.columnName}</span>}
                        <span className="text-sm font-medium text-slate-200">{a.title}</span>
                      </div>
                      <span className="shrink-0 text-[11px] text-slate-500">{a.time.slice(0, 16)}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-amber-300/70">点击查看公告原文 →</div>
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
