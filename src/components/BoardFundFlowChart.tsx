// 板块资金走势图（v9.26.17 资金主线可视化）
// 多板块折线图：x=时间 09:30-15:00，y=累计主力净流入（亿）
// 红涨绿跌（中国习惯：流入=红、流出=绿）
// 数据源：lib/boardFundFlow.ts（push2his stock/kline/get f60=主力净额）

import { useEffect, useState } from "react";
import { fetchBoardFundCurves, type BoardFundCurve } from "../lib/boardFundFlow";

interface Props {
  /** 待展示的板块（secid + 名称） */
  boards: Array<{ code: string; name: string }>;
  /** 自动刷新（秒） */
  refreshSec?: number;
}

/** 累计资金曲线（亿元） */
function toYi(wan: number): number { return wan / 10000; }

export default function BoardFundFlowChart({ boards, refreshSec = 60 }: Props) {
  const [curves, setCurves] = useState<BoardFundCurve[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (boards.length === 0) return;
      setLoading(true);
      const data = await fetchBoardFundCurves(boards);
      if (!cancelled) {
        setCurves(data);
        setLoading(false);
      }
    };
    load();
    const t = setInterval(load, refreshSec * 1000);
    return () => { cancelled = true; clearInterval(t); };
  }, [boards.map(b => b.code).join(","), refreshSec]);

  if (boards.length === 0) return null;
  if (curves.length === 0) {
    return (
      <div className="text-[11px] text-slate-500 text-center py-3">
        {loading ? "加载资金走势..." : "暂无走势数据"}
      </div>
    );
  }

  // 计算公共时间范围（09:30 - 15:00）
  const w = 560, h = 180, padL = 56, padR = 12, padT = 8, padB = 22;
  // 收集所有时间点
  const allTimes = new Set<string>();
  for (const c of curves) for (const p of c.cumCurve) allTimes.add(p.t);
  const times = [...allTimes].sort();
  if (times.length < 2) return null;
  // y 轴范围（亿元）
  let minYi = 0, maxYi = 0;
  for (const c of curves) for (const p of c.cumCurve) {
    const yi = toYi(p.cumWan);
    if (yi < minYi) minYi = yi;
    if (yi > maxYi) maxYi = yi;
  }
  const yRange = Math.max(1, maxYi - minYi);
  // 比例
  const stepX = (w - padL - padR) / (times.length - 1);
  const xOf = (t: string) => padL + times.indexOf(t) * stepX;
  const yOf = (yi: number) => h - padB - ((yi - minYi) / yRange) * (h - padT - padB);
  // 0 基准线
  const y0 = yOf(0);
  // 颜色（红涨绿跌）—— 流入=红(rose)，流出=绿(emerald)
  const palette = [
    "stroke-rose-400", "stroke-emerald-400", "stroke-amber-400",
    "stroke-sky-400", "stroke-fuchsia-400", "stroke-violet-400",
    "stroke-orange-400", "stroke-pink-400", "stroke-cyan-400", "stroke-lime-400",
  ];

  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-2.5 space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-bold text-slate-200">📈 今日行业资金流入/流出走势</div>
        <div className="text-[9px] text-slate-600">每分钟主力净额（亿） · {refreshingIn(curves)}</div>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full">
        {/* 0 基准线 */}
        <line x1={padL} y1={y0} x2={w - padR} y2={y0} stroke="rgba(255,255,255,0.25)" strokeWidth="1" strokeDasharray="3 3" />
        {/* y 轴标签（最少 5 个：min/0/max） */}
        {[-yRange / 2, 0, yRange / 2].map((v, i) => {
          const yi = v;
          const y = yOf(yi);
          return (
            <text key={i} x={padL - 4} y={y + 3} textAnchor="end" fill="rgba(148,163,184,0.7)" fontSize="9">
              {yi >= 0 ? "+" : ""}{yi.toFixed(1)}亿
            </text>
          );
        })}
        {/* 板块曲线 */}
        {curves.map((c, idx) => {
          const color = palette[idx % palette.length];
          const path = c.cumCurve.map((p, i) => {
            const x = xOf(p.t);
            const y = yOf(toYi(p.cumWan));
            return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
          }).join(" ");
          const last = c.cumCurve[c.cumCurve.length - 1];
          if (!last) return null;
          return (
            <g key={c.boardCode}>
              <path d={path} fill="none" className={color} strokeWidth="1.5" strokeLinecap="round" />
              <circle cx={xOf(last.t)} cy={yOf(toYi(last.cumWan))} r="2.5" className={`fill-current ${color.replace("stroke-", "text-")}`} />
            </g>
          );
        })}
        {/* x 轴时间标签（5 个均匀） */}
        {times.filter((_, i) => i % Math.max(1, Math.floor(times.length / 5)) === 0).slice(0, 5).map((t) => (
          <text key={t} x={xOf(t)} y={h - 6} textAnchor="middle" fill="rgba(148,163,184,0.7)" fontSize="9">
            {t}
          </text>
        ))}
      </svg>
      {/* 板块图例 */}
      <div className="flex flex-wrap gap-x-2 gap-y-0.5">
        {curves.map((c, idx) => {
          const yi = toYi(c.totalWan);
          return (
            <span key={c.boardCode} className="flex items-center gap-1 text-[10px] text-slate-400">
              <span className={`inline-block h-1.5 w-3 rounded ${palette[idx % palette.length].replace("stroke-", "bg-")}`} />
              <span>{c.boardName}</span>
              <span className={yi >= 0 ? "text-rose-400" : "text-emerald-400"}>
                {yi >= 0 ? "+" : ""}{yi.toFixed(2)}亿
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function refreshingIn(curves: BoardFundCurve[]): string {
  if (curves.length === 0) return "";
  const last = curves[0].cumCurve[curves[0].cumCurve.length - 1];
  return last ? `截至 ${last.t}` : "";
}