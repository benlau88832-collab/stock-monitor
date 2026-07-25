"use client";

import { newsRealUrl } from "@/lib/realLinks";

export default function NewsPanel({ data, loading }: { data: any; loading: boolean }) {
  if (!data && loading) {
    return <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-slate-400">加载快讯中…</div>;
  }
  const news = data?.news ?? [];
  return (
    <section className="space-y-3">
      <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs text-slate-400">
        政策与新闻快讯（降权模块，仅作参考，不作为交易决策依据）
      </div>
      <div className="divide-y divide-white/5 rounded-xl border border-white/10 bg-white/5">
        {news.length === 0 && <div className="p-4 text-slate-500">暂无快讯数据</div>}
        {news.map((n: any, i: number) => (
          <a key={i} href={newsRealUrl(n.title, n.url)} target="_blank" rel="noopener noreferrer" className="block p-3 text-sm hover:bg-white/5 transition border-b border-white/5 last:border-0">
            <div className="text-slate-200 font-medium">{n.title}</div>
            <div className="mt-1 flex items-center justify-between text-[11px]">
              <span className="text-slate-500">{n.time}</span>
              <span className="text-amber-300">点击查看东方财富真实新闻 →</span>
            </div>
          </a>
        ))}
      </div>
      {data?.source && <div className="text-[11px] text-slate-500">数据来源：{data.source}</div>}
    </section>
  );
}
