import { useState, useMemo } from "react";
import { fmtMoney, fmtPct, pctColor } from "../lib/format";
import { boardRealUrl } from "../lib/realLinks";
import type { BoardRankItem } from "../lib/api";

type TabKey = "inflow" | "outflow" | "diverge";
type SortKey = "mainNet" | "mainNet5d" | "mainNet10d" | "pct" | "turnoverRate";

function DivergeBadge({ mainNet, pct }: { mainNet: number; pct: number }) {
  const isDiverge = (mainNet > 0 && pct < -0.3) || (mainNet < 0 && pct > 0.3);
  if (!isDiverge) return null;
  return <span className="ml-1 rounded px-1 py-0.5 text-[11px] font-bold bg-orange-500/20 text-orange-300">量价背离</span>;
}

interface Props {
  inflow: BoardRankItem[];
  outflow: BoardRankItem[];
}

export default function BoardRankPanel({ inflow, outflow }: Props) {
  const [tab, setTab] = useState<TabKey>("inflow");
  const [sortKey, setSortKey] = useState<SortKey>("mainNet");
  const [sortAsc, setSortAsc] = useState(false);

  // 近3日净流入但今日转净流出的板块
  const divergeBoards = useMemo(() => {
    const all = [...inflow, ...outflow];
    return all.filter(b => b.mainNet5d > 0 && b.mainNet < 0);
  }, [inflow, outflow]);

  const currentList = tab === "inflow" ? inflow : tab === "outflow" ? outflow : divergeBoards;

  const sortedList = useMemo(() => {
    const list = [...currentList];
    list.sort((a, b) => {
      const va = a[sortKey] ?? 0;
      const vb = b[sortKey] ?? 0;
      return sortAsc ? va - vb : vb - va;
    });
    return list;
  }, [currentList, sortKey, sortAsc]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(v => !v);
    else { setSortKey(key); setSortAsc(false); }
  };

  const sortIcon = (key: SortKey) => sortKey === key ? (sortAsc ? " ↑" : " ↓") : "";

  // 热力矩阵数据（纯div实现）
  const heatmapInflow = useMemo(() => inflow.filter(b => b.mainNet > 0).slice(0, 8), [inflow]);
  const heatmapOutflow = useMemo(() => outflow.filter(b => b.mainNet < 0).slice(0, 8), [outflow]);

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-4">
      <div className="text-sm font-bold text-slate-200">📊 概念板块资金流排行</div>

      {/* Tab切换 */}
      <div className="flex gap-1">
        {([
          { key: "inflow" as TabKey, label: "🔥 净流入 Top10", color: "text-emerald-400" },
          { key: "outflow" as TabKey, label: "💧 净流出 Top10", color: "text-rose-400" },
          { key: "diverge" as TabKey, label: `⚠️ 流入转流出(${divergeBoards.length})`, color: "text-orange-400" },
        ] as const).map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); setSortKey("mainNet"); setSortAsc(false); }}
            className={`rounded px-3 py-1.5 text-xs font-bold transition ${
              tab === t.key ? `bg-white/10 ${t.color}` : "text-slate-500 hover:text-slate-300"
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* 流入转流出提示 */}
      {tab === "diverge" && (
        <div className="rounded-lg border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-xs text-orange-300">
          ⚠️ 以下板块近5日累计净流入为正，但今日转为净流出 — 警惕获利了结信号
        </div>
      )}

      {/* 可排序表格 */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-white/10 text-slate-400">
              <th className="px-2 py-1.5 text-left">板块</th>
              <th className="px-2 py-1.5 text-right cursor-pointer hover:text-amber-300" onClick={() => handleSort("mainNet")}>
                今日净流入{sortIcon("mainNet")}
              </th>
              <th className="px-2 py-1.5 text-right cursor-pointer hover:text-amber-300" onClick={() => handleSort("mainNet5d")}>
                近5日{sortIcon("mainNet5d")}
              </th>
              <th className="px-2 py-1.5 text-right cursor-pointer hover:text-amber-300" onClick={() => handleSort("mainNet10d")}>
                近10日{sortIcon("mainNet10d")}
              </th>
              <th className="px-2 py-1.5 text-right cursor-pointer hover:text-amber-300" onClick={() => handleSort("pct")}>
                涨跌幅{sortIcon("pct")}
              </th>
              <th className="px-2 py-1.5 text-right cursor-pointer hover:text-amber-300" onClick={() => handleSort("turnoverRate")}>
                换手率{sortIcon("turnoverRate")}
              </th>
              <th className="px-2 py-1.5 text-center">连续天数</th>
            </tr>
          </thead>
          <tbody>
            {sortedList.map(b => (
              <tr key={b.code} className="border-b border-white/5 hover:bg-white/5">
                <td className="px-2 py-1.5 font-medium">
                  <a href={boardRealUrl(b.code, "concept")} target="_blank" rel="noopener noreferrer" className="text-slate-200 hover:text-amber-300">
                    {b.name}
                  </a>
                  <DivergeBadge mainNet={b.mainNet} pct={b.pct} />
                </td>
                <td className={`px-2 py-1.5 text-right font-semibold ${pctColor(b.mainNet)}`}>{fmtMoney(b.mainNet)}</td>
                <td className={`px-2 py-1.5 text-right ${pctColor(b.mainNet5d)}`}>{fmtMoney(b.mainNet5d)}</td>
                <td className={`px-2 py-1.5 text-right ${pctColor(b.mainNet10d)}`}>{fmtMoney(b.mainNet10d)}</td>
                <td className={`px-2 py-1.5 text-right ${pctColor(b.pct)}`}>{fmtPct(b.pct)}</td>
                <td className="px-2 py-1.5 text-right text-slate-300">{b.turnoverRate > 0 ? `${b.turnoverRate.toFixed(1)}%` : "-"}</td>
                <td className="px-2 py-1.5 text-center">
                  <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${
                    b.consecutiveDays > 0 ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300"
                  }`}>
                    {b.consecutiveDays > 0 ? `连续${b.consecutiveDays}天流入` : `连续${Math.abs(b.consecutiveDays)}天流出`}
                  </span>
                </td>
              </tr>
            ))}
            {sortedList.length === 0 && (
              <tr><td colSpan={7} className="px-2 py-4 text-center text-slate-500">暂无数据</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 资金轮动热力矩阵（纯div实现，参考同花顺/通达信热力图风格） */}
      {(heatmapInflow.length > 0 || heatmapOutflow.length > 0) && (
        <div>
          <div className="text-xs font-bold text-slate-300 mb-2">📊 板块资金轮动矩阵（🔴红=流入 🟢绿=流出，面积∝金额）</div>
          <div className="grid grid-cols-2 gap-2">
            {/* 流入区 */}
            <div>
              <div className="text-[11px] text-rose-400 font-bold mb-1">▲ 资金流入</div>
              <div className="flex flex-wrap gap-1">
                {heatmapInflow.map((b, i) => {
                  // 面积权重：第1名最大，依次缩小
                  const weight = 1 - i * 0.08;
                  const maxAmt = heatmapInflow[0]?.mainNet || 1;
                  const ratio = Math.abs(b.mainNet) / maxAmt;
                  // 红色深浅：金额越大越深
                  const alpha = 0.25 + ratio * 0.45;
                  return (
                    <div key={b.code} className="rounded-md border border-rose-500/20 flex flex-col items-center justify-center text-center"
                      style={{
                        backgroundColor: `rgba(185,28,28,${alpha})`,
                        width: `${Math.max(60, 120 * weight)}px`,
                        height: `${Math.max(44, 64 * weight)}px`,
                      }}>
                      <div className="text-[11px] font-bold text-rose-100 leading-tight">{b.name}</div>
                      <div className="text-[11px] text-rose-300">{fmtPct(b.pct)}</div>
                      <div className="text-[11px] text-rose-200/80">{fmtMoney(b.mainNet)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
            {/* 流出区 */}
            <div>
              <div className="text-[11px] text-emerald-400 font-bold mb-1">▼ 资金流出</div>
              <div className="flex flex-wrap gap-1">
                {heatmapOutflow.map((b, i) => {
                  const weight = 1 - i * 0.08;
                  const maxAmt = heatmapOutflow[0]?.mainNet || -1;
                  const ratio = Math.abs(b.mainNet) / Math.abs(maxAmt);
                  const alpha = 0.2 + ratio * 0.4;
                  return (
                    <div key={b.code} className="rounded-md border border-emerald-500/20 flex flex-col items-center justify-center text-center"
                      style={{
                        backgroundColor: `rgba(21,128,61,${alpha})`,
                        width: `${Math.max(60, 120 * weight)}px`,
                        height: `${Math.max(44, 64 * weight)}px`,
                      }}>
                      <div className="text-[11px] font-bold text-emerald-100 leading-tight">{b.name}</div>
                      <div className="text-[11px] text-emerald-300">{fmtPct(b.pct)}</div>
                      <div className="text-[11px] text-emerald-200/80">{fmtMoney(b.mainNet)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="text-[11px] text-slate-500">
        点击列标题可排序。量价背离=资金方向与涨跌幅方向相反。流入转流出=近5日累计流入但今日转出。数据源：东方财富概念板块资金流接口。
      </div>
    </div>
  );
}
