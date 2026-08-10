// ============================================================
// v9.97.0（批次 2）：K线卡 —— 纯 SVG 手绘蜡烛（tinavi 方案，零框架依赖）
// 背景：Recharts 3.x 的 Customized 已废弃（不再传 xAxisMap/yAxisMap），改用纯 SVG：
//   蜡烛 rect(实体)+line(影线) 手绘，MA5/20 折线 path，成交量 bar，A股涨红跌绿
// 周期：1月/3月/6月/1年/周线/月线（周月线由日线前端聚合）
// ============================================================
import { useMemo, useState } from "react";

interface Kline { date: string; open: number; close: number; high: number; low: number; volume: number; }

interface Props {
  klines: Kline[];
  name?: string;
}

const RANGES = [
  { key: 22, label: "1月" },
  { key: 66, label: "3月" },
  { key: 132, label: "6月" },
  { key: 250, label: "1年" },
  { key: "week", label: "周线" },
  { key: "month", label: "月线" },
];

function aggregate(klines: Kline[], mode: "week" | "month"): Kline[] {
  const out: Kline[] = [];
  let cur: Kline | null = null;
  let curKey = "";
  for (const k of klines) {
    const d = new Date(k.date + "T00:00:00");
    // 周 key = 该周周一日期（周日归上周）；月 key = YYYY-MM
    const key = mode === "week"
      ? (() => {
          const monday = new Date(d);
          const dow = d.getDay() === 0 ? 7 : d.getDay(); // 周一=1...周日=7
          monday.setDate(d.getDate() - (dow - 1));
          return monday.toISOString().slice(0, 10);
        })()
      : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (key !== curKey) {
      if (cur) out.push(cur);
      cur = { ...k };
      curKey = key;
    } else if (cur) {
      cur.high = Math.max(cur.high, k.high);
      cur.low = Math.min(cur.low, k.low);
      cur.close = k.close;
      cur.volume += k.volume;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}

const W = 460;
const H_CANDLE = 130;
const H_VOL = 28;
const PAD = 4;

export default function KlineCard({ klines, name = "" }: Props) {
  const [range, setRange] = useState<number | "week" | "month">(66);

  const data = useMemo(() => {
    if (!klines || klines.length === 0) return [];
    let series: Kline[] = klines;
    if (range === "week") series = aggregate(klines, "week");
    else if (range === "month") series = aggregate(klines, "month");
    else series = klines.slice(-(range as number));
    const closes = series.map(k => k.close);
    const ma5 = sma(closes, 5);
    const ma20 = sma(closes, 20);
    return series.map((k, i) => ({ ...k, ma5: ma5[i], ma20: ma20[i] }));
  }, [klines, range]);

  if (!klines || klines.length < 20) {
    return (
      <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-[11px] text-slate-500 h-48 flex items-center justify-center">
        日K 数据不足（{klines?.length ?? 0} 根）
      </div>
    );
  }

  const n = data.length;
  const last = data[n - 1];
  const chg = n > 1 ? ((last.close - data[n - 2].close) / data[n - 2].close) * 100 : null;

  // 坐标映射
  const step = (W - PAD * 2) / Math.max(1, n - 1);
  const xAt = (i: number) => PAD + i * step;
  let minP = Infinity, maxP = -Infinity, maxV = 0;
  for (const k of data) {
    minP = Math.min(minP, k.low);
    maxP = Math.max(maxP, k.high);
    maxV = Math.max(maxV, k.volume);
  }
  const padP = (maxP - minP) * 0.05 || 1;
  minP -= padP; maxP += padP;
  const yAt = (p: number) => H_CANDLE - ((p - minP) / (maxP - minP)) * (H_CANDLE - 10) - 4;
  const yVol = (v: number) => H_CANDLE + H_VOL - (v / (maxV || 1)) * (H_VOL - 6);

  // MA 折线 path（跳过 null 段）
  const maPath = (key: "ma5" | "ma20") => {
    let d = "";
    let started = false;
    for (let i = 0; i < n; i++) {
      const v = data[i][key] as number | null;
      if (v == null) { started = false; continue; }
      d += `${started ? "L" : "M"}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`;
      started = true;
    }
    return d;
  };

  const bw = Math.max(2, Math.min(8, step * 0.6));

  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-2.5 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold text-slate-200">📈 {name || "日K"} <span className="ml-1 text-[10px] text-slate-500">腾讯前复权</span></span>
        <div className="flex gap-0.5">
          {RANGES.map(r => (
            <button key={String(r.key)} onClick={() => setRange(r.key as never)}
              className={`rounded px-1.5 py-0.5 text-[10px] ${range === r.key ? "bg-amber-500/20 text-amber-300" : "bg-white/5 text-slate-400 hover:bg-white/10"}`}>
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <div className="text-[10px] text-slate-400">
        <b className="text-slate-100">{last.close.toFixed(2)}</b>
        <span className={`ml-1 ${chg != null && chg >= 0 ? "text-rose-300" : "text-emerald-300"}`}>{chg != null ? `${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%` : ""}</span>
        <span className="ml-2">高 {last.high.toFixed(2)} 低 {last.low.toFixed(2)}</span>
        <span className="ml-2 text-slate-600">MA5 <span className="text-amber-400">{(data[n - 1].ma5 ?? 0).toFixed(2)}</span> · MA20 <span className="text-sky-400">{(data[n - 1].ma20 ?? 0).toFixed(2)}</span></span>
      </div>
      <svg viewBox={`0 0 ${W} ${H_CANDLE + H_VOL}`} className="w-full" role="img" aria-label="K线蜡烛图">
        {/* 网格线（3 条横线） */}
        {[0.25, 0.5, 0.75].map(f => (
          <line key={f} x1={PAD} x2={W - PAD} y1={H_CANDLE * f} y2={H_CANDLE * f} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
        ))}
        {/* 蜡烛：影线 + 实体 + 成交量 */}
        {data.map((k, i) => {
          const up = k.close >= k.open;
          const color = up ? "#f43f5e" : "#10b981";
          const cx = xAt(i);
          return (
            <g key={i}>
              <line x1={cx} y1={yAt(k.high)} x2={cx} y2={yAt(k.low)} stroke={color} strokeWidth={1} />
              <rect x={cx - bw / 2} y={Math.min(yAt(k.open), yAt(k.close))} width={bw}
                height={Math.max(1, Math.abs(yAt(k.open) - yAt(k.close)))} fill={color} opacity={0.85} rx={0.5} />
              <rect x={cx - bw / 2} y={yVol(k.volume)} width={bw} height={H_CANDLE + H_VOL - yVol(k.volume)}
                fill={up ? "rgba(244,63,94,0.25)" : "rgba(16,185,129,0.25)"} />
            </g>
          );
        })}
        {/* MA5 / MA20 */}
        <path d={maPath("ma5")} stroke="#f59e0b" strokeWidth={1.2} fill="none" />
        <path d={maPath("ma20")} stroke="#38bdf8" strokeWidth={1.2} fill="none" />
      </svg>
    </div>
  );
}
