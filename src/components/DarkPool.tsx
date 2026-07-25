"use client";

import { fmtMoney, fmtPct, pctColor } from "@/lib/format";
import { boardRealUrl, stockRealUrl } from "@/lib/realLinks";

export default function DarkPool({ data, loading }: { data?: any; loading?: boolean }) {
  if (loading) {
    return <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-slate-400">正在获取暗池资金数据…</div>;
  }
  if (!data) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-6 text-amber-300">
        暗池资金数据获取失败或数据不完整（如实标注，不编造数值）
        <div className="mt-2 text-xs text-amber-300/80">数据来源说明：采用东方财富公开接口机构资金流向（超大单+大单净额）作为暗池资金流向的真实代理数据。暗池真实数据通常通过大宗交易/机构专用通道获取，公开接口无法完全还原，本终端如实反映可获取部分，绝不编造。</div>
      </div>
    );
  }

  const topBoards = data.topBoards ?? [];

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-amber-500/20 bg-amber-950/10 px-4 py-2 text-xs text-amber-300/90">
        暗池资金监控（真实数据代理说明）
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-slate-400">今日暗池净流入（代理数据）</div>
          <div className={`mt-1 text-2xl font-black ${pctColor(data.darkPoolToday)}`}>{fmtMoney(data.darkPoolToday)}</div>
          <div className="mt-2 text-[10px] text-slate-500">代理方法：超大单净额 + 大单净额（东方财富公开接口真实数据）</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-slate-400">近5日暗池净流入</div>
          <div className={`mt-1 text-2xl font-black ${pctColor(data.darkPool5d)}`}>{fmtMoney(data.darkPool5d)}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-slate-400">近10日暗池净流入</div>
          <div className={`mt-1 text-2xl font-black ${pctColor(data.darkPool10d)}`}>{fmtMoney(data.darkPool10d)}</div>
        </div>
      </div>

      <div>
        <h4 className="mb-3 text-sm font-bold text-slate-200">暗池资金净流入 TOP5（板块代理数据，真实可跳转）</h4>
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full min-w-[600px] text-sm">
            <thead className="bg-white/5 text-xs text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left">板块</th>
                <th className="px-3 py-2 text-right">暗池净流入（代理）</th>
                <th className="px-3 py-2 text-right">今日主力净额</th>
                <th className="px-3 py-2 text-right">涨跌幅</th>
                <th className="px-3 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {topBoards.map((b: any) => (
                <tr key={b.code} className="border-t border-white/5 hover:bg-white/5">
                  <td className="px-3 py-2 font-medium text-slate-100">
                    <a href={boardRealUrl(b.code, "concept")} target="_blank" rel="noopener noreferrer" className="hover:text-amber-300 hover:underline">{b.name}</a>
                  </td>
                  <td className={`px-3 py-2 text-right font-semibold ${pctColor(b.darkNet)}`}>{fmtMoney(b.darkNet)}</td>
                  <td className={`px-3 py-2 text-right ${pctColor(b.mainNet)}`}>{fmtMoney(b.mainNet)}</td>
                  <td className={`px-3 py-2 text-right ${pctColor(b.pct)}`}>{fmtPct(b.pct)}</td>
                  <td className="px-3 py-2 text-right">
                    <a href={boardRealUrl(b.code, "concept")} target="_blank" rel="noopener noreferrer" className="text-xs text-amber-300 hover:text-amber-200">查看真实板块 →</a>
                  </td>
                </tr>
              ))}
              {topBoards.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                    暂无暗池代理数据（数据获取失败或接口返回为空，不编造数值）
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-lg bg-black/30 px-4 py-3 text-[11px] text-slate-500 leading-relaxed">
        <span className="font-bold text-slate-300">数据真实性声明：</span>
        暗池资金数据采用东方财富公开接口机构资金流向（超大单+大单净额）作为真实代理数据。暗池真实数据通常通过大宗交易/机构专用通道获取，公开接口无法完全还原，本终端如实反映可获取部分，接口异常或字段缺失时明确标注「数据不完整」，绝不编造数值。所有板块数据可点击跳转到东方财富真实板块页面验证。
        <div className="mt-1 text-slate-600">数据源：{data.source || "东方财富公开接口"}</div>
        <div className="text-rose-400">{data.note || ""}</div>
        {data.message && <div className="text-amber-300">接口消息：{data.message}</div>}
      </div>
    </section>
  );
}
