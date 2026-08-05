// ============================================================
// 行业资金流向走势图（v9.30 资金主线页核心）
// 仿开盘啦"资金流向"图：30 个行业折线叠加（红涨绿跌）
// - x 轴：09:30 → 15:00 虚拟时间轴
// - y 轴：累计主力净流入（亿元）
// - 每条线 = 一个行业，从 (09:30, 0) 拉到 (15:00, mainNet/1e8)
// - 流入行业红色系，流出行业绿色系（颜色梯度按强度）
// 数据源：App.tsx 传入的 industryBoards（kind="industry"，30 个行业）
//   —— 不依赖 push2his（东财持续 ban 导致分钟 K 线数据稀疏）；
//   待 push2his 稳定后再换为真实分时曲线。
// ============================================================

import { useMemo, useEffect, useState } from "react";
import { isLocalServer } from "../lib/cloudStore";
// v9.33（缺口6）：资金连续性/切换信号徽标
import { buildFundStreaks, type FundStreak } from "../lib/fundStreak";

export interface IndustryFundItem {
  code: string;
  name: string;
  /** 今日累计主力净流入（元） */
  mainNet: number;
  /** 今日板块涨跌幅 % */
  pct?: number;
}

interface Props {
  boards: IndustryFundItem[];
  /** 截至今时（决定折线终点 x 位置） */
  asOfMinutes?: number; // 默认 270（=15:00 收盘）
  refreshSec?: number;
}

/** 元 → 亿 */
function toYi(yuan: number): number { return yuan / 1e8; }

const inflowColors = ["#f43f5e", "#fb7185", "#ef4444", "#f97316", "#fb923c", "#facc15", "#eab308", "#dc2626", "#fda4af", "#fecaca", "#fcd34d", "#fdba74"];
const outflowColors = ["#10b981", "#34d399", "#22c55e", "#16a34a", "#059669", "#0d9488", "#0ea5e9", "#0284c7", "#6ee7b7", "#a7f3d0", "#67e8f9", "#7dd3fc"];

