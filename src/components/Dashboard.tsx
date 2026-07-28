import { useState } from "react";
import MarketOverview from "./MarketOverview";
import FundStructure from "./FundStructure";
import DailySummary from "./DailySummary";
import SignalPanel from "./SignalPanel";
import InstitutionFund from "./InstitutionFund";
import { fmtMoney, pctColor } from "../lib/format";
import type { OverviewData, FundStructureData } from "../App";

// 驾驶舱右栏：资金结构精简版（只保留核心数字，不含板块排行和历史图表）
function FundQuickView({ fund }: { fund: FundStructureData | null }) {
  if (!fund?.structure) return <div className="text-xs text-slate-500">资金数据加载中…</div>;
  const t = fund.structure.today;
  const mainForce = t.mainNet;
  const retailForce = t.mediumNet + t.smallNet;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-black/20 p-2">
          <div className="text-[11px] text-slate-500">主力净流入</div>
          <div className={`text-sm font-black ${pctColor(mainForce)}`}>{fmtMoney(mainForce)}</div>
        </div>
        <div className="rounded-lg bg-black/20 p-2">
          <div className="text-[11px] text-slate-500">散户净流入</div>
          <div className={`text-sm font-black ${pctColor(retailForce)}`}>{fmtMoney(retailForce)}</div>
        </div>
        <div className="rounded-lg bg-black/20 p-2">
          <div className="text-[11px] text-slate-500">近5日主力</div>
          <div className={`text-sm font-bold ${pctColor(fund.structure.mainNet5d)}`}>{fmtMoney(fund.structure.mainNet5d)}</div>
        </div>
        <div className="rounded-lg bg-black/20 p-2">
          <div className="text-[11px] text-slate-500">近10日主力</div>
          <div className={`text-sm font-bold ${pctColor(fund.structure.mainNet10d)}`}>{fmtMoney(fund.structure.mainNet10d)}</div>
        </div>
      </div>
      {/* 分档柱 */}
      <div className="space-y-1">
        {[
          { label: "超大单", val: t.extraLargeNet },
          { label: "大单", val: t.largeNet },
          { label: "中单", val: t.mediumNet },
          { label: "小单", val: t.smallNet },
        ].map(d => (
          <div key={d.label} className="flex items-center gap-1 text-[11px]">
            <span className="w-10 text-right text-slate-500">{d.label}</span>
            <span className={`flex-1 text-right font-semibold ${pctColor(d.val)}`}>{fmtMoney(d.val)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// 驾驶舱首页：核心信息一屏展示
export default function Dashboard({ overview, fund, loading }: {
  overview: OverviewData | null;
  fund: FundStructureData | null;
  loading: boolean;
}) {
  const [showAI, setShowAI] = useState(false);
  const [showSignal, setShowSignal] = useState(false);

  return (
    <div className="space-y-3">
      {/* AI复盘和信号面板 — 默认折叠，点击展开 */}
      <div className="flex gap-2">
        <button onClick={() => setShowAI(v => !v)}
          className="rounded px-3 py-1 text-xs bg-violet-500/10 text-violet-300 hover:bg-violet-500/20 border border-violet-500/20">
          {showAI ? "收起AI复盘" : "AI复盘总结"}
        </button>
        <button onClick={() => setShowSignal(v => !v)}
          className="rounded px-3 py-1 text-xs bg-white/5 text-slate-300 hover:bg-white/10 border border-white/10">
          {showSignal ? "收起信号/日记" : "信号账本/日记"}
        </button>
      </div>
      {showAI && <DailySummary overview={overview} fund={fund} />}
      {showSignal && <SignalPanel />}

      {/* 核心数据区：左右分栏 */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_340px]">
        {/* 左主列：指数+温度计+广度+量能 */}
        <div className="space-y-3">
          <MarketOverview data={overview} loading={loading} />
        </div>

        {/* 右列：资金精简+ETF */}
        <div className="space-y-3">
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="text-xs font-bold text-slate-300 mb-2">资金结构速览</div>
            <FundQuickView fund={fund} />
          </div>
          <InstitutionFund />
        </div>
      </div>
    </div>
  );
}
