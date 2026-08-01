import { useState, Fragment } from "react";
import { fmtMoney, fmtPct, pctColor } from "../lib/format";
import { boardRealUrl, stockRealUrl } from "../lib/realLinks";
import type { DarkPoolData } from "../App";

function FlowBadge({ type }: { type: string }) {
  // 四象限标签颜色（已删除旧的洗盘/诱多/拉升做T等不可达分支）
  let color = "bg-slate-500/20 text-slate-300";
  if (type.includes("看多") || type.includes("共振流入")) color = "bg-emerald-500/20 text-emerald-300";
  else if (type.includes("看空") || type.includes("共振流出")) color = "bg-rose-500/20 text-rose-300";
  else if (type.includes("偏多") || type.includes("承接")) color = "bg-amber-500/20 text-amber-300";
  else if (type.includes("偏空") || type.includes("撤离")) color = "bg-rose-500/20 text-rose-300";
  return <span className={`rounded px-2 py-0.5 text-[11px] font-bold ${color}`}>{type}</span>;
}

export default function DarkPool({ data, loading }: { data: DarkPoolData | null; loading: boolean }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (loading && !data) {
    return <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-slate-400">正在获取明暗盘资金数据…</div>;
  }
  if (!data) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-6 text-amber-300">
        明暗盘资金数据获取失败或数据不完整
        <div className="mt-2 text-xs text-amber-300/80">数据来源说明：明盘=超大单+大单(公开大资金)净流入；暗盘=中单+小单(含主力拆单)净流入。</div>
      </div>
    );
  }

  const topBoards = data.topBoards ?? [];
  const boardStocks = data.boardStocks ?? {};

  const toggleExpand = (code: string) => {
    setExpanded((prev) => ({ ...prev, [code]: !prev[code] }));
  };

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-amber-500/20 bg-amber-950/10 px-4 py-2 text-xs text-amber-300/90">
        明暗盘资金流向监控（概念板块级别） — 明盘=超大单+大单（公开大资金） · 暗盘=中单+小单（含主力拆单隐蔽资金）
      </div>

      {data.marketFlowType && (
        <div className={`rounded-xl border p-4 ${
          data.marketFlowType.includes("洗盘") ? "border-amber-500/30 bg-amber-500/10" :
          data.marketFlowType.includes("出货") ? "border-rose-500/30 bg-rose-500/10" :
          data.marketFlowType.includes("共振做多") ? "border-emerald-500/30 bg-emerald-500/10" :
          data.marketFlowType.includes("共振做空") ? "border-rose-500/30 bg-rose-500/10" :
          "border-white/10 bg-white/5"
        }`}>
          <div className="text-sm font-bold text-slate-100">📊 全市场明暗盘判断</div>
          <div className="mt-1 text-base font-black text-amber-300">{data.marketFlowType}</div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-slate-400">资金总体流向（主力净流入）</div>
          <div className={`mt-1 text-2xl font-black ${pctColor(data.totalFlow)}`}>{fmtMoney(data.totalFlow)}</div>
          <div className="mt-2 text-[11px] text-slate-500">超大单+大单净额</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-slate-400">今日明盘净流入</div>
          <div className={`mt-1 text-2xl font-black ${pctColor(data.openPoolToday)}`}>{fmtMoney(data.openPoolToday)}</div>
          <div className="mt-2 text-[11px] text-slate-500">超大单+大单（公开大资金）</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-slate-400">今日暗盘净流入</div>
          <div className={`mt-1 text-2xl font-black ${pctColor(data.darkPoolToday)}`}>{fmtMoney(data.darkPoolToday)}</div>
          <div className="mt-2 text-[11px] text-slate-500">中单+小单（含主力拆单）</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-slate-400">近5日主力净流入</div>
          <div className={`mt-1 text-2xl font-black ${pctColor(data.darkPool5d)}`}>{fmtMoney(data.darkPool5d)}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-slate-400">近10日主力净流入</div>
          <div className={`mt-1 text-2xl font-black ${pctColor(data.darkPool10d)}`}>{fmtMoney(data.darkPool10d)}</div>
        </div>
      </div>

      <div>
        <h4 className="mb-3 text-sm font-bold text-slate-200">明暗盘资金净流入 TOP10（概念板块 + 成分股明细）</h4>
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full min-w-[800px] text-sm">
            <thead className="bg-white/5 text-xs text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left w-8"></th>
                <th className="px-3 py-2 text-left">概念板块</th>
                <th className="px-3 py-2 text-right">明盘净流入</th>
                <th className="px-3 py-2 text-right">暗盘净流入</th>
                <th className="px-3 py-2 text-right">涨跌幅</th>
                <th className="px-3 py-2 text-center">主力动向</th>
                <th className="px-3 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {topBoards.map((b) => (
                <Fragment key={b.code}>
                  <tr className="border-t border-white/5 hover:bg-white/5">
                    <td className="px-3 py-2">
                      <button
                        onClick={() => toggleExpand(b.code)}
                        className="flex h-5 w-5 items-center justify-center rounded bg-white/10 text-xs text-slate-300 hover:bg-white/20 transition"
                      >
                        {expanded[b.code] ? "−" : "+"}
                      </button>
                    </td>
                    <td className="px-3 py-2 font-medium text-slate-100">
                      <a href={boardRealUrl(b.code, "concept")} target="_blank" rel="noopener noreferrer" className="hover:text-amber-300 hover:underline">
                        {b.name}
                        <span className="ml-1 text-[11px] text-amber-300/50">概念</span>
                      </a>
                    </td>
                    <td className={`px-3 py-2 text-right font-semibold ${pctColor(b.openNet)}`}>{fmtMoney(b.openNet)}</td>
                    <td className={`px-3 py-2 text-right font-semibold ${pctColor(b.darkNet)}`}>{fmtMoney(b.darkNet)}</td>
                    <td className={`px-3 py-2 text-right ${pctColor(b.pct)}`}>{fmtPct(b.pct)}</td>
                    <td className="px-3 py-2 text-center"><FlowBadge type={b.flowType} /></td>
                    <td className="px-3 py-2 text-right">
                      <a href={boardRealUrl(b.code, "concept")} target="_blank" rel="noopener noreferrer" className="text-xs text-amber-300 hover:text-amber-200">查看 →</a>
                    </td>
                  </tr>
                  {expanded[b.code] && boardStocks[b.code] && (
                    <tr>
                      <td colSpan={7} className="bg-black/30 px-4 py-2">
                        <div className="text-xs text-slate-400 mb-2">成分股资金流向明细（{b.name}）</div>
                        <div className="grid grid-cols-1 gap-1 md:grid-cols-2 lg:grid-cols-4">
                          {boardStocks[b.code].map((s) => (
                            <a key={s.code} href={stockRealUrl(s.code)} target="_blank" rel="noopener noreferrer"
                              className="rounded border border-white/5 bg-white/5 px-3 py-2 hover:bg-white/10 transition">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold text-slate-100">{s.name}</span>
                                <span className={`text-xs ${pctColor(s.pct)}`}>{fmtPct(s.pct)}</span>
                              </div>
                              <div className="mt-1 flex items-center justify-between text-[11px]">
                                <span className={pctColor(s.mainNet)}>主力: {fmtMoney(s.mainNet)}</span>
                                <span className="text-amber-300/70">→ 查看</span>
                              </div>
                            </a>
                          ))}
                        </div>
                        {boardStocks[b.code].length === 0 && (
                          <div className="text-xs text-slate-500">暂无成分股数据</div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {topBoards.length === 0 && (
                <tr><td colSpan={7} className="p-4 text-center text-slate-500">暂无数据</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="text-[11px] text-slate-600 leading-relaxed">
        明盘=超大单+大单（公开可见的大资金操作）；暗盘=中单+小单（含主力拆单的隐蔽资金）。
        数据源为东方财富概念板块资金流接口（实时）。
      </div>
    </section>
  );
}
