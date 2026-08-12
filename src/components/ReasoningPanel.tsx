// ============================================================
// src/components/ReasoningPanel.tsx —— 认知推理面板（v9.120.0，卓越 S1-1b/S1-1c 前端）
// 把认知层"测量"升到"理解+前瞻"的可视化：共振投票/背离/因果链/变化率/预判情景 + narrative 条。
// 数据源：GET /api/reasoning（纯函数 0 LLM token）；60s 轮询；失败静默不渲染。
// 位置：认知横幅（CognitionBanner）下方，三分区上方（不增面板，提升智能密度）。
// ============================================================
import { useState, useEffect } from "react";

interface ReasoningData {
  coherence?: { status?: string; score?: number; votes?: Array<{ dim: string; bullish: boolean; evidence: string }>; conflicts?: string[] };
  drivers?: { catalyst?: string; chain?: string[]; primaryDriver?: string };
  delta?: { hasPrev?: boolean; trend?: string };
  forecast?: { nextWindow?: string; watch?: string[]; conditions?: Array<{ iff: string; then: string }> };
  narrative?: string;
}

const STATUS_COLOR: Record<string, string> = {
  共振进攻: "text-rose-300 border-rose-500/30 bg-rose-500/10",
  多头占优: "text-amber-300 border-amber-500/30 bg-amber-500/10",
  分歧注意: "text-sky-300 border-sky-500/30 bg-sky-500/10",
  防御混沌: "text-slate-300 border-slate-500/30 bg-slate-500/10",
};

export default function ReasoningPanel() {
  const [data, setData] = useState<ReasoningData | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/reasoning", { signal: AbortSignal.timeout(5000) });
        if (!r.ok) return;
        const j = await r.json();
        if (alive && j?.narrative) setData(j);
      } catch { /* 推理不可用 → 静默 */ }
    };
    load();
    const t = setInterval(load, 60000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (!data) return null;
  const coh = data.coherence ?? {};
  const drv = data.drivers ?? {};
  const dlt = data.delta ?? {};
  const fc = data.forecast ?? {};

  return (
    <section className="mb-3 rounded-xl border border-cyan-500/20 bg-gradient-to-br from-cyan-500/5 to-transparent p-3">
      {/* narrative 条（助手注入同源） */}
      <div className="mb-2 flex flex-wrap items-start gap-2">
        <span className="text-sm font-bold text-cyan-300">🧭 认知推理 · 市场理解</span>
        <span className={`rounded border px-1.5 py-0.5 text-[11px] font-bold ${STATUS_COLOR[coh.status ?? ""] ?? "bg-white/10 text-slate-300"}`}>
          {coh.status ?? "—"}（{coh.score ?? "?"}分）
        </span>
        <span className="flex-1 text-[11px] leading-relaxed text-slate-300">{data.narrative}</span>
      </div>

      <div className="grid gap-2 text-[11px] sm:grid-cols-2 lg:grid-cols-4">
        {/* 共振投票 + 背离 */}
        <div className="rounded-lg border border-white/10 bg-black/20 p-2">
          <div className="mb-1 text-[10px] text-slate-500">跨信号共振（5 维投票）</div>
          <div className="space-y-0.5">
            {(coh.votes ?? []).map((v) => (
              <div key={v.dim} className="flex items-center justify-between">
                <span className="text-slate-400">{v.dim}</span>
                <span className={v.bullish ? "text-emerald-300" : "text-red-300"}>{v.bullish ? "多" : "空"}</span>
                <span className="ml-1 truncate text-slate-500" title={v.evidence}>{v.evidence}</span>
              </div>
            ))}
          </div>
          {(coh.conflicts ?? []).length > 0 && (() => {
            const conflicts = coh.conflicts ?? [];
            return <div className="mt-1 text-amber-300/90">⚠ {conflicts.join("；")}</div>;
          })()}
        </div>

        {/* 因果驱动链 */}
        <div className="rounded-lg border border-white/10 bg-black/20 p-2">
          <div className="mb-1 text-[10px] text-slate-500">因果驱动链</div>
          <div className="text-slate-300">主导：<b className="text-cyan-300">{drv.primaryDriver ?? "—"}</b></div>
          <div className="mt-1 space-y-0.5 text-slate-400">
            {(drv.chain ?? []).map((c, i) => <div key={i}>· {c}</div>)}
          </div>
        </div>

        {/* 变化率 */}
        <div className="rounded-lg border border-white/10 bg-black/20 p-2">
          <div className="mb-1 text-[10px] text-slate-500">环比变化（vs 上一版认知）</div>
          <div className="text-slate-300">{dlt.trend ?? "—"}</div>
          {dlt.hasPrev === false && <div className="mt-1 text-[10px] text-slate-500">（首帧无历史，cron 落库后自动有环比）</div>}
        </div>

        {/* 前瞻预判 */}
        <div className="rounded-lg border border-white/10 bg-black/20 p-2">
          <div className="mb-1 text-[10px] text-slate-500">前瞻预判</div>
          <div className="text-slate-400">{fc.nextWindow ?? "—"}</div>
          {(fc.conditions ?? []).slice(0, 2).map((c, i) => (
            <div key={i} className="mt-1 rounded bg-white/5 p-1 text-slate-300">
              <span className="text-amber-300">若{c.iff}</span> → {c.then}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
