// ============================================================
// src/components/ProactiveFeed.tsx —— 主动智能流（v9.117.0，S3-3）
// 按交易时段自动输出洞察：规则前置过滤（0 token 为主）+ 时段预算条（LLM 受控）。
// 数据源：GET /api/proactive（?phase=HH:MM 或 ?phaseName=）；P0 决策提示可触达决策卡。
// 接入：驾驶舱「盘前准备」分区（不增面板）。
// ============================================================
import { useState, useEffect } from "react";

const PHASES = ["盘前", "竞价", "早盘", "盘中", "午休", "午后", "尾盘", "盘后"] as const;

const KIND_ICON: Record<string, string> = {
  决策提示: "⚡", 异动解读: "📡", 风险告警: "🚨", 盘前简报: "🌅", 盘后复盘: "📑", 明日剧本: "🔮", 纪律提醒: "📏",
};

interface Insight {
  id: string;
  phase: string;
  priority: "P0" | "P1" | "P2";
  kind: string;
  title: string;
  body: string;
  action?: string;
  llmUsed?: boolean;
  tokenCost?: number;
}

interface FeedData {
  cognitionVersion?: number;
  session?: { phase: string; window: string; decisionWindow?: boolean; note?: string };
  insights: Insight[];
  budget?: { llmBudgetTokens: number; llmUsedTokens: number; remaining: number };
}

export default function ProactiveFeed() {
  const [data, setData] = useState<FeedData | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async (qs = "") => {
    setLoading(true);
    try {
      const r = await fetch(`/api/proactive${qs}`, { signal: AbortSignal.timeout(6000) });
      if (!r.ok) return;
      const j = await r.json();
      if (j?.session) setData(j);
    } catch { /* 静默 */ } finally { setLoading(false); }
  };

  useEffect(() => {
    load();
    const t = setInterval(() => load(), 60000); // 分钟级轮询（时段切换感知）
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const b = data?.budget;
  const isDecisionWindow = data?.session?.decisionWindow === true;

  return (
    <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold text-cyan-300">📡 主动智能流</span>
        {data?.session && (
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${isDecisionWindow ? "bg-rose-500/20 text-rose-300 animate-pulse" : "bg-white/5 text-slate-400"}`}>
            {data.session.window}
          </span>
        )}
        {isDecisionWindow && <span className="text-[10px] font-bold text-rose-300">★ 决策窗口：一键裁决</span>}
        <span className="ml-auto text-[10px] text-slate-500">{loading ? "计算中…" : `认知 v${data?.cognitionVersion ?? "?"}`}</span>
      </div>

      {/* 时段切换 */}
      <div className="mb-2 flex flex-wrap gap-1">
        {PHASES.map((p) => (
          <button key={p} onClick={() => load(`?phaseName=${encodeURIComponent(p)}`)}
            className={`rounded px-2 py-0.5 text-[11px] ${data?.session?.phase === p ? "bg-cyan-500/20 text-cyan-200 ring-1 ring-cyan-400/40" : "bg-white/5 text-slate-400 hover:bg-white/10"}`}>
            {p}
          </button>
        ))}
      </div>

      {/* LLM 预算条 */}
      {b && (
        <div className="mb-2 rounded-lg bg-black/30 p-2">
          <div className="flex items-center justify-between text-[10px] text-slate-400">
            <span>LLM token 预算控制</span>
            <span>{b.llmUsedTokens} / {b.llmBudgetTokens} · 剩余 {b.remaining}</span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-white/10">
            <div className="h-full bg-fuchsia-400" style={{ width: `${Math.min(100, (b.llmUsedTokens / Math.max(1, b.llmBudgetTokens)) * 100)}%` }} />
          </div>
        </div>
      )}

      {/* 洞察列表 */}
      <div className="space-y-1.5">
        {data?.insights.length === 0 && <div className="text-[11px] text-slate-500">该时段无主动洞察。</div>}
        {data?.insights.map((it) => (
          <div key={it.id} className={`rounded border p-2 text-[11px] ${
            it.priority === "P0" ? "border-red-500/30 bg-red-500/5" : it.priority === "P1" ? "border-amber-500/20 bg-amber-500/5" : "border-white/10 bg-white/5"
          }`}>
            <div className="flex items-center gap-1.5">
              <span>{KIND_ICON[it.kind] ?? "•"}</span>
              <b className="text-slate-100">{it.title}</b>
              <span className="ml-auto text-[9px] text-slate-500">{it.priority}</span>
            </div>
            <div className="mt-0.5 text-slate-400">{it.body}</div>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {it.action && <span className="rounded bg-white/10 px-1 text-[9px] text-slate-300">→ {it.action}</span>}
              {it.llmUsed
                ? <span className="rounded bg-amber-500/15 px-1 text-[9px] text-amber-300">LLM · {it.tokenCost} tok</span>
                : <span className="rounded bg-emerald-500/15 px-1 text-[9px] text-emerald-300">纯规则 · 0 tok</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