export default function IndustryFundFlowChart({ boards, asOfMinutes = 270, refreshSec = 60 }: Props) {
  // v9.33（缺口6）：资金连续性数据（本地服务端读 kv fund_streak）
  const [streaks, setStreaks] = useState<Map<string, FundStreak>>(new Map());
  useEffect(() => {
    if (!isLocalServer()) return;
    let alive = true;
    buildFundStreaks().then((list) => {
      if (alive && list) setStreaks(new Map(list.map((s) => [s.board, s])));
    }).catch(() => { /* 非本地静默 */ });
    return () => { alive = false; };
  }, []);

  // 拆分流入/流出 + 排序
  const { inflow, outflow } = useMemo(() => {
    const ins = boards.filter(b => b.mainNet > 0).sort((a, b) => b.mainNet - a.mainNet);
    const outs = boards.filter(b => b.mainNet < 0).sort((a, b) => a.mainNet - b.mainNet);
    return { inflow: ins, outflow: outs };
  }, [boards]);

  if (boards.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-[12px] text-slate-500 text-center">
        暂无行业资金数据
      </div>
    );
  }

  // SVG 尺寸
  const w = 920, h = 360, padL = 50, padR = 140, padT = 12, padB = 30;
  // y 范围：取流入流出绝对值最大者 ± 一档 padding
  const maxAbs = Math.max(
    inflow[0]?.mainNet ? Math.abs(toYi(inflow[0].mainNet)) : 0,
    outflow[0]?.mainNet ? Math.abs(toYi(outflow[0].mainNet)) : 0,
    0.01,
  );
  const yMax = maxAbs * 1.15;
  const yMin = -maxAbs * 1.15;
  const yRange = yMax - yMin;
  const xOf = (m: number) => padL + (m / 270) * (w - padL - padR); // 0..270 分钟 → padL..w-padR
  const yOf = (yi: number) => h - padB - ((yi - yMin) / yRange) * (h - padT - padB);
  const y0 = yOf(0);
  const xEnd = xOf(asOfMinutes);

  /** 渲染单条行业线：起点 (0, 0)，终点 (asOfMinutes, mainNet 亿) */
  function renderLine(name: string, valYi: number, color: string) {
    const x0 = xOf(0);
    const y0p = yOf(0);
    const yEnd = yOf(valYi);
    // 平滑曲线：用三次贝塞尔，模拟分时的"累积过程"（前慢后快 / 前快后慢的轻微弧度）
    const cx = (x0 + xEnd) / 2;
    const path = valYi >= 0
      ? `M ${x0} ${y0p} C ${cx} ${y0p} ${cx} ${yEnd} ${xEnd} ${yEnd}`
      : `M ${x0} ${y0p} C ${cx} ${y0p} ${cx} ${yEnd} ${xEnd} ${yEnd}`;
    return (
      <g key={name}>
        <path d={path} fill="none" stroke={color} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
      </g>
    );
  }

  // 标签定位：按末端 y 排序后错位防重叠（与原版一致）
  const allLabel = [
    ...inflow.map((b, i) => ({ name: b.name, valYi: toYi(b.mainNet), isInflow: true, idx: i })),
    ...outflow.map((b, i) => ({ name: b.name, valYi: toYi(b.mainNet), isInflow: false, idx: i })),
  ].sort((a, b) => a.valYi - b.valYi); // 从流出（底）到流入（顶）
  const labelGap = 16;
  for (let i = 1; i < allLabel.length; i++) {
    const prev = yOf(allLabel[i - 1].valYi);
    const cur = yOf(allLabel[i].valYi);
    if (cur - prev < labelGap) {
      // 上移上一个（或下移当前）—— 通过微调 valYi 等价下移当前
      allLabel[i].valYi = allLabel[i - 1].valYi - labelGap * (yRange / (h - padT - padB));
    }
  }
  // clamp 到绘图区
  for (const lb of allLabel) {
    if (lb.valYi > yMax * 0.95) lb.valYi = yMax * 0.95;
    if (lb.valYi < yMin * 0.95) lb.valYi = yMin * 0.95;
  }

  return (
    <div className="rounded-xl border border-rose-500/20 bg-gradient-to-br from-black/40 to-rose-950/5 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-sm font-bold text-slate-200">📊 今日行业资金流向（主力净流入/流出）</div>
        <div className="flex items-center gap-3 text-[10px] text-slate-500">
          <span className="text-rose-400">● 流入</span>
          <span className="text-emerald-400">● 流出</span>
          <span>· 截至 {minutesToLabel(asOfMinutes)} · {refreshSec}s 刷新</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full">
        {/* 0 基准线 */}
        <line x1={padL} y1={y0} x2={w - padR} y2={y0} stroke="rgba(255,255,255,0.25)" strokeWidth="1" strokeDasharray="4 3" />
        {/* y 轴标签（亿） */}
        {[yMax, yMax / 2, 0, yMin / 2, yMin].map((v, i) => (
          <text key={i} x={padL - 4} y={yOf(v) + 3} textAnchor="end" fill="rgba(148,163,184,0.7)" fontSize="10">
            {v >= 0 ? "+" : ""}{v.toFixed(1)}亿
          </text>
        ))}
        {/* x 轴时间标签 */}
        {[
          { m: 0, label: "09:30" },
          { m: 60, label: "10:30" },
          { m: 120, label: "11:30" },
          { m: 150, label: "13:00" },
          { m: 210, label: "14:30" },
          { m: 270, label: "15:00" },
        ].filter((_, i) => i % 1 === 0).map(t => (
          <text key={t.label} x={xOf(t.m)} y={h - 8} textAnchor="middle" fill="rgba(148,163,184,0.7)" fontSize="10">
            {t.label}
          </text>
        ))}
        {/* 流入曲线（红） */}
        {inflow.map((b, i) => renderLine(b.name, toYi(b.mainNet), inflowColors[i % inflowColors.length]))}
        {/* 流出曲线（绿） */}
        {outflow.map((b, i) => renderLine(b.name, toYi(b.mainNet), outflowColors[i % outflowColors.length]))}
        {/* 标签（末端 y 错位防重叠） */}
        {allLabel.map((lb) => {
          const raw = lb.isInflow
            ? toYi(inflow[lb.idx].mainNet)
            : toYi(outflow[lb.idx].mainNet);
          const y = yOf(lb.valYi);
          const color = lb.isInflow ? "#f43f5e" : "#10b981";
          const textColor = lb.isInflow ? "#fca5a5" : "#86efac";
          return (
            <g key={`label-${lb.name}`}>
              <line x1={xEnd} y1={yOf(raw)} x2={xEnd + 6} y2={y} stroke={color} strokeWidth="0.6" strokeDasharray="2 2" opacity="0.6" />
              <text x={xEnd + 12} y={y + 3} fontSize="10" fontWeight="600" fill={textColor}>
                {lb.name}
              </text>
              <text x={xEnd + 12} y={y + 16} fontSize="9" fill={textColor} opacity="0.75">
                {raw >= 0 ? "+" : ""}{raw.toFixed(2)}亿
              </text>
            </g>
          );
        })}
      </svg>
      {/* 下方明细（流入榜 + 流出榜） */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
        <div>
          <div className="text-[11px] font-bold text-rose-300 mb-1">🔥 主力净流入（{inflow.length} 行业）</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            {inflow.map((b, i) => (
              <div key={b.code} className="flex items-center justify-between text-[10px]">
                <span className="text-slate-300 truncate flex items-center gap-1">
                  <span className="inline-block w-1.5 h-1.5 rounded" style={{ background: inflowColors[i % inflowColors.length] }} />
                  {b.name}
                  {streakBadge(streaks.get(b.name), "inflow")}
                </span>
                <span className="text-rose-400 font-mono">+{toYi(b.mainNet).toFixed(2)}亿</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="text-[11px] font-bold text-emerald-300 mb-1">🟢 主力净流出（{outflow.length} 行业）</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            {outflow.length === 0 ? (
              <div className="text-[10px] text-slate-500 col-span-2">今日无明显净流出行业</div>
            ) : (
              outflow.map((b, i) => (
                <div key={b.code} className="flex items-center justify-between text-[10px]">
                  <span className="text-slate-300 truncate flex items-center gap-1">
                    <span className="inline-block w-1.5 h-1.5 rounded" style={{ background: outflowColors[i % outflowColors.length] }} />
                    {b.name}
                    {streakBadge(streaks.get(b.name), "outflow")}
                  </span>
                  <span className="text-emerald-400 font-mono">{toYi(b.mainNet).toFixed(2)}亿</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function minutesToLabel(m: number): string {
  const totalMin = 9 * 60 + 30 + m; // 09:30 起算
  const hh = Math.floor(totalMin / 60);
  const mm = totalMin % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

// v9.33（缺口6）：资金连续性/切换徽标
function streakBadge(s: FundStreak | undefined, side: "inflow" | "outflow") {
  if (!s) return null;
  // 切换信号（无论方向，最值得注意）
  if (side === "outflow" && s.switchedFromHere)
    return <span className="rounded bg-amber-500/20 px-1 text-[9px] font-bold text-amber-300" title={`昨日流入→今日流出（切换信号）`}>⚠切换</span>;
  if (side === "inflow" && s.switchedToHere)
    return <span className="rounded bg-sky-500/20 px-1 text-[9px] font-bold text-sky-300" title={`昨日流出→今日流入（资金进场）`}>↗进场</span>;
  // 连续流入≥3 天（机构建仓信号）
  if (side === "inflow" && s.consecutiveInflowDays >= 3)
    return <span className="rounded bg-rose-500/20 px-1 text-[9px] font-bold text-rose-300" title={`连续${s.consecutiveInflowDays}日主力净流入`}>🔥{s.consecutiveInflowDays}日</span>;
  // 连续流出≥3 天
  if (side === "outflow" && s.consecutiveInflowDays <= -3)
    return <span className="rounded bg-emerald-500/20 px-1 text-[9px] font-bold text-emerald-300" title={`连续${-s.consecutiveInflowDays}日主力净流出`}>❄{-s.consecutiveInflowDays}日</span>;
  return null;
}