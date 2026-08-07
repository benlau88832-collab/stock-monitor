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
// v9.54（V7-14）：数据诚实 —— 图内显式标注"示意曲线（非真实分时）"，
//   避免用户把单点值插值误读为真实分时资金进出。
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

  // ============== v11-10（P1）：横向条形图（替换伪分时曲线） ==============
  // 原实现：30 条线全从 (09:30,0) 扇形展开，视觉错位混乱；且是插值伪曲线
  // 新实现：0 基准线居中，流入行业红色向右伸、流出行业绿色向左伸，每行行业名+金额
  // 布局：SVG 单列条形，maxAbs 归一化条长；行高 24px；行业多 → 外层滚动
  const rows = [...inflow.map(b => ({ b, isIn: true })), ...outflow.map(b => ({ b, isIn: false }))];
  const rowH = 24;
  const svgH = Math.min(rows.length, 15) * rowH + 24; // 最多显示 15 行，其余滚动
  const labelW = 64, gapW = 6, valW = 60, barMaxW = 320;
  const x0 = labelW + barMaxW * 0.18; // 0 基准线位置（左侧留行业名+少量右伸空间）
  const maxAbsY = Math.max(...rows.map(r => Math.abs(toYi(r.b.mainNet))), 0.01);

  return (
    <div className="rounded-xl border border-rose-500/20 bg-gradient-to-br from-black/40 to-rose-950/5 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-sm font-bold text-slate-200">📊 今日行业资金流向（主力净流入/流出）</div>
        <div className="flex items-center gap-3 text-[10px] text-slate-500">
          <span className="text-rose-400">● 流入</span>
          <span className="text-emerald-400">● 流出</span>
          <span>· 截至 {minutesToLabel(asOfMinutes)} · {refreshSec}s 刷新</span>
          <span className="rounded bg-slate-500/15 px-1.5 py-0.5 font-bold text-amber-300/90" title="当日累计主力净流入（单日快照），非分时曲线">当日累计净流入</span>
        </div>
      </div>
      {/* 横向条形图（滚动区，最多展示 15 行） */}
      <div className="max-h-[400px] overflow-y-auto pr-1">
        <svg viewBox={`0 0 ${labelW + barMaxW + valW} ${svgH}`} className="w-full" role="img" aria-label="行业资金流向横向条形图，红色流入右伸、绿色流出左伸">
          {/* 0 基准线 */}
          <line x1={x0} y1={8} x2={x0} y2={svgH - 8} stroke="rgba(255,255,255,0.25)" strokeWidth="1" strokeDasharray="4 3" />
          {rows.map(({ b, isIn }, i) => {
            const valYi = toYi(b.mainNet);
            const len = Math.max(3, Math.abs(valYi) / maxAbsY * barMaxW * 0.8);
            const y = 14 + i * rowH;
            const barX = isIn ? x0 + 2 : x0 - 2 - len;
            const color = isIn ? "#f43f5e" : "#10b981";
            const textColor = isIn ? "#fca5a5" : "#86efac";
            return (
              <g key={b.code}>
                {/* 行业名 */}
                <text x={x0 - gapW} y={y + 8} textAnchor="end" fontSize="11" fill="rgba(148,163,184,0.9)">{b.name.slice(0, 6)}</text>
                {/* 条形（流入红右伸 / 流出绿左伸） */}
                <rect x={barX} y={y} width={len} height={10} rx={2} fill={color} opacity={0.75} />
                {/* 金额 */}
                <text x={isIn ? x0 + 2 + len + 5 : x0 - 2 - len - 5} y={y + 8}
                  fontSize="10" fontWeight="600" fill={textColor} textAnchor={isIn ? "start" : "end"}>
                  {valYi >= 0 ? "+" : ""}{valYi.toFixed(1)}亿
                </text>
              </g>
            );
          })}
        </svg>
      </div>
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
    return <span className="rounded bg-amber-500/20 px-1 text-xs font-bold text-amber-300" title={`昨日流入→今日流出（切换信号）`}>⚠切换</span>;
  if (side === "inflow" && s.switchedToHere)
    return <span className="rounded bg-sky-500/20 px-1 text-xs font-bold text-sky-300" title={`昨日流出→今日流入（资金进场）`}>↗进场</span>;
  // 连续流入≥3 天（机构建仓信号）
  if (side === "inflow" && s.consecutiveInflowDays >= 3)
    return <span className="rounded bg-rose-500/20 px-1 text-xs font-bold text-rose-300" title={`连续${s.consecutiveInflowDays}日主力净流入`}>🔥{s.consecutiveInflowDays}日</span>;
  // 连续流出≥3 天
  if (side === "outflow" && s.consecutiveInflowDays <= -3)
    return <span className="rounded bg-emerald-500/20 px-1 text-xs font-bold text-emerald-300" title={`连续${-s.consecutiveInflowDays}日主力净流出`}>❄{-s.consecutiveInflowDays}日</span>;
  return null;
}