// ============================================================
// v9.36（A3）：龙虎榜 × 涨停池交叉 —— 席位加持识别
// 游资逻辑：涨停 + 龙虎榜净买入 = 资金真金白银确认，次日溢价增强信号。
// 数据：kv lhb:日期（cron 15:40 落库）+ overview 涨停池
// ============================================================
import { useState, useEffect } from "react";
import { fmtMoney } from "../lib/format";
import { stockRealUrl } from "../lib/realLinks";
import { isLocalServer } from "../lib/cloudStore";
import type { OverviewData } from "../App";

interface LhbItem {
  code: string; name: string; pct: number;
  buyAmt: number; sellAmt: number; netBuy: number; explain: string;
}

export default function LhbCrossPanel({ overview }: { overview?: OverviewData | null }) {
  const [lhb, setLhb] = useState<LhbItem[] | null>(null);

  useEffect(() => {
    if (!isLocalServer()) return;
    let alive = true;
    (async () => {
      try {
        for (let i = 0; i < 3; i++) {
          const d = new Date();
          d.setDate(d.getDate() - i);
          const key = `lhb:${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          const r = await fetch(`/api/db/kv?key=${encodeURIComponent(key)}`);
          if (!r.ok) continue;
          const v = await r.json();
          if (Array.isArray(v?.value?.items) && v.value.items.length > 0) { if (alive) setLhb(v.value.items); return; }
        }
        if (alive) setLhb([]);
      } catch { if (alive) setLhb([]); }
    })();
    return () => { alive = false; };
  }, []);

  if (lhb === null || lhb.length === 0) return null;

  // 涨停池代码集合
  const ztCodes = new Set<string>(
    (overview?.limitPool?.rawZTPool ?? []).map((s: any) => String(s.c || "").replace(/^[A-Z]{2}/, "")),
  );
  // 交叉：上龙虎榜 + 今日涨停
  const crossed = lhb
    .filter(x => ztCodes.has(x.code))
    .sort((a, b) => b.netBuy - a.netBuy)
    .slice(0, 15);

  if (crossed.length === 0) return null;

  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-950/10 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-amber-200">
          🐉 龙虎榜 × 涨停交叉 <span className="text-[10px] text-slate-500 font-normal">席位加持 · 次日溢价增强信号</span>
        </span>
        <span className="text-[10px] text-slate-500">{crossed.length}只</span>
      </div>
      <div className="space-y-1">
        {crossed.map((it) => (
          <a key={it.code} href={stockRealUrl(it.code)} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 rounded bg-black/20 border border-white/5 px-2 py-1 text-[11px] hover:bg-white/10 transition">
            <span className="w-16 shrink-0 truncate font-semibold text-slate-100">{it.name}</span>
            <span className={`shrink-0 font-mono font-bold ${it.netBuy >= 0 ? "text-rose-300" : "text-emerald-300"}`}>
              {it.netBuy >= 0 ? "+" : ""}{fmtMoney(it.netBuy)}
            </span>
            <span className="shrink-0 text-[9px] text-slate-500">{it.pct.toFixed(1)}%</span>
            <span className="ml-auto shrink-0 truncate max-w-[200px] text-[10px] text-slate-500" title={it.explain}>
              {it.explain || ""}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
