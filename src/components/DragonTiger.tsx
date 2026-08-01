import { useState, useEffect, useCallback, useMemo, Fragment } from "react";
import { fetchDragonTigerList, fetchDragonTigerSeats, type DragonTigerItem, type DragonTigerSeat } from "../lib/api";
import { fmtMoney, fmtPct, pctColor } from "../lib/format";
import { stockRealUrl } from "../lib/realLinks";
import { matchSeatTag } from "../lib/seatProfiles";
import {
  writeSeatRecords, runBackfill, buildSeatProfiles, detectSeatSignals, buildSeatRepeatActions, buildSeatStocksByDept,
  type SeatRecord, type SeatProfile, type StockSeatSignal, type SeatRepeatAction,
} from "../lib/seatLedger";
import { buildSeatBehaviors, analyzeSeatsGroup, type SeatBehavior } from "../lib/seatBehavior";

// ============== 上榜原因标签颜色 ==============
function reasonColor(explanation: string): string {
  if (explanation.includes("涨幅偏离")) return "bg-rose-500/20 text-rose-300";
  if (explanation.includes("跌幅偏离")) return "bg-emerald-500/20 text-emerald-300";
  if (explanation.includes("换手率")) return "bg-amber-500/20 text-amber-300";
  if (explanation.includes("振幅")) return "bg-amber-500/20 text-amber-300";
  return "bg-slate-500/20 text-slate-300";
}

// ============== 席位表格（v9.13：每行加行为模式徽标） ==============
function SeatTable({ seats, type, behaviorMap }: {
  seats: DragonTigerSeat[]; type: "buy" | "sell"; behaviorMap: Map<string, SeatBehavior>;
}) {
  const isBuy = type === "buy";
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className={`border-b ${isBuy ? "border-rose-500/20" : "border-emerald-500/20"} text-slate-400`}>
          <th className="px-2 py-1.5 text-left">{isBuy ? "买入" : "卖出"}席位</th>
          <th className="px-2 py-1.5 text-center">画像</th>
          <th className="px-2 py-1.5 text-center">行为</th>
          <th className="px-2 py-1.5 text-right">买入额</th>
          <th className="px-2 py-1.5 text-right">卖出额</th>
          <th className="px-2 py-1.5 text-right">净额</th>
        </tr>
      </thead>
      <tbody>
        {seats.map((s, i) => {
          const tag = matchSeatTag(s.deptName);
          const bh = behaviorMap.get(s.deptName);
          return (
            <tr key={i} className={`border-b border-white/5 ${isBuy ? "bg-rose-500/5" : "bg-emerald-500/5"}`}>
              <td className="px-2 py-1.5 text-slate-200 max-w-[200px] truncate" title={s.deptName}>
                <span className="mr-1">{s.deptName}</span>
              </td>
              <td className="px-2 py-1.5 text-center">
                {tag && <span className={`rounded px-1 py-0.5 text-[10px] font-bold ${tag.color}`}>{tag.label}</span>}
              </td>
              <td className="px-2 py-1.5 text-center">
                {bh && bh.behavior !== "新面孔" && bh.behavior !== "数据不足" ? (
                  <span className={`rounded border px-1 py-0.5 text-[10px] font-bold ${bh.behaviorColor}`} title={bh.hint}>
                    {bh.behavior}
                  </span>
                ) : (
                  <span className="text-[10px] text-slate-500">{bh?.behavior ?? "新面孔"}</span>
                )}
              </td>
              <td className="px-2 py-1.5 text-right text-rose-400">{fmtMoney(s.buy)}</td>
              <td className="px-2 py-1.5 text-right text-emerald-400">{fmtMoney(s.sell)}</td>
              <td className={`px-2 py-1.5 text-right font-semibold ${pctColor(s.net)}`}>{fmtMoney(s.net)}</td>
            </tr>
          );
        })}
        {seats.length === 0 && (
          <tr><td colSpan={6} className="px-2 py-3 text-center text-slate-500">暂无数据</td></tr>
        )}
      </tbody>
    </table>
  );
}

