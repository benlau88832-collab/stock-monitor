import { useState, useEffect, useRef, useCallback } from "react";
import { fetchFastNews, type FastNewsItem } from "../lib/api";

export default function NewsPanel({ autoRefresh = true }: { autoRefresh?: boolean }) {
  const [news, setNews] = useState<FastNewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await fetchFastNews(30);
      if (list.length > 0) {
        setNews(list);
        setError(null);
      } else {
        setError("快讯数据暂时无法获取，请稍后重试");
      }
    } catch {
      setError("快讯数据暂时无法获取，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, []);

  // 首次加载一次（无论开关状态如何，进入页面都应看到最新快讯）
  useEffect(() => {
    load();
  }, [load]);

  // 自动刷新受顶部导航「自动刷新开/关」全局开关统一控制，与其他模块行为保持一致
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, [autoRefresh, load]);

  // 自动向上滚动（鼠标悬停时暂停），到底部后无缝回到顶部
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || news.length === 0) return;

    let lastTs = 0;
    const speed = 28; // px/秒

    function step(ts: number) {
      if (!el) return;
      if (!lastTs) lastTs = ts;
      const dt = (ts - lastTs) / 1000;
      lastTs = ts;
      if (!paused) {
        el.scrollTop += speed * dt;
        if (el.scrollTop >= el.scrollHeight - el.clientHeight - 1) {
          el.scrollTop = 0;
        }
      }
      rafRef.current = requestAnimationFrame(step);
    }
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [news, paused]);

  if (loading) {
    return <div className="text-slate-400 text-sm">加载快讯中…</div>;
  }

  if (error && news.length === 0) {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-300">
        {error}
        <a
          href="https://kuaixun.eastmoney.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="ml-2 text-amber-200 underline hover:text-amber-100"
        >
          点击直接查看东方财富快讯 →
        </a>
      </div>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs text-slate-400">
        <span>
          数据源：东方财富 7x24 全球直播快讯接口（真实滚动更新，{autoRefresh ? "每30秒自动刷新" : "自动刷新已关闭"}）· 悬停可暂停滚动 · 点击可跳转到东方财富真实新闻页
        </span>
        <a
          href="https://kuaixun.eastmoney.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="ml-3 shrink-0 text-amber-300 hover:text-amber-200"
        >
          查看全部 →
        </a>
      </div>

      <div
        ref={scrollRef}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        className="h-80 overflow-y-auto rounded-xl border border-white/10 bg-white/5 [scrollbar-width:thin]"
      >
        <div className="divide-y divide-white/5">
          {news.map((n, i) => (
            <a
              key={`${n.code}-${i}`}
              href={n.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block p-3 text-sm hover:bg-white/5 transition"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="text-slate-200 font-medium leading-snug">{n.title}</div>
                <span className="shrink-0 text-[11px] text-slate-500">{n.time.slice(11, 16)}</span>
              </div>
              {n.summary && n.summary !== n.title && (
                <div className="mt-1 line-clamp-2 text-[12px] text-slate-400">{n.summary}</div>
              )}
              <div className="mt-1 text-[11px] text-amber-300">点击查看原文 →</div>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
