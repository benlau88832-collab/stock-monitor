// ============================================================
// src/components/CognitionBanner.tsx —— 单一 AI 认知层横幅（v9.115.0，S1-4）
// 全站唯一市场理解的可视化：5 维（主线/情绪/资金/风险/龙头）+ version/hash/asOf 溯源。
// 作战卡/决策卡/精灵/复盘/问答均消费同一份 MarketCognition —— 本横幅即"认知层"入口。
// 数据源：GET /api/cognition（cron 落库的权威版本）；30s 轮询；失败静默不渲染。
// 合规：每维 title 带 Provenance caliber（样本量+口径全公开，不承诺胜率）。
// ============================================================
import { useState, useEffect } from "react";

interface CogBannerData {
  version?: number;
  hash?: string;
  asOf?: string;
  mainline?: { value?: { primaryTheme?: string; strength?: number; hotspotRotation?: string }; provenance?: { caliber?: string } };
  sentiment?: { value?: { stage?: string; score?: number; premium?: number | null }; provenance?: { caliber?: string } };
  capital?: { value?: { signal?: string; netFlow?: number }; provenance?: { caliber?: string } };
  risk?: { value?: { level?: string; gateOpen?: boolean; traps?: string[] }; provenance?: { caliber?: string } };
  leader?: { value?: { name?: string; height?: number; relayOk?: boolean }; provenance?: { caliber?: string } };
  [key: string]: unknown; // 兼容服务端返回的其余字段
}

const STAGE_COLOR: Record<string, string> = {
  冰点: "bg-blue-500/20 text-blue-300", 退潮: "bg-green-600/20 text-green-300",
  启动: "bg-yellow-500/20 text-yellow-300", 发酵: "bg-orange-500/20 text-orange-300",
  高潮: "bg-red-500/20 text-red-300", 分歧: "bg-purple-500/20 text-purple-300",
};

export default function CognitionBanner() {
  const [cog, setCog] = useState<CogBannerData | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/cognition", { signal: AbortSignal.timeout(5000) });
        if (!r.ok) return;
        const j = await r.json();
        if (alive && j?.hash) setCog(j);
      } catch { /* 认知不可用 → 静默（不阻塞页面） */ }
    };
    load();
    const t = setInterval(load, 30000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (!cog) return null;

  const m = cog.mainline?.value ?? {};
  const s = cog.sentiment?.value ?? {};
  const cp = cog.capital?.value ?? {};
  const r = cog.risk?.value ?? {};
  const l = cog.leader?.value ?? {};
  const staleMs = cog.asOf ? Date.now() - new Date(cog.asOf).getTime() : Infinity;
  const stale = staleMs > 30 * 60 * 1000;

  return (
    <section className="mb-3 rounded-xl border border-amber-500/20 bg-gradient-to-br from-amber-500/5 to-transparent p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold text-amber-300">🧠 单一 AI 认知层 · 全站唯一市场理解</span>
        <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-200">v{cog.version}</span>
        <span className="text-[10px] text-slate-500">hash {cog.hash} · asOf {cog.asOf?.slice(0, 19)?.replace("T", " ")}</span> {stale && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">认知层已过期</span>}
        <span className="ml-auto hidden text-[10px] text-slate-500 sm:inline">作战/决策/精灵/复盘/问答 均消费此对象 → 杜绝各自为政</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <CogDim label="主线/梯队" title={cog.mainline?.provenance?.caliber}
          value={<span className="text-amber-300">{m.primaryTheme ?? "—"}</span>}
          sub={`强度${m.strength ?? "?"} · ${m.hotspotRotation ?? "?"}`} />
        <CogDim label="情绪周期" title={cog.sentiment?.provenance?.caliber}
          value={<span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${STAGE_COLOR[s.stage ?? ""] ?? "bg-white/10 text-slate-300"}`}>{s.stage ?? "—"}</span>}
          sub={`温度${s.score ?? "?"} · 溢价${s.premium ?? "?"}`} />
        <CogDim label="资金面" title={cog.capital?.provenance?.caliber}
          value={<span className={cp.signal === "出货" ? "text-emerald-400" : cp.signal === "吸筹" ? "text-rose-400" : "text-slate-300"}>{cp.signal ?? "—"}</span>}
          sub={`主力净${cp.netFlow ?? "?"}亿`} />
        <CogDim label="风险闸门" title={cog.risk?.provenance?.caliber}
          value={<span className={r.gateOpen ? "text-emerald-300" : "text-rose-300"}>{r.gateOpen ? "放开" : "关闭"}</span>}
          sub={`风险${r.level ?? "?"} · ${(r.traps ?? []).join("/") || "无触发"}`} />
        <CogDim label="龙头" title={cog.leader?.provenance?.caliber}
          value={<span className="text-slate-100">{l.name ?? "—"}</span>}
          sub={`${l.height ?? 0}板 · 接力${l.relayOk ? "可" : "弱"}`} />
      </div>
    </section>
  );
}

function CogDim({ label, value, sub, title }: { label: string; value: React.ReactNode; sub: string; title?: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-2" title={title}>
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className="text-sm font-semibold text-slate-100">{value}</div>
      <div className="text-[10px] text-slate-400">{sub}</div>
    </div>
  );
}
