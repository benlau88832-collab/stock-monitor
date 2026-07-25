"use client";

import { stockRealUrl, boardRealUrl, newsRealUrl } from "@/lib/realLinks";

export default function Pitfalls() {
  return (
    <section className="rounded-xl border border-rose-500/30 bg-gradient-to-br from-rose-950/20 to-rose-900/10 p-5">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-rose-500 to-rose-300 text-black font-black text-sm">⚠</div>
        <div>
          <h2 className="text-base font-black text-rose-300">A股散户最容易踩的坑 · 避坑指南</h2>
          <p className="text-[11px] text-slate-400">基于东方财富真实数据接口的风险信号识别。所有数据真实可查，无AI幻觉。</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {[
          {
            title: "1. 追涨杀跌（高潮期追入）",
            desc: "板块涨幅已明显放大（≥7%）但今日主力净占比走弱甚至转负，量价背离时盲目追入。真实信号：主力净流入持续下降 + 换手率陡增 >25%。",
            realDataSource: "东方财富板块资金流接口（f3涨跌幅、f62主力净额、f8换手率、f184净占比）",
            avoidTip: "查看板块阶段判断，高潮期 + 主力走弱 = 降级观察，不追涨。",
            link: "https://quote.eastmoney.com/center/boardlist.html#concept_board",
          },
          {
            title: "2. 盲目跟风（无资金验证）",
            desc: "仅看概念热度或涨幅，不验证资金结构。当主力持续流出（5日/10日均为负）而散户（小单）净流入时，结构极不健康。",
            realDataSource: "东方财富分档资金流（f62主力、f84小单、f164/165/174/175连续性）",
            avoidTip: "任何操作前先看「资金结构速览」：主力净流出 + 散户净流入 = 一票否决，不参与。",
            link: "https://quote.eastmoney.com/unify/index.html",
          },
          {
            title: "3. 忽视风险信号（质押/减持/监管）",
            desc: "高股权质押比例（≥50%）存在平仓风险；大股东减持公告意味着筹码松动；监管问询/立案调查直接打击市场信心。",
            realDataSource: "东方财富数据中心 RPT_CSDC_LIST（质押）、公告扫描（减持/监管关键词）",
            avoidTip: "风险雷达模块自动扫描：质押≥30%标记、减持/监管公告直接标红，一票否决触发时不加仓。",
            link: "https://datacenter-web.eastmoney.com/",
          },
          {
            title: "4. 过度交易（高换手率拥挤）",
            desc: "换手率过高（>25%）意味着交易过度拥挤，短线博弈风险陡增。量比>3也意味着短期资金过度集中。",
            realDataSource: "东方财富个股数据（f8换手率、f10量比）",
            avoidTip: "潜力股筛选中自动过滤：换手率>25%触发一票否决，拥挤度「极度拥挤」降权处理。",
            link: "https://quote.eastmoney.com/unify/index.html",
          },
          {
            title: "5. 重仓单一板块（无分散验证）",
            desc: "全仓押注单一概念板块，忽略板块间资金流向差异。当主线板块进入退潮期而其他板块未接力时，风险集中爆发。",
            realDataSource: "东方财富板块资金流（行业/概念/地域分档）",
            avoidTip: "主线识别模块同时展示多个板块阶段，推荐关注「推荐关注」权重板块，避免单一重仓。",
            link: "https://quote.eastmoney.com/center/boardlist.html#concept_board",
          },
          {
            title: "6. 忽略一票否决（结构危险信号）",
            desc: "主力持续净流出（今日+5日+10日均为负）+ 散户净流入 = 典型「主力出、散户进」危险结构。任何技术信号在此结构下都应降权处理。",
            realDataSource: "东方财富资金结构接口（f62/f66/f72/f78/f84/f164/f165/f174/f175）",
            avoidTip: "市场概览顶部自动显示「一票否决警报」：结构危险时不建议加仓，存量仓位应控制风险。",
            link: "https://quote.eastmoney.com/unify/index.html",
          },
        ].map((item, i) => (
          <a
            key={i}
            href={item.link}
            target="_blank"
            rel="noopener noreferrer"
            className="group rounded-xl border border-rose-500/20 bg-rose-950/10 p-4 hover:border-rose-400/40 hover:bg-rose-950/20 transition"
          >
            <div className="text-sm font-black text-rose-200 group-hover:text-rose-100">{item.title}</div>
            <div className="mt-2 text-xs text-slate-300 leading-relaxed">{item.desc}</div>
            <div className="mt-2 rounded bg-rose-500/10 px-2 py-1 text-[10px] text-rose-300">真实数据源：{item.realDataSource}</div>
            <div className="mt-2 rounded bg-emerald-900/20 px-2 py-1 text-[10px] text-emerald-300">避坑建议：{item.avoidTip}</div>
            <div className="mt-2 text-[10px] text-amber-300 group-hover:text-amber-200">点击查看真实数据 →</div>
          </a>
        ))}
      </div>

      <div className="mt-4 rounded-lg bg-black/30 border border-white/5 px-4 py-3 text-[11px] text-slate-500 leading-relaxed">
        <span className="font-bold text-slate-300">核心规则总结：</span>
        本终端所有数据均来自东方财富公开接口真实抓取（包括资金流分档f62/f66/f72/f78/f84、板块资金流f3/f62/f164/f165/f174/f175、个股质押数据中心RPT_CSDC_LIST、公告扫描ANN_API、全球新闻NEWS_API等）。
        任何结论仅供参考，不构成投资建议。A股市场高波动、高博弈、低披露，散户最容易在「结构危险时盲目操作」时踩坑——本终端通过「资金结构优先、风险信号优先、一票否决规则、真实数据可验证」四重机制帮助你避开常见陷阱。
      </div>
    </section>
  );
}
