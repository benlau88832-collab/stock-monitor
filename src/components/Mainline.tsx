import { fmtMoney, fmtPct, pctColor } from "../lib/format";
import { boardRealUrl, stockRealUrl } from "../lib/realLinks";
import type { MainlineData } from "../App";

const STAGE_STYLE: Record<string, string> = {
  "启动期": "bg-slate-500/15 text-slate-300 border-slate-500/40",
  "发酵期": "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  "高潮期": "bg-amber-500/15 text-amber-300 border-amber-500/40",
  "退潮期": "bg-slate-500/15 text-slate-400 border-slate-500/40",
  "观察中": "bg-slate-500/10 text-slate-400 border-slate-500/30",
};

const WEIGHT_STYLE: Record<string, string> = {
  "推荐关注": "text-emerald-300",
  "谨慎参与": "text-amber-300",
  "降级观察": "text-slate-500",
};

const BOARD_TYPE_LABEL: Record<string, string> = { industry: "行业", concept: "概念", region: "地域" };

export default function Mainline({ data, loading }: { data: MainlineData | null; loading: boolean }) {
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
      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <h3 className="mb-3 text-sm font-bold text-slate-200">主线识别（按主力净流入排序，含阶段判断）</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-white/5 text-xs text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left">板块</th>
                <th className="px-3 py-2 text-center">类型</th>
                <th className="px-3 py-2 text-right">涨跌幅</th>
                <th className="px-3 py-2 text-right">今日主力净额</th>
                <th className="px-3 py-2 text-right">5日净占比</th>
                <th className="px-3 py-2 text-center">阶段判断</th>
                <th className="px-3 py-2 text-center">建议权重</th>
              </tr>
            </thead>
            <tbody>
              {boards.map((b) => (
                <tr key={b.code} className="border-t border-white/5 hover:bg-white/5">
                  <td className="px-3 py-2">
                    <a href={boardRealUrl(b.code, b.boardType)} target="_blank" rel="noopener noreferrer"
                      className="font-medium text-slate-100 hover:text-amber-300 hover:underline">{b.name}</a>
                  </td>
                  <td className="px-3 py-2 text-center text-xs text-slate-400">{BOARD_TYPE_LABEL[b.boardType] || b.boardType}</td>
                  <td className={`px-3 py-2 text-right ${pctColor(b.pct)}`}>{fmtPct(b.pct)}</td>
                  <td className={`px-3 py-2 text-right font-semibold ${pctColor(b.mainNet)}`}>{fmtMoney(b.mainNet)}</td>
                  <td className={`px-3 py-2 text-right ${pctColor(b.mainNet5dPct)}`}>{fmtPct(b.mainNet5dPct)}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${STAGE_STYLE[b.stage] || ""}`}>{b.stage}</span>
                  </td>
                  <td className={`px-3 py-2 text-center text-xs font-semibold ${WEIGHT_STYLE[b.weight] || ""}`}>{b.weight}</td>
                </tr>
              ))}
              {boards.length === 0 && (
                <tr><td colSpan={7} className="p-4 text-center text-slate-500">暂无数据</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <h3 className="mb-3 text-sm font-bold text-slate-200">潜力股（来自资金领先板块成分股，已经过资金结构一票否决过滤）</h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {potential.map((p) => (
            <a key={p.code} href={stockRealUrl(p.code)} target="_blank" rel="noopener noreferrer"
              className={`rounded-xl border p-4 transition hover:bg-white/10 ${
                p.vetoed ? "border-rose-500/30 bg-rose-500/5" : "border-emerald-500/20 bg-emerald-500/5"
              }`}>
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-bold text-slate-100">{p.name}</span>
                  <span className="ml-2 text-xs text-slate-500">{p.code}</span>
                </div>
                <span className={`text-lg font-black ${pctColor(p.pct)}`}>{fmtPct(p.pct)}</span>
              </div>
              <div className="mt-1 text-xs text-slate-400">所属板块：{p.boardName}</div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-slate-500">主力净额</span>
                  <span className={`ml-1 font-semibold ${pctColor(p.mainNet)}`}>{fmtMoney(p.mainNet)}</span>
                </div>
                <div>
                  <span className="text-slate-500">拥挤度</span>
                  <span className={`ml-1 font-semibold ${
                    p.crowding === "极度拥挤" ? "text-rose-400" : p.crowding === "偏高" ? "text-amber-300" : "text-emerald-300"
                  }`}>{p.crowding}</span>
                  <span className="text-slate-600">（换手 {p.turnoverRate?.toFixed(1)}%）</span>
                </div>
              </div>
              {p.vetoed ? (
                <div className="mt-2 space-y-1">
                  {p.vetoReasons.map((r, i) => (
                    <div key={i} className="text-[11px] text-rose-400">⛔ {r}</div>
                  ))}
                </div>
              ) : (
                <div className="mt-2 text-[11px] text-emerald-300">✅ 未触发一票否决 · 点击查看东方财富真实页面 →</div>
              )}
            </a>
          ))}
        </div>
        {potential.length === 0 && (
          <div className="text-sm text-slate-500 p-4">暂无候选（可能当前无明确资金领先板块）</div>
        )}
      </div>
    </section>
  );
}
