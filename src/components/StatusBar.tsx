import { Activity, TrendingUp, TrendingDown, Minus, AlertTriangle, Zap } from "lucide-react";
import { fmtMoney, fmtPct, pctColor } from "../lib/format";
import type { OverviewData, FundStructureData } from "../App";
import { getLedger } from "../lib/signalLedger";
import { getOverallHealth } from "../lib/apiHealth";

// 顶部常驻状态条：所有Tab可见，一行展示核心数据
export default function StatusBar({ overview, fund }: {
  overview: OverviewData | null;
  fund: FundStructureData | null;
}) {
  const b = overview?.breadth;
  const lp = overview?.limitPool;
  const healthColor = { green: "text-emerald-400", yellow: "text-amber-400", red: "text-rose-400" }[getOverallHealth()];
  const todaySignals = getLedger().filter(e => e.date === new Date().toISOString().slice(0, 10)).length;

  return (
    <div className="border-b border-white/5 bg-[#080c18]/90 backdrop-blur-sm px-4 py-1 overflow-x-auto whitespace-nowrap">
      <div className="flex items-center gap-4 text-[11px] min-w-max mx-auto max-w-[1500px]">
        {/* 情绪分 */}
        {overview && (
          <span className="flex items-center gap-1">
            <Activity size={12} className="text-amber-400" />
            <span className={`font-bold ${overview.sentiment >= 65 ? "text-rose-400" : overview.sentiment >= 45 ? "text-amber-300" : "text-slate-400"}`}>
              {overview.sentiment}
            </span>
            <span className="text-slate-500">{overview.sentimentLabel}</span>
          </span>
        )}

        {/* 涨/平/跌 */}
        {b && (
          <span className="flex items-center gap-1.5">
            <TrendingUp size={11} className="text-rose-400" /><span className="text-rose-400">{b.up}</span>
            <Minus size={11} className="text-slate-500" /><span className="text-slate-500">{b.flat}</span>
            <TrendingDown size={11} className="text-emerald-400" /><span className="text-emerald-400">{b.down}</span>
          </span>
        )}

        {/* 涨停/跌停/炸板率 */}
        {lp && (
          <span className="text-slate-400">
            涨停<span className="text-rose-400 font-semibold">{lp.limitUpCount}</span>
            {" "}跌停<span className="text-emerald-400 font-semibold">{lp.limitDownCount}</span>
            {" "}炸板<span className="text-amber-400">{lp.blastedRate.toFixed(0)}%</span>
          </span>
        )}

        {/* 成交额 */}
        {overview && overview.turnoverAmount > 0 && (
          <span className="text-slate-400">
            成交<span className="text-slate-200 font-semibold">{fmtMoney(overview.turnoverAmount)}</span>
            {overview.turnoverYesterday && overview.turnoverYesterday > 0 && (
              <span className={overview.turnoverAmount > overview.turnoverYesterday ? "text-rose-400" : "text-emerald-400"}>
                {" "}{((overview.turnoverAmount / overview.turnoverYesterday - 1) * 100).toFixed(0)}%
              </span>
            )}
          </span>
        )}

        {/* 主力净额 */}
        {fund?.structure && (
          <span className="text-slate-400">
            主力<span className={`font-semibold ${pctColor(fund.structure.today.mainNet)}`}>{fmtMoney(fund.structure.today.mainNet)}</span>
          </span>
        )}

        {/* 信号数 */}
        {todaySignals > 0 && (
          <span className="flex items-center gap-1">
            <Zap size={11} className="text-amber-400" />
            <span className="text-amber-400 font-semibold">{todaySignals}信号</span>
          </span>
        )}

        {/* 健康点 */}
        <span className={`flex items-center gap-1 ${healthColor}`}>
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-current" />
        </span>
      </div>
    </div>
  );
}
