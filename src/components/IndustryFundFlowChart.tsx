// 行业资金流向走势图（v9.26.19 资金主线页核心）
// 仿开盘啦"资金流向"图：8 强流入 + 8 强流出 = 16 行业叠加折线
// - x=09:30-15:00，y=累计主力净流入（亿）
// - 流入=红涨，流出=绿跌（中国习惯）
// - 标签自动在曲线右端，水平 1 字行
// 数据源：boardFundFlow.ts（push2his stock/kline/get f60=主力净额）

import { useEffect, useState } from "react";
import { fetchBoardFundCurves, type BoardFundCurve } from "../lib/boardFundFlow";

interface Props {
  /** 待展示的板块（secid + 名称），可含 mainNet 用于排序 */
  boards: Array<{ code: string; name: string; mainNet?: number }>;
  /** 自动刷新（秒） */
  refreshSec?: number;
}

function toYi(wan: number): number { return wan / 10000; }

export default function IndustryFundFlowChart({ boards, refreshSec = 120 }: Props) {
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
      <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-[12px] text-slate-500 text-center">
        {loading ? "加载资金走势..." : "暂无走势数据"}
      </div>
    );
  }

  // 时间轴
  const w = 920, h = 360, padL = 50, padR = 130, padT = 12, padB = 28;
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
  const stepX = (w - padL - padR) / (times.length - 1);
  const xOf = (t: string) => padL + times.indexOf(t) * stepX;
  const yOf = (yi: number) => h - padB - ((yi - minYi) / yRange) * (h - padT - padB);
  const y0 = yOf(0);

  // v9.26.20：不再硬编码数量——全部有数据的行业曲线都绘制（不 slice）
  const sorted = [...curves].sort((a, b) => {
    const av = a.cumCurve.length > 0 ? toYi(a.cumCurve[a.cumCurve.length - 1].cumWan) : 0;
    const bv = b.cumCurve.length > 0 ? toYi(b.cumCurve[b.cumCurve.length - 1].cumWan) : 0;
    return bv - av; // 降序：流入最大在前
  });
  const inflowCurves = sorted.filter(c => (c.cumCurve[c.cumCurve.length - 1]?.cumWan ?? 0) >= 0);
  const outflowCurves = sorted.filter(c => (c.cumCurve[c.cumCurve.length - 1]?.cumWan ?? 0) < 0).reverse();

  // 颜色：流入（红系梯度），流出（绿系梯度）—— 不够自动循环
  const inflowColors = ["#f43f5e", "#fb7185", "#ef4444", "#f97316", "#fb923c", "#facc15", "#eab308", "#dc2626", "#fda4af", "#fecaca", "#fcd34d", "#fdba74"];
  const outflowColors = ["#10b981", "#34d399", "#22c55e", "#16a34a", "#059669", "#0d9488", "#0ea5e9", "#0284c7", "#6ee7b7", "#a7f3d0", "#67e8f9", "#7dd3fc"];

  // v9.26.20：标签智能防重叠——按末端 y 排序后相邻间距不足时垂直错开
  const labelGap = 16;
  const allLabel = [...inflowCurves, ...outflowCurves].map(c => {
    const last = c.cumCurve[c.cumCurve.length - 1];
    const yi = toYi(last?.cumWan ?? 0);
    return { c, yi, y: yOf(yi), isInflow: yi >= 0 };
  }).sort((a, b) => a.y - b.y);
  // 错位：从下往上排，间距不足则下移
  for (let i = 1; i < allLabel.length; i++) {
    if (allLabel[i].y - allLabel[i - 1].y < labelGap) {
      allLabel[i].y = allLabel[i - 1].y + labelGap;
    }
  }
  // 顶部/底部 clamp 到绘图区内
  const yTop = padT + 4, yBottom = h - padB - 4;
  for (const lb of allLabel) lb.y = Math.max(yTop, Math.min(yBottom, lb.y));

  return (
    <div className="rounded-xl border border-rose-500/20 bg-gradient-to-br from-black/40 to-rose-950/5 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-sm font-bold text-slate-200">📊 今日行业资金流向（主力净流入/流出）</div>
        <div className="flex items-center gap-3 text-[10px] text-slate-500">
          <span className="text-rose-400">● 流入</span>
          <span className="text-emerald-400">● 流出</span>
          <span>· {refreshingIn(curves)} · 60s 刷新</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full">
        {/* 0 基准线 */}
        <line x1={padL} y1={y0} x2={w - padR} y2={y0} stroke="rgba(255,255,255,0.25)" strokeWidth="1" strokeDasharray="4 3" />
        {/* y 轴标签（亿） */}
        {[-yRange / 2, 0, yRange / 2].map((v, i) => {
          const y = yOf(v);
          return (
            <text key={i} x={padL - 4} y={y + 3} textAnchor="end" fill="rgba(148,163,184,0.7)" fontSize="10">
              {v >= 0 ? "+" : ""}{v.toFixed(0)}亿
            </text>
          );
        })}
        {/* 流入曲线（红） */}
        {inflowCurves.map((c, idx) => {
          const color = inflowColors[idx % inflowColors.length];
          return renderCurve(c, color, xOf, yOf, toYi, 1.6);
        })}
        {/* 流出曲线（绿） */}
        {outflowCurves.map((c, idx) => {
          const color = outflowColors[idx % outflowColors.length];
          return renderCurve(c, color, xOf, yOf, toYi, 1.6);
        })}
        {/* x 轴时间标签（5 个均匀） */}
        {times.filter((_, i) => i % Math.max(1, Math.floor(times.length / 5)) === 0).slice(0, 5).map((t) => (
          <text key={t} x={xOf(t)} y={h - 8} textAnchor="middle" fill="rgba(148,163,184,0.7)" fontSize="10">
            {t}
          </text>
        ))}
        {/* 标签（曲线右端，已按 y 错位防重叠） */}
        {allLabel.map((lb) => {
          const last = lb.c.cumCurve[lb.c.cumCurve.length - 1];
          if (!last) return null;
          const x = xOf(last.t) + 4;
          const y = lb.y;
          return (
            <g key={`label-${lb.c.boardCode}`}>
              <line x1={x} y1={yOf(lb.yi)} y2={y} stroke={lb.isInflow ? "#f43f5e" : "#10b981"} strokeWidth="0.6" strokeDasharray="2 2" opacity="0.6" />
              <line x1={x} y1={y} x2={x + 8} y2={y} stroke={lb.isInflow ? "#f43f5e" : "#10b981"} strokeWidth="0.6" strokeDasharray="2 2" opacity="0.6" />
              <text x={x + 12} y={y + 3} fontSize="10" fontWeight="600" fill={lb.isInflow ? "#fca5a5" : "#86efac"}>
                {lb.c.boardName}
              </text>
              <text x={x + 12} y={y + 16} fontSize="9" fill={lb.isInflow ? "#fca5a5" : "#86efac"} opacity="0.7">
                {lb.yi >= 0 ? "+" : ""}{lb.yi.toFixed(2)}亿
              </text>
            </g>
          );
        })}
      </svg>
      {/* 下方明细（流入榜 + 流出榜，按实际数据全量展示） */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
        <div>
          <div className="text-[11px] font-bold text-rose-300 mb-1">🔥 主力净流入（{inflowCurves.length} 行业）</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            {inflowCurves.map((c, i) => (
              <div key={c.boardCode} className="flex items-center justify-between text-[10px]">
                <span className="text-slate-300 truncate flex items-center gap-1">
                  <span className="inline-block w-1.5 h-1.5 rounded" style={{background: inflowColors[i % inflowColors.length]}} />
                  {c.boardName}
                </span>
                <span className="text-rose-400 font-mono">+{toYi(c.totalWan).toFixed(2)}亿</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="text-[11px] font-bold text-emerald-300 mb-1">🟢 主力净流出（{outflowCurves.length} 行业）</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            {outflowCurves.map((c, i) => (
              <div key={c.boardCode} className="flex items-center justify-between text-[10px]">
                <span className="text-slate-300 truncate flex items-center gap-1">
                  <span className="inline-block w-1.5 h-1.5 rounded" style={{background: outflowColors[i % outflowColors.length]}} />
                  {c.boardName}
                </span>
                <span className="text-emerald-400 font-mono">{toYi(c.totalWan).toFixed(2)}亿</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function renderCurve(
  c: BoardFundCurve,
  color: string,
  xOf: (t: string) => number,
  yOf: (yi: number) => number,
  toYi: (w: number) => number,
  strokeWidth: number,
) {
  const path = c.cumCurve.map((p, i) => {
    const x = xOf(p.t);
    const y = yOf(toYi(p.cumWan));
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <g key={c.boardCode}>
      <path d={path} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
    </g>
  );
}

function refreshingIn(curves: BoardFundCurve[]): string {
  if (curves.length === 0) return "";
  const last = curves[0].cumCurve[curves[0].cumCurve.length - 1];
  return last ? `截至 ${last.t}` : "";
}