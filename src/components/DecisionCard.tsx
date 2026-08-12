// ============================================================
// src/components/DecisionCard.tsx —— 决策直达卡（v9.113.0，T4-2）
// 终审 D-05：把被锁在 AI 对话里的决策内核（准入/仓位/离场）释放为秒级 UI。
// 输入标的代码/主线名 → decisionDirect（纯函数直调，不经过 LLM）→ 秒级决策卡。
// ============================================================
import { useState } from "react";
import { decisionDirect, type DecisionResult } from "../lib/decisionDirect";

export default function DecisionCard() {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DecisionResult | null>(null);
  const [err, setErr] = useState("");

  const run = async () => {
    const code = (input.match(/\d{6}/) ?? [])[0] ?? "";
    const mainline = code ? undefined : input.trim() || undefined;
    if (!code && !mainline) { setErr("请输入标的代码（6位）或主线名"); return; }
    setBusy(true); setErr("");
    try {
      const t0 = Date.now();
      const r = await decisionDirect({ code: code || undefined, mainline });
      setResult(r);
      if (Date.now() - t0 < 100) console.log(`[DecisionCard] 决策耗时 ${Date.now() - t0}ms（纯函数直调）`);
    } catch (e) {
      setErr("决策失败：" + String(e));
    } finally { setBusy(false); }
  };

  const verdictColor = result?.verdict === "可上车" ? "text-rose-300" : result?.verdict === "观望" ? "text-amber-300" : "text-emerald-300";

  return (
    <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-violet-300">🎯 决策直达（秒级 · 不依赖 AI）</span>
        <span className="text-[10px] text-slate-500">准入/仓位/止损/离场 纯函数直调</span>
      </div>
      <div className="mt-2 flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") run(); }}
          placeholder="输入代码（如 600519）或主线名（如 医药）"
          className="flex-1 rounded bg-black/30 px-2 py-1 text-xs text-slate-200 outline-none border border-white/10 focus:border-violet-500/40"
        />
        <button
          onClick={run}
          disabled={busy}
          className="rounded bg-violet-500/30 px-3 py-1 text-xs font-bold text-violet-200 hover:bg-violet-500/40 disabled:opacity-50"
        >{busy ? "计算中…" : "🎯 决策"}</button>
      </div>
      {err && <div className="mt-2 text-[11px] text-rose-300">{err}</div>}
      {result && (
        <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
          <div className="rounded bg-black/20 p-2">
            <div className="text-slate-500">裁决</div>
            <div className={`text-sm font-black ${verdictColor}`}>{result.verdict}（置信{result.confidence}%）</div>
          </div>
          <div className="rounded bg-black/20 p-2">
            <div className="text-slate-500">建议仓位</div>
            <div className="text-sm font-black text-slate-200">{result.positionPct != null ? `${result.positionPct}%` : "—"}
              {result.stopLoss != null && <span className="ml-1 text-[10px] text-slate-400">止损 {result.stopLoss}%</span>}
            </div>
          </div>
          <div className="rounded bg-black/20 p-2 col-span-2">
            <div className="text-slate-500">证据链（PG 快照）</div>
            <div className="mt-0.5 text-slate-300">
              主线 {result.evidence.mainline} · 强度 {result.evidence.strength ?? "?"}
              {result.evidence.gateLabel && <span> · 闸门 {result.evidence.gateLabel}</span>}
              {result.evidence.source === "pg" && <span className="ml-1 text-cyan-300/80">（PG {new Date(result.evidence.asOf).toLocaleTimeString()}）</span>}
            </div>
            {result.risks.length > 0 && (
              <div className="mt-1 text-amber-300/80">⚠ {result.risks.join("；").slice(0, 120)}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
