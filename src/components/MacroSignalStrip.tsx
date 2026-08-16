// ============================================================
// MacroSignalStrip.tsx —— 统计口径/协会数据条（v9.150.0 P2-4）
// 数据源：GET /api/chain/macro（industry_macro_signal 本地 SQL）
// 展示：PMI/CPI/PPI/工业增加值/固投/海关进出口，真实外部口径，不做装饰性占位。
// ============================================================
import { useEffect, useState } from "react";

interface MacroItem {
  indicator: string;
  indicator_label: string;
  period: string;
  value: number | null;
  unit: string | null;
  yoy: number | null;
  mom: number | null;
  source: string;
  fetched_at: string;
}

const SHORT_LABEL: Record<string, string> = {
  pmi_manufacturing: "制造业PMI",
  pmi_non_manufacturing: "非制造业PMI",
  customs_export: "出口",
  customs_import: "进口",
  industrial_added_value: "工业增加值",
  fixed_asset_investment: "固投",
  cpi_national: "CPI",
  ppi: "PPI",
};

function fmt(v: number | null, suffix = "") {
  return v == null ? "—" : `${v.toFixed(1)}${suffix}`;
}

export default function MacroSignalStrip() {
  const [items, setItems] = useState<MacroItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/chain/macro?limit=36")
      .then((r) => r.json())
      .then((j) => {
        if (alive) {
          setItems(Array.isArray(j.items) ? j.items : []);
          setError(null);
        }
      })
      .catch(() => { if (alive) setError("统计口径同步失败"); })
      .finally(() => { if (alive) setError(null); });
    return () => { alive = false; };
  }, []);

  const periods = [...new Set(items.map((x) => x.period))].slice(0, 4);
  const byPeriod = (p: string) => items.filter((x) => x.period === p);

  return (
    <div className="mb-2 rounded-lg border border-sky-500/20 bg-sky-950/10 p-2">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-black text-sky-200">统计口径 / 协会数据</span>
        <span className="text-[9px] text-slate-500">PMI · CPI · PPI · 工业 · 固投 · 海关（每日刷新）</span>
        {error && <span className="text-[9px] text-amber-400">{error}</span>}
      </div>
      {periods.length === 0 ? (
        <div className="rounded bg-white/5 px-2 py-1 text-[9px] text-slate-500">
          外部统计口径尚未同步，等待每日 07:40 任务或服务重启后自动拉取。
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2 xl:grid-cols-4">
          {periods.map((p) => (
            <div key={p} className="rounded bg-black/20 p-1.5">
              <div className="mb-1 text-[9px] font-bold text-sky-300">{p}</div>
              <div className="space-y-0.5">
                {byPeriod(p).map((x) => (
                  <div key={x.indicator} className="flex items-center justify-between gap-1 text-[9px] text-slate-400">
                    <span className="shrink-0">{SHORT_LABEL[x.indicator] ?? x.indicator_label}</span>
                    <span className="truncate text-slate-300">
                      {fmt(x.value, x.unit ? ` ${x.unit}` : "")}
                      {x.yoy != null && <span className={x.yoy >= 0 ? "text-emerald-300" : "text-rose-300"}> {x.yoy >= 0 ? "+" : ""}{x.yoy.toFixed(1)}%</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
