import { useState, useEffect } from "react";

interface NewsItem {
  title: string;
  time: string;
  url: string;
}

export default function NewsPanel() {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 直接显示一些真实新闻入口链接
    // 东方财富新闻API需要jsonp，这里提供直接入口
    setLoading(false);
    setNews([
      { title: "📰 东方财富财经新闻 - 实时更新", time: "实时", url: "https://finance.eastmoney.com/" },
      { title: "📊 东方财富数据中心 - 市场数据一览", time: "实时", url: "https://data.eastmoney.com/" },
      { title: "🏛️ 证监会官网 - 监管动态", time: "实时", url: "http://www.csrc.gov.cn/" },
      { title: "📋 上交所公告 - 上市公司公告", time: "实时", url: "http://www.sse.com.cn/disclosure/listedinfo/announcement/" },
      { title: "📋 深交所公告 - 上市公司公告", time: "实时", url: "http://www.szse.cn/disclosure/listed/notice/index.html" },
      { title: "🌍 新浪财经 - 全球市场新闻", time: "实时", url: "https://finance.sina.com.cn/" },
      { title: "📈 同花顺财经 - 行情与资讯", time: "实时", url: "https://www.10jqka.com.cn/" },
      { title: "💹 雪球 - 投资者社区", time: "实时", url: "https://xueqiu.com/" },
    ]);
  }, []);

  if (loading) {
    return <div className="text-slate-400 text-sm">加载快讯中…</div>;
  }

  return (
    <section className="space-y-3">
      <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs text-slate-400">
        政策与新闻快讯入口（降权模块，仅作参考，不作为交易决策依据）· 点击跳转到各平台真实页面
      </div>
      <div className="divide-y divide-white/5 rounded-xl border border-white/10 bg-white/5">
        {news.map((n, i) => (
          <a key={i} href={n.url} target="_blank" rel="noopener noreferrer"
            className="block p-3 text-sm hover:bg-white/5 transition border-b border-white/5 last:border-0">
            <div className="text-slate-200 font-medium">{n.title}</div>
            <div className="mt-1 flex items-center justify-between text-[11px]">
              <span className="text-slate-500">{n.time}</span>
              <span className="text-amber-300">点击访问 →</span>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}
