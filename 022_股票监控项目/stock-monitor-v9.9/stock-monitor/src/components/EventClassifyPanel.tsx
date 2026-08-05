// ============================================================
// v9.38.1（V3-12）：事件三级分类面板 —— 政策/行业/事件三级研判
// 游资逻辑：同一事件 → 判断是"政策级(全市场)/行业级(产业链)/事件级(个股)"，
//   再按催化强度 + 受益板块决定是否值得跟踪（对接 decisionBus 消息面证据源）。
// 数据：kv event_classify:日期（cron 15:40 盘后 LLM 批量分级落库）
// ============================================================
import { useState, useEffect } from "react";
import { isLocalServer, kvGet } from "../lib/cloudStore";
import DisclaimerTag from "./DisclaimerTag";

interface ClassifiedEvent {
  title: string;
  level: "政策" | "行业" | "事件";
  beneficiaries: string[];
  catalystScore: number;
  timeSensitivity: string;
  reason: string;
}

const LEVEL_META: Record<string, { label: string; color: string }> = {
  政策: { label: "🏛 政策级", color: "bg-rose-500/20 text-rose-300 border-rose-500/40" },
  行业: { label: "🏭 行业级", color: "bg-amber-500/20 text-amber-300 border-amber-500/40" },
  事件: { label: "📌 事件级", color: "bg-sky-500/20 text-sky-300 border-sky-500/40" },
};

function ScoreBadge({ s }: { s: number }) {
  const cls = s >= 65 ? "bg-rose-500/25 text-rose-300" : s >= 40 ? "bg-amber-500/25 text-amber-300" : "bg-slate-500/25 text-slate-400";
  return <span className={`rounded px-1 py-0.5 text-[10px] font-bold ${cls}`}>{s}分</span>;
}

export default function EventClassifyPanel() {
  const [items, setItems] = useState<ClassifiedEvent[] | null>(null);
  const [date, setDate] = useState("");

  useEffect(() => {
    if (!isLocalServer()) return;
    let alive = true;
    (async () => {
      try {
        for (let i = 0; i < 3; i++) {
          const d = new Date();
          d.setDate(d.getDate() - i);
          const key = `event_classify:${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          const v = (await kvGet(key)) as { date?: string; items?: ClassifiedEvent[] } | null;
          if (v && Array.isArray(v.items) && v.items.length > 0) {
            if (alive) { setItems(v.items!); setDate(v.date ?? ""); }
            return;
          }
        }
        if (alive) setItems([]);
      } catch { if (alive) setItems([]); }
    })();
    return () => { alive = false; };
  }, []);

  if (items === null || items.length === 0) return null;

  const order = ["政策", "行业", "事件"] as const;
  const grouped = order
    .map(lv => ({ lv, list: items.filter(i => i.level === lv).sort((a, b) => b.catalystScore - a.catalystScore) }))
    .filter(g => g.list.length > 0);

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-200">📡 今日事件三级研判</span>
          {date && <span className="text-[10px] text-slate-500">{date}</span>}
          <span className="text-[10px] text-slate-500">{items.length} 事件</span>
          <DisclaimerTag />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {grouped.map(({ lv, list }) => {
          const meta = LEVEL_META[lv];
          return (
            <div key={lv} className="rounded border border-white/5 bg-black/20 p-2 space-y-1">
              <div className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-bold ${meta.color}`}>
                {meta.label}（{list.length}）
              </div>
              {list.slice(0, 6).map((e, i) => (
                <div key={i} className="text-[10px] leading-snug border-b border-white/5 pb-1 last:border-0">
                  <div className="flex items-start justify-between gap-1">
                    <span className="text-slate-300 flex-1">{e.title.length > 34 ? e.title.slice(0, 34) + "…" : e.title}</span>
                    <ScoreBadge s={e.catalystScore} />
                  </div>
                  {e.beneficiaries && e.beneficiaries.length > 0 && (
                    <div className="text-[9px] text-slate-500 mt-0.5">→ {e.beneficiaries.slice(0, 3).join(" / ")}</div>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <div className="text-[9px] text-slate-600">
        💡 政策级（全市场）&gt; 行业级（产业链）&gt; 事件级（个股）；高分事件可在 Agent 深审中点"事件深挖"看影响传导
      </div>
    </div>
  );
}