// ============== 席位画像卡片 ==============
// v9.12：新增"行为模式"列（格局派/砸盘派/波段派/接力派/一日游）
// v9.13：每行加 + 按钮，展开看该席位的最近上榜历史
function SeatProfileCard({ profiles, behaviors }: { profiles: SeatProfile[]; behaviors: SeatBehavior[] }) {
  const [showAll, setShowAll] = useState(false);
  const [expandedDept, setExpandedDept] = useState<string | null>(null);
  // 行为 lookup 索引
  const behaviorByDept = new Map<string, SeatBehavior>();
  for (const b of behaviors) behaviorByDept.set(b.deptName, b);
  // 只显示出现>=2次的
  const filtered = profiles.filter(p => p.appearances >= 2);
  const display = showAll ? filtered : filtered.slice(0, 15);

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-bold text-amber-300">🏷️ 席位画像（近120日 · 点击 + 看操作历史）</div>
        {filtered.length > 15 && (
          <button onClick={() => setShowAll(v => !v)}
            className="text-[11px] text-amber-400 hover:text-amber-300">
            {showAll ? "收起" : `全部(${filtered.length})`}
          </button>
        )}
      </div>
      {filtered.length === 0 ? (
        <div className="text-xs text-slate-500">数据积累中，持续使用后自动生成席位画像</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/10 text-slate-400">
                <th className="px-2 py-1 text-center w-6"></th>
                <th className="px-2 py-1 text-left">席位</th>
                <th className="px-2 py-1 text-left">行为模式</th>
                <th className="px-2 py-1 text-right">上榜</th>
                <th className="px-2 py-1 text-right">T+1均值</th>
                <th className="px-2 py-1 text-right">胜率</th>
                <th className="px-2 py-1 text-center">分级</th>
              </tr>
            </thead>
            <tbody>
              {display.map(p => {
                const tag = matchSeatTag(p.deptName);
                const bh = behaviorByDept.get(p.deptName);
                const isExp = expandedDept === p.deptName;
                return (
                  <Fragment key={p.deptName}>
                    <tr className={`border-b border-white/5 hover:bg-white/5 ${isExp ? "bg-amber-500/5" : ""}`}>
                      <td className="px-2 py-1 text-center">
                        <button
                          onClick={() => setExpandedDept(isExp ? null : p.deptName)}
                          className="inline-flex h-4 w-4 items-center justify-center rounded bg-white/10 text-[10px] text-slate-300 hover:bg-amber-500/30 hover:text-amber-200"
                          title="查看该席位上榜历史"
                        >
                          {isExp ? "−" : "+"}
                        </button>
                      </td>
                      <td className="px-2 py-1 text-slate-200 max-w-[200px] truncate">
                        {p.deptName.slice(0, 20)}
                        {tag && <span className={`ml-1 rounded px-1 py-0.5 text-[10px] ${tag.color}`}>{tag.label}</span>}
                      </td>
                      <td className="px-2 py-1">
                        {bh && bh.behavior !== "新面孔" && bh.behavior !== "数据不足" ? (
                          <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${bh.behaviorColor}`} title={bh.hint + " · " + bh.reasons.join("；")}>
                            {bh.behavior}
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-500">{bh?.behavior ?? "新面孔"}</span>
                        )}
                      </td>
                      <td className="px-2 py-1 text-right text-slate-300">{p.appearances}次</td>
                      <td className={`px-2 py-1 text-right font-semibold ${p.avgPctT1 != null ? pctColor(p.avgPctT1) : "text-slate-500"}`}>
                        {p.sampleCount < 5 ? (
                          <span className="text-slate-500 text-[11px]">样本积累中</span>
                        ) : (
                          `${p.avgPctT1! >= 0 ? "+" : ""}${p.avgPctT1!.toFixed(2)}%`
                        )}
                      </td>
                      <td className="px-2 py-1 text-right text-slate-300">
                        {p.sampleCount >= 5 ? `${p.winRateT1}%` : "—"}
                      </td>
                      <td className="px-2 py-1 text-center">
                        {p.premiumLevel === "high" && (
                          <span className="rounded px-1 py-0.5 text-[10px] font-bold bg-rose-500/20 text-rose-300">高溢价</span>
                        )}
                        {p.premiumLevel === "negative" && (
                          <span className="rounded px-1 py-0.5 text-[10px] font-bold bg-slate-500/20 text-slate-400">负溢价</span>
                        )}
                      </td>
                    </tr>
                    {isExp && (
                      <tr>
                        <td colSpan={7} className="px-2 py-2 bg-black/30">
                          <SeatHistoryExpansion deptName={p.deptName} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {/* 行为模式图例（长期跟踪会持续优化） */}
      <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-slate-500">
        <span className="rounded border border-rose-500/30 px-1.5 py-0.5 bg-rose-500/10 text-rose-300">格局派</span>
        <span className="text-slate-600">= 值得跟踪（中长线）</span>
        <span className="ml-2 rounded border border-amber-500/30 px-1.5 py-0.5 bg-amber-500/10 text-amber-300">波段派</span>
        <span className="text-slate-600">= 适合跟踪波段</span>
        <span className="ml-2 rounded border border-slate-500/30 px-1.5 py-0.5 bg-slate-500/10 text-slate-300">砸盘派</span>
        <span className="text-slate-600">= 务必警惕</span>
        <span className="ml-2 rounded border border-violet-500/30 px-1.5 py-0.5 bg-violet-500/10 text-violet-300">接力派</span>
        <span className="text-slate-600">= 高频高胜可长线跟</span>
      </div>
    </div>
  );
}

// ============== 合力/独食信号条 ==============
function SignalBanner({ signals }: { signals: StockSeatSignal[] }) {
  if (signals.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
      {signals.map((s, i) => (
        <span key={i} className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${
          s.signal === "合力" ? "bg-rose-500/20 text-rose-300" : "bg-amber-500/20 text-amber-300"
        }`}>
          {s.signal === "合力" ? "🤝" : "🍽️"} {s.stockName} {s.signal}
          <span className="font-normal text-slate-400 ml-1">{s.detail}</span>
        </span>
      ))}
    </div>
  );
}

// ============== v9.14：买卖主导派分析 + 5 维评分（多重信号交叉验证） ==============
// 综合买入/卖出前五席位的 5 维评分，给出主导派 + 操作建议
// 评分维度（加权）：行为模式(35%) + 集中度(25%) + 历史T+1(20%) + 席位类别(10%) + 新面孔比例(10%)
function BuySellAnalysisPanel({ buyers, sellers, behaviorMap }: {
  buyers: DragonTigerSeat[]; sellers: DragonTigerSeat[]; behaviorMap: Map<string, SeatBehavior>;
}) {
  const analysis = useMemo(() => analyzeSeatsGroup(
    buyers.map(b => ({ deptName: b.deptName, net: b.net })),
    sellers.map(s => ({ deptName: s.deptName, net: s.net })),
    behaviorMap,
  ), [buyers, sellers, behaviorMap]);

  const renderDist = (label: string, dist: typeof analysis.buyerDist) => {
    if (dist.size === 0) return null;
    return (
      <div className="flex-1 min-w-0">
        <div className="text-[10px] text-slate-500 mb-1">{label}</div>
        <div className="space-y-0.5">
          {[...dist.entries()].sort((a, b) => b[1].count - a[1].count).map(([tag, v]) => (
            <div key={tag} className="flex items-center gap-1 text-[10px]">
              <span className="rounded border px-1 py-0.5 bg-white/5 border-white/10 w-12 text-center font-bold">
                {tag}
              </span>
              <span className="text-slate-400">{v.count}家</span>
              <span className={v.totalNet >= 0 ? "text-rose-400" : "text-emerald-400"}>
                {v.totalNet >= 0 ? "+" : ""}{fmtMoney(v.totalNet)}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const dominantColor = (tag: string) => {
    if (tag === "格局派") return "bg-rose-500/20 text-rose-300";
    if (tag === "砸盘派") return "bg-slate-500/30 text-slate-300";
    if (tag === "波段派") return "bg-amber-500/20 text-amber-300";
    if (tag === "接力派") return "bg-violet-500/20 text-violet-300";
    if (tag === "一日游") return "bg-slate-500/20 text-slate-400";
    return "bg-white/5 text-slate-500";
  };

  // 评分条：5 维
  const scoreColor = (s: number) => s >= 70 ? "bg-emerald-500" : s >= 40 ? "bg-amber-500" : "bg-rose-500";
  const scoreLabel = (s: number) => s >= 70 ? "优" : s >= 40 ? "中" : "弱";
  const scoreBar = (label: string, score: number, weight: string) => (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-slate-400">{label} <span className="text-slate-600">({weight})</span></span>
        <span className={`font-mono font-bold ${score >= 70 ? "text-emerald-300" : score >= 40 ? "text-amber-300" : "text-rose-300"}`}>
          {score.toFixed(0)} <span className="text-[9px] text-slate-500">({scoreLabel(score)})</span>
        </span>
      </div>
      <div className="h-1.5 bg-white/5 rounded overflow-hidden">
        <div className={`h-full ${scoreColor(score)} transition-all`} style={{ width: `${score}%` }} />
      </div>
    </div>
  );

  // 信号徽标
  const signalColor = (tone: string) => {
    if (tone === "good") return "bg-emerald-500/20 text-emerald-300 border-emerald-500/30";
    if (tone === "warn") return "bg-amber-500/20 text-amber-300 border-amber-500/30";
    if (tone === "bad") return "bg-rose-500/20 text-rose-300 border-rose-500/30";
    return "bg-sky-500/20 text-sky-300 border-sky-500/30";
  };

  return (
    <div className="mt-2 rounded-lg border border-violet-500/30 bg-violet-500/5 p-3 space-y-2.5">
      {/* 头部：主导派 + 总分 + 信号强度 */}
      <div className="flex items-center gap-2 text-[11px] flex-wrap">
        <span className="font-bold text-violet-300">🎯 主导派与操作建议</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${dominantColor(analysis.buyerDominant)}`}>
          买方: {analysis.buyerDominant}
        </span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${dominantColor(analysis.sellerDominant)}`}>
          卖方: {analysis.sellerDominant}
        </span>
        <span className="ml-auto flex items-center gap-1 text-[10px]">
          <span className="text-slate-400">综合分</span>
          <span className={`font-mono font-black text-base ${
            analysis.scores.total >= 70 ? "text-emerald-400" :
            analysis.scores.total >= 40 ? "text-amber-400" : "text-rose-400"
          }`}>{analysis.scores.total}</span>
          <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${
            analysis.confidence === "强" ? "bg-emerald-500/20 text-emerald-300" :
            analysis.confidence === "中" ? "bg-amber-500/20 text-amber-300" :
            "bg-rose-500/20 text-rose-300"
          }`}>信号{analysis.confidence}</span>
        </span>
      </div>

      {/* 信号徽标（多重） */}
      {analysis.signals.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {analysis.signals.map((s, i) => (
            <span key={i} className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${signalColor(s.tone)}`}>
              {s.label}
            </span>
          ))}
        </div>
      )}

      {/* 一句话操作建议 */}
      <div className="text-[11px] text-slate-200 leading-relaxed border-l-2 border-violet-500/30 pl-2 whitespace-pre-wrap">
        {analysis.suggestion}
      </div>

      {/* 风险警示 */}
      {analysis.warnings.length > 0 && (
        <div className="rounded border border-rose-500/20 bg-rose-500/5 px-2 py-1.5 space-y-0.5">
          {analysis.warnings.map((w, i) => (
            <div key={i} className="text-[10px] text-rose-300">⚠️ {w}</div>
          ))}
        </div>
      )}

      {/* 5 维评分 */}
      <div className="rounded bg-black/30 p-2 space-y-1.5">
        <div className="text-[10px] text-slate-500 font-bold">5 维评分（多重信号交叉验证）</div>
        {scoreBar("行为模式", analysis.scores.behavior, "35%")}
        {scoreBar("集中度", analysis.scores.concentration, "25%")}
        {scoreBar("历史 T+1", analysis.scores.historicalT1, "20%")}
        {scoreBar("席位类别", analysis.scores.seatCategory, "10%")}
        {scoreBar("新面孔比", analysis.scores.recogRate, "10%")}
      </div>

      {/* 派系分布 */}
      <div className="flex gap-3">
        {renderDist("买方派系", analysis.buyerDist)}
        {renderDist("卖方派系", analysis.sellerDist)}
      </div>
    </div>
  );
}

// ============== v9.14：席位画像 + 展开（按股票聚合） ==============
// 显示该席位近 30 日做过的所有票（按股票聚合），+ 上榜次数、累计净买入、末次 T+1
function SeatHistoryExpansion({ deptName }: { deptName: string }) {
  const [rows, setRows] = useState<ReturnType<typeof buildSeatStocksByDept> | null>(null);
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button onClick={() => { setOpen(true); if (!rows) setRows(buildSeatStocksByDept(deptName, 30)); }}
        className="text-[10px] text-amber-300 hover:text-amber-200">
        + 查看该席位做过的票
      </button>
    );
  }
  if (!rows) return <div className="text-[10px] text-slate-500">加载中…</div>;
  if (rows.length === 0) return <div className="text-[10px] text-slate-500">无历史记录</div>;
  const totalStocks = rows.length;
  const totalApperances = rows.reduce((s, r) => s + r.count, 0);
  const totalNet = rows.reduce((s, r) => s + r.totalNet, 0);
  return (
    <div className="mt-1 rounded border border-white/10 bg-black/30 p-1.5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-slate-400">
          近30日做过的票 <b className="text-amber-300">{totalStocks} 只</b>（累计 {totalApperances} 次上榜，累计净买入 <b className={totalNet >= 0 ? "text-rose-400" : "text-emerald-400"}>{fmtMoney(totalNet)}</b>）
        </span>
        <button onClick={() => setOpen(false)} className="text-[10px] text-slate-500 hover:text-slate-300">收起</button>
      </div>
      <table className="w-full text-[10px]">
        <thead><tr className="text-slate-500">
          <th className="px-1 py-0.5 text-left">股票</th>
          <th className="px-1 py-0.5 text-center">次数</th>
          <th className="px-1 py-0.5 text-center">方向</th>
          <th className="px-1 py-0.5 text-right">累计净买入</th>
          <th className="px-1 py-0.5 text-right">平均T+1</th>
          <th className="px-1 py-0.5 text-right">末次T+1</th>
          <th className="px-1 py-0.5 text-right">末次上榜</th>
        </tr></thead>
        <tbody>
          {rows.slice(0, 12).map((r, i) => (
            <tr key={i} className="border-t border-white/5">
              <td className="px-1 py-0.5">
                <a href={stockRealUrl(r.stockCode)} target="_blank" rel="noopener noreferrer" className="text-slate-200 hover:text-amber-300">{r.stockName}</a>
                <span className="text-slate-500 ml-1">{r.stockCode}</span>
              </td>
              <td className="px-1 py-0.5 text-center font-mono">
                <span className="rounded bg-amber-500/20 text-amber-300 px-1">{r.count}</span>
              </td>
              <td className="px-1 py-0.5 text-center">
                <span className={`rounded px-1 py-0.5 text-[9px] font-bold ${r.direction === "买" ? "bg-rose-500/20 text-rose-300" : r.direction === "卖" ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-300"}`}>
                  {r.direction}
                </span>
              </td>
              <td className={`px-1 py-0.5 text-right font-mono ${r.totalNet >= 0 ? "text-rose-400" : "text-emerald-400"}`}>{fmtMoney(r.totalNet)}</td>
              <td className={`px-1 py-0.5 text-right font-mono ${r.avgPctT1 == null ? "text-slate-600" : r.avgPctT1 >= 0 ? "text-rose-400" : "text-emerald-400"}`}>
                {r.avgPctT1 != null ? `${r.avgPctT1 >= 0 ? "+" : ""}${r.avgPctT1.toFixed(2)}%` : "—"}
              </td>
              <td className={`px-1 py-0.5 text-right font-mono ${r.lastPctT1 == null ? "text-slate-600" : r.lastPctT1 >= 0 ? "text-rose-400" : "text-emerald-400"}`}>
                {r.lastPctT1 != null ? `${r.lastPctT1 >= 0 ? "+" : ""}${r.lastPctT1.toFixed(2)}%` : "—"}
              </td>
              <td className="px-1 py-0.5 text-right text-slate-500">{r.lastDate.slice(5)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 12 && <div className="text-[10px] text-slate-600 mt-0.5">…等共 {rows.length} 只票</div>}
    </div>
  );
}

// ============== 游资联动统计 ==============
function HotMoneyStats({ items }: { items: DragonTigerItem[] }) {
  const reasonCounts = new Map<string, number>();
  for (const item of items) {
    const reason = item.explanation.replace(/的前5只证券|的前五只证券/g, "").trim();
    reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
  }
  const topReasons = [...reasonCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topBuyers = [...items].sort((a, b) => b.netAmt - a.netAmt).filter(i => i.netAmt > 0).slice(0, 5);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="text-xs font-bold text-amber-300 mb-2">🔥 上榜原因分布</div>
        <div className="space-y-1.5">
          {topReasons.map(([reason, count]) => (
            <div key={reason} className="flex items-center justify-between text-xs">
              <span className={`rounded px-1.5 py-0.5 ${reasonColor(reason)}`}>{reason}</span>
              <span className="text-slate-300 font-semibold">{count}只</span>
            </div>
          ))}
          {topReasons.length === 0 && <div className="text-xs text-slate-500">暂无数据</div>}
        </div>
      </div>
      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="text-xs font-bold text-emerald-300 mb-2">💰 净买入 Top5</div>
        <div className="space-y-1.5">
          {topBuyers.map(item => (
            <div key={item.code} className="flex items-center justify-between text-xs">
              <a href={stockRealUrl(item.code)} target="_blank" rel="noopener noreferrer" className="text-slate-200 hover:text-amber-300">
                {item.name}({item.code})
              </a>
              <span className="text-rose-400 font-semibold">{fmtMoney(item.netAmt)}</span>
            </div>
          ))}
          {topBuyers.length === 0 && <div className="text-xs text-slate-500">暂无数据</div>}
        </div>
      </div>
    </div>
  );
}

// ============== v9.14：游资连续动作 + 展开（看该席位做过的所有票） ==============
// 十年机构视角：单一游资席位对同一只票的反复上榜（隔日回补/连续加仓/对倒）
// 暗示该席位对该标的的长期意图，比单日上榜更有信息量。
// v9.14: 每行 + 按钮，展开看该席位做过的所有票（不只 ≥2 次的连续动作）
function SeatRepeatPanel({ actions }: { actions: SeatRepeatAction[] }) {
  const [showAll, setShowAll] = useState(false);
  const [expandedDept, setExpandedDept] = useState<string | null>(null);
  const display = showAll ? actions : actions.slice(0, 12);
  if (actions.length === 0) return null;
  return (
    <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-bold text-violet-300">🎯 游资连续动作（近60日 · 同席位同票≥2次 · 点 + 看所有票）</div>
        {actions.length > 12 && (
          <button onClick={() => setShowAll(v => !v)} className="text-[11px] text-violet-400 hover:text-violet-300">
            {showAll ? "收起" : `全部(${actions.length})`}
          </button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-white/10 text-slate-400">
              <th className="px-2 py-1 text-center w-6"></th>
              <th className="px-2 py-1 text-left">席位</th>
              <th className="px-2 py-1 text-left">标的</th>
              <th className="px-2 py-1 text-right">次数</th>
              <th className="px-2 py-1 text-center">方向</th>
              <th className="px-2 py-1 text-right">T+1均值</th>
              <th className="px-2 py-1 text-left">上榜日</th>
            </tr>
          </thead>
          <tbody>
            {display.map((a, i) => {
              const key = `${a.deptName}|${a.stockCode}`;
              const isExp = expandedDept === key;
              return (
                <Fragment key={i}>
                  <tr className={`border-b border-white/5 hover:bg-white/5 ${isExp ? "bg-violet-500/5" : ""}`}>
                    <td className="px-2 py-1 text-center">
                      <button
                        onClick={() => setExpandedDept(isExp ? null : key)}
                        className="inline-flex h-4 w-4 items-center justify-center rounded bg-white/10 text-[10px] text-slate-300 hover:bg-violet-500/30 hover:text-violet-200"
                        title="查看该席位做过的所有票"
                      >
                        {isExp ? "−" : "+"}
                      </button>
                    </td>
                    <td className="px-2 py-1 text-slate-200 max-w-[180px] truncate">{a.deptName.slice(0, 18)}</td>
                    <td className="px-2 py-1">
                      <a href={stockRealUrl(a.stockCode)} target="_blank" rel="noopener noreferrer" className="text-slate-100 hover:text-amber-300">
                        {a.stockName}<span className="text-slate-500 ml-1">{a.stockCode}</span>
                      </a>
                    </td>
                    <td className="px-2 py-1 text-right">
                      <span className="rounded px-1.5 py-0.5 bg-violet-500/20 text-violet-300 font-bold">{a.count}次</span>
                    </td>
                    <td className="px-2 py-1 text-center">
                      {a.direction === "买" && <span className="rounded px-1 py-0.5 text-[10px] font-bold bg-rose-500/20 text-rose-300">持续买入</span>}
                      {a.direction === "卖" && <span className="rounded px-1 py-0.5 text-[10px] font-bold bg-emerald-500/20 text-emerald-300">持续卖出</span>}
                      {a.direction === "买卖" && <span className="rounded px-1 py-0.5 text-[10px] font-bold bg-amber-500/20 text-amber-300">买卖反复</span>}
                    </td>
                    <td className={`px-2 py-1 text-right font-semibold ${a.avgPctT1 != null ? pctColor(a.avgPctT1) : "text-slate-500"}`}>
                      {a.avgPctT1 != null ? `${a.avgPctT1 >= 0 ? "+" : ""}${a.avgPctT1.toFixed(2)}%` : "—"}
                    </td>
                    <td className="px-2 py-1 text-slate-500">{a.dates.slice(0, 3).join(" ")}</td>
                  </tr>
                  {isExp && (
                    <tr>
                      <td colSpan={7} className="px-2 py-2 bg-black/30">
                        <SeatHistoryExpansion deptName={a.deptName} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="text-[11px] text-slate-600 mt-1.5">持续买入 = 游资反复加仓，关注度持续提升；持续卖出 = 游资派发中，注意回避；买卖反复 = 该票为游资博弈主战场，波动大</div>
    </div>
  );
}

// ============== 主组件 ==============
export default function DragonTiger() {
  const [items, setItems] = useState<DragonTigerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [seats, setSeats] = useState<Record<string, { buy: DragonTigerSeat[]; sell: DragonTigerSeat[] }>>({});
  const [seatsLoading, setSeatsLoading] = useState<Record<string, boolean>>({});
  const [seatProfiles, setSeatProfiles] = useState<SeatProfile[]>([]);
  const [seatBehaviors, setSeatBehaviors] = useState<SeatBehavior[]>([]);
  const [seatSignals, setSeatSignals] = useState<StockSeatSignal[]>([]);
  const [repeatActions, setRepeatActions] = useState<SeatRepeatAction[]>([]);
  // v9.13：行为模式索引（用于展开行 SeatTable + BuySellAnalysisPanel）
  const behaviorByDept = useMemo(() => {
    const m = new Map<string, SeatBehavior>();
    for (const b of seatBehaviors) m.set(b.deptName, b);
    return m;
  }, [seatBehaviors]);

  const load = useCallback(async () => {
    setLoading(true);
    const list = await fetchDragonTigerList(80);
    setItems(list);
    setLoading(false);

    // 席位台账写入 + 合力/独食检测
    if (list.length > 0) {
      // 按日期分组
      const dateGroups = new Map<string, DragonTigerItem[]>();
      for (const item of list) {
        const arr = dateGroups.get(item.tradeDate) ?? [];
        arr.push(item);
        dateGroups.set(item.tradeDate, arr);
      }

      // 对每个日期组，获取席位并写入台账
      for (const [date, dateItems] of dateGroups) {
        const allRecords: SeatRecord[] = [];
        const stockSeats: Record<string, { buy: Array<{ deptName: string; net: number }>; sell: Array<{ deptName: string; net: number }> }> = {};
        const stockNames: Record<string, string> = {};

        for (const item of dateItems) {
          stockNames[item.code] = item.name;
          try {
            const seatData = await fetchDragonTigerSeats(item.code, item.tradeDate);
            stockSeats[item.code] = {
              buy: seatData.buy.map(s => ({ deptName: s.deptName, net: s.net })),
              sell: seatData.sell.map(s => ({ deptName: s.deptName, net: s.net })),
            };
            for (const s of seatData.buy) {
              allRecords.push({
                deptName: s.deptName, stockCode: item.code, stockName: item.name,
                direction: "买", net: s.net, closeAtDay: item.closePrice,
                priceT1: null, priceT5: null, pctT1: null, pctT5: null, backfilled: false,
              });
            }
            for (const s of seatData.sell) {
              allRecords.push({
                deptName: s.deptName, stockCode: item.code, stockName: item.name,
                direction: "卖", net: s.net, closeAtDay: item.closePrice,
                priceT1: null, priceT5: null, pctT1: null, pctT5: null, backfilled: false,
              });
            }
          } catch { /* 单股席位获取失败不影响整体 */ }
        }

        writeSeatRecords(date, allRecords);

        // 检测当日合力/独食（只对最新日期）
        if (date === [...dateGroups.keys()].sort().pop()) {
          const signals = detectSeatSignals(date, stockSeats, stockNames);
          setSeatSignals(signals);
        }
      }

      // 构建席位画像 + 行为模式（v9.12：长期跟踪自动打标）
      const profiles = buildSeatProfiles();
      setSeatProfiles(profiles);
      setSeatBehaviors(buildSeatBehaviors(profiles));
      setRepeatActions(buildSeatRepeatActions());

      // 异步回填历史台账（不阻塞页面）
      runBackfill().catch(() => { /* 静默 */ });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleExpand = async (item: DragonTigerItem) => {
    const key = `${item.code}_${item.tradeDate}`;
    const isExpanding = !expanded[key];
    setExpanded(prev => ({ ...prev, [key]: isExpanding }));
    if (isExpanding && !seats[key]) {
      setSeatsLoading(prev => ({ ...prev, [key]: true }));
      const result = await fetchDragonTigerSeats(item.code, item.tradeDate);
      setSeats(prev => ({ ...prev, [key]: result }));
      setSeatsLoading(prev => ({ ...prev, [key]: false }));
    }
  };

  // 按日期分组
  const dateGroups = new Map<string, DragonTigerItem[]>();
  for (const item of items) {
    const arr = dateGroups.get(item.tradeDate) ?? [];
    arr.push(item);
    dateGroups.set(item.tradeDate, arr);
  }

  if (loading) {
    return <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-slate-400">正在加载龙虎榜数据…</div>;
  }

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-amber-500/20 bg-amber-950/10 px-4 py-2 text-xs text-amber-300/90">
        龙虎榜与游资席位追踪 — 数据来源：东方财富数据中心 · 席位台账逐日积累，T+1/T+5 自动回填
      </div>

      {/* 合力/独食信号 */}
      <SignalBanner signals={seatSignals} />

      {/* 统计卡片 */}
      <HotMoneyStats items={items} />

      {/* 游资连续动作（P4） */}
      <SeatRepeatPanel actions={repeatActions} />

      {/* 席位画像（v9.12：含行为模式徽标） */}
      <SeatProfileCard profiles={seatProfiles} behaviors={seatBehaviors} />

      {/* 龙虎榜列表 */}
      {[...dateGroups.entries()].map(([date, dateItems]) => (
        <div key={date} className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
          <div className="bg-white/5 px-4 py-2 text-sm font-bold text-slate-200">
            📋 {date} 龙虎榜（{dateItems.length}只）
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-sm">
              <thead className="bg-white/5 text-xs text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-left w-8"></th>
                  <th className="px-3 py-2 text-left">代码</th>
                  <th className="px-3 py-2 text-left">名称</th>
                  <th className="px-3 py-2 text-right">现价</th>
                  <th className="px-3 py-2 text-right">涨跌幅</th>
                  <th className="px-3 py-2 text-right">净买入</th>
                  <th className="px-3 py-2 text-center">上榜原因</th>
                  <th className="px-3 py-2 text-center">信号</th>
                </tr>
              </thead>
              <tbody>
                {dateItems.map(item => {
                  const key = `${item.code}_${item.tradeDate}`;
                  const isExp = expanded[key];
                  const seatData = seats[key];
                  // 合力/独食标记
                  const itemSignals = seatSignals.filter(s => s.stockCode === item.code);
                  return (
                    <Fragment key={key}>
                      <tr className="border-t border-white/5 hover:bg-white/5 cursor-pointer" onClick={() => toggleExpand(item)}>
                        <td className="px-3 py-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded bg-white/10 text-xs text-slate-300">
                            {isExp ? "−" : "+"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-400 text-xs">{item.code}</td>
                        <td className="px-3 py-2 font-medium text-slate-100">
                          <a href={stockRealUrl(item.code)} target="_blank" rel="noopener noreferrer" className="hover:text-amber-300">
                            {item.name}
                          </a>
                        </td>
                        <td className="px-3 py-2 text-right text-slate-100">{item.closePrice.toFixed(2)}</td>
                        <td className={`px-3 py-2 text-right font-semibold ${pctColor(item.changeRate)}`}>{fmtPct(item.changeRate)}</td>
                        <td className={`px-3 py-2 text-right font-semibold ${pctColor(item.netAmt)}`}>{fmtMoney(item.netAmt)}</td>
                        <td className="px-3 py-2 text-center">
                          <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${reasonColor(item.explanation)}`}>
                            {item.explanation.replace(/的前5只证券|的前五只证券/g, "")}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center">
                          {itemSignals.map((s, i) => (
                            <span key={i} className={`rounded px-1 py-0.5 text-[10px] font-bold mr-0.5 ${
                              s.signal === "合力" ? "bg-rose-500/20 text-rose-300" : "bg-amber-500/20 text-amber-300"
                            }`}>
                              {s.signal === "合力" ? "🤝合力" : "🍽独食"}
                            </span>
                          ))}
                        </td>
                      </tr>
                      {isExp && (
                        <tr>
                          <td colSpan={8} className="bg-black/30 px-4 py-3">
                            {seatsLoading[key] ? (
                              <div className="text-xs text-slate-500">加载席位数据中…</div>
                            ) : seatData ? (
                              <div className="space-y-2">
                                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                                  <div>
                                    <div className="text-xs font-bold text-rose-400 mb-1">买入前五</div>
                                    <SeatTable seats={seatData.buy} type="buy" behaviorMap={behaviorByDept} />
                                  </div>
                                  <div>
                                    <div className="text-xs font-bold text-emerald-400 mb-1">卖出前五</div>
                                    <SeatTable seats={seatData.sell} type="sell" behaviorMap={behaviorByDept} />
                                  </div>
                                </div>
                                {/* v9.13：综合分析 + 操作建议 */}
                                <BuySellAnalysisPanel buyers={seatData.buy} sellers={seatData.sell} behaviorMap={behaviorByDept} />
                              </div>
                            ) : (
                              <div className="text-xs text-slate-500">暂无席位数据</div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {items.length === 0 && !loading && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-6 text-amber-300 text-sm">
          暂无龙虎榜数据。龙虎榜数据通常在收盘后由交易所公布。
        </div>
      )}

      <div className="text-[11px] text-slate-600 leading-relaxed">
        数据来源：东方财富数据中心龙虎榜接口。席位标签引用 seatProfiles.ts 统一维护。
        席位画像随每日数据积累自动更新，T+1/T+5 溢价通过日线接口回填。
        <a href="https://data.eastmoney.com/stock/tradedetail.html" target="_blank" rel="noopener noreferrer" className="text-amber-300 hover:underline ml-1">
          查看东方财富龙虎榜 →
        </a>
      </div>
    </section>
  );
}
