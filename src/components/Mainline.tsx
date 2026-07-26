"use client";

import { fmtMoney, fmtPct, pctColor } from "@/lib/format";
import { boardRealUrl, stockRealUrl } from "@/lib/realLinks";

const STAGE_STYLE: Record<string, string> = {
  启动期: "bg-sky-500/15 text-sky-300 border-sky-500/40",
  发酵期: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  高潮期: "bg-orange-500/15 text-orange-300 border-orange-500/40",
  退潮期: "bg-slate-500/15 text-slate-400 border-slate-500/40",
  观察中: "bg-slate-500/10 text-slate-400 border-slate-500/30",
};

const WEIGHT_STYLE: Record<string, string> = {
  推荐关注: "text-emerald-300",
  谨慎参与: "text-amber-300",
  降级观察: "text-slate-500",
};

const BOARD_TYPE_LABEL: Record<string, string> = { industry: "行业", concept: "概念", region: "地域" };

export default function Mainline({ data, loading }: { data: any; loading: boolean }) {
  if (!data && loading) {
    return <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-slate-400">正在识别主线…</div>;
  }
  if (!data) {
    return <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-6 text-rose-300">主线数据获取失败</div>;
  }

  const boards = data.boards ?? [];
  const potential = data.potential ?? [];

  return (
    <section className="space-y-6">
      <div>
        <h3 className="mb-3 text-sm font-bold text-slate-200">主线识别（按主力净流入排序，含阶段判断）</h3>
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-white/5 text-xs text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left">板块</th>
                <th className="px-3 py-2 text-left">类型</th>
                <th className="px-3 py-2 text-right">涨跌幅</th>
                <th className="px-3 py-2 text-right">今日主力净额</th>
                <th className="px-3 py-2 text-right">5日净占比</th>
                <th className="px-3 py-2 text-left">阶段判断</th>
                <th className="px-3 py-2 text-left">建议权重</th>
              </tr>
            </thead>
            <tbody>
              {boards.map((b: any) => (
                <tr key={b.code} className="border-t border-white/5 hover:bg-white/5">
                  <td className="px-3 py-2 font-medium text-slate-100">
                    <a href={boardRealUrl(b.code, b.boardType)} target="_blank" rel="noopener noreferrer" className="hover:text-amber-300 hover:underline">{b.name}</a>
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">{BOARD_TYPE_LABEL[b.boardType]}</td>
                  <td className={`px-3 py-2 text-right font-semibold ${pctColor(b.pct)}`}>{fmtPct(b.pct)}</td>
                  <td className={`px-3 py-2 text-right ${pctColor(b.mainNet)}`}>{fmtMoney(b.mainNet)}</td>
                  <td className={`px-3 py-2 text-right ${pctColor(b.mainNet5dPct)}`}>{fmtPct(b.mainNet5dPct)}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded border px-2 py-0.5 text-xs font-semibold ${STAGE_STYLE[b.stage]}`} title={b.stageReason}>
                      {b.stage}
                    </span>
                  </td>
                  <td className={`px-3 py-2 text-xs font-semibold ${WEIGHT_STYLE[b.weight]}`}>{b.weight}</td>
                </tr>
              ))}
              {boards.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                    暂无数据
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-bold text-slate-200">潜力股（来自资金领先板块成分股，已经过资金结构一票否决过滤）</h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {potential.map((p: any) => (
            <a key={p.code} href={stockRealUrl(p.code)} target="_blank" rel="noopener noreferrer" className={`block rounded-xl border p-3 transition ${p.vetoed ? "border-slate-600/40 bg-slate-800/30 opacity-60 hover:opacity-80 hover:bg-slate-800/40" : "border-white/10 bg-white/5 hover:border-amber-400/30 hover:bg-white/10"}`}>
              <div className="flex items-center justify-between">
                <div className="font-bold text-slate-100">
                  {p.name} <span className="text-xs text-slate-500">{p.code}</span>
                </div>
                <div className={`font-semibold ${pctColor(p.pct)}`}>{fmtPct(p.pct)}</div>
              </div>
              <div className="mt-1 text-xs text-slate-500">所属板块：{p.boardName}</div>
              <div className="mt-2 flex items-center justify-between text-xs">
                <span className="text-slate-400">主力净额</span>
                <span className={pctColor(p.mainNet)}>{fmtMoney(p.mainNet)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-xs">
                <span className="text-slate-400">拥挤度</span>
                <span className={p.crowding === "极度拥挤" ? "text-rose-400" : p.crowding === "偏高" ? "text-amber-400" : "text-emerald-400"}>
                  {p.crowding}（换手 {p.turnoverRate?.toFixed(1)}%）
                </span>
              </div>
              {p.vetoed ? (
                <div className="mt-2 space-y-1 rounded bg-rose-500/10 p-2 text-[11px] text-rose-300">
                  {p.vetoReasons.map((r: string, i: number) => (
                    <div key={i}>⛔ {r}</div>
                  ))}
                </div>
              ) : (
                <div className="mt-2 rounded bg-emerald-500/10 p-2 text-[11px] text-emerald-300">✅ 未触发一票否决 · <span className="text-amber-300">点击查看东方财富真实页面 →</span></div>
              )}
            </a>
          ))}
          {potential.length === 0 && <div className="text-slate-500">暂无候选（可能当前无明确资金领先板块）</div>}
        </div>
      </div>

      {data.source && <div className="text-[11px] text-slate-500">数据来源与计算逻辑：{data.source}</div>}
    </section>
  );
}
