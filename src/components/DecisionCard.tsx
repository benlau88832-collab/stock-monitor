// ============================================================
// src/components/DecisionCard.tsx —— 决策直达 · 一键裁决（v9.116.0，S2-2/S2-3）
// v9.113.0（T4-2）三支柱（准入/仓位/离场）升级为五支柱（+风控/诱多）：
//   composeDecision（src/lib/decisions/kernel.ts）—— 纯函数直调，不经过 LLM，秒级、永不降级。
// S2-3 决策窗口（9:25/13:00）：resolveDecisionWindow 内联判定 → 顶部 P0 高亮 + 候选龙头自动亮。
// 数据源：认知层 /api/cognition（全站唯一理解）+ PG 快照 + 个股实时。
// 合规：裁决带 sampleSize + caliber + 免责声明，不承诺胜率。
// ============================================================
import { useState, useEffect } from "react";
import { composeDecision, type DecisionVerdict } from "../lib/decisions/kernel";

/** v9.116.0（S2-3）：决策窗口判定（9:25 / 13:00）—— 与 v9.117.0 S3-1 resolveSession 同语义的轻量版（导出供单测） */
export function resolveDecisionWindow(now = new Date()): boolean {
  const bj = new Date(now.getTime() + (now.getTimezoneOffset() + 8 * 60) * 60000);
  const h = bj.getHours(), m = bj.getMinutes();
  return (h === 9 && m >= 20 && m <= 30) || (h === 13 && m <= 5);
}

export default function DecisionCard() {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DecisionVerdict | null>(null);
  const [err, setErr] = useState("");
  const [leader, setLeader] = useState<{ name?: string; code?: string } | null>(null);
  const [decisionWindow, setDecisionWindow] = useState(() => resolveDecisionWindow());

  // 认知层龙头候选（S2-3：决策窗口自动亮候选）+ 决策窗口轮询
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/cognition", { signal: AbortSignal.timeout(5000) });
        if (!r.ok) return;
        const j = await r.json();
        if (alive && j?.leader?.value?.name) setLeader(j.leader.value);
      } catch { /* 静默 */ }
    };
    load();
    const t = setInterval(() => { if (alive) setDecisionWindow(resolveDecisionWindow()); }, 30000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const run = async (codeArg?: string) => {
    const target = codeArg ?? input;
    const code = (target.match(/\d{6}/) ?? [])[0] ?? "";
    const mainline = code ? undefined : target.trim() || undefined;
    if (!code && !mainline) { setErr("请输入标的代码（6位）或主线名"); return; }
    setBusy(true); setErr("");
    try {
      const r = await composeDecision({ code: code || undefined, mainline });
      setResult(r);
    } catch (e) {
      setErr("决策失败：" + String(e));
    } finally { setBusy(false); }
  };

  const verdictColor = result?.decision === "可上车" ? "text-rose-300" : result?.decision === "观望" ? "text-amber-300" : "text-emerald-300";
  const pillars: Array<[string, keyof DecisionVerdict["pillars"]]> = [["准入", "admission"], ["仓位", "position"], ["离场", "exit"], ["风控", "risk"], ["诱多", "trap"]];

  return (
    <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-violet-300">🎯 决策直达 · 一键裁决</span>
        {/* v9.116.0（S2-3）：决策窗口（9:25/13:00）P0 高亮 */}
        {decisionWindow && (
          <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-bold text-rose-300 animate-pulse">
            ★ 决策窗口 {new Date().getHours() === 9 ? "09:25" : "13:00"}：一键裁决
          </span>
        )}
        <span className="text-[10px] text-slate-500">五支柱纯函数 · 不依赖 LLM · 永不降级</span>
      </div>

      {/* S2-3：候选龙头自动亮（决策窗口时高亮） */}
      {leader?.name && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-slate-500">候选（认知层龙头）：</span>
          <button
            onClick={() => run(leader.code)}
            className={`rounded px-2 py-0.5 text-[11px] ${decisionWindow ? "bg-rose-500/20 text-rose-200 ring-1 ring-rose-400/40" : "bg-white/5 text-slate-300 hover:bg-white/10"}`}
          >
            ⚡ {leader.name}（{leader.code}）
          </button>
        </div>
      )}

      <div className="mt-2 flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") run(); }}
          placeholder="输入代码（如 600519）或主线名（如 医药）"
          className="flex-1 rounded bg-black/30 px-2 py-1 text-xs text-slate-200 outline-none border border-white/10 focus:border-violet-500/40"
        />
        <button
          onClick={() => run()}
          disabled={busy}
          className="rounded bg-violet-500/30 px-3 py-1 text-xs font-bold text-violet-200 hover:bg-violet-500/40 disabled:opacity-50"
        >{busy ? "计算中…" : "⚡ 秒级裁决"}</button>
      </div>
      {err && <div className="mt-2 text-[11px] text-rose-300">{err}</div>}

      {result && (
        <div className="mt-2 space-y-2 text-[11px]">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded bg-black/20 p-2">
              <div className="text-slate-500">裁决</div>
              <div className={`text-sm font-black ${verdictColor}`}>{result.decision}（综合 {result.score}）</div>
            </div>
            <div className="rounded bg-black/20 p-2">
              <div className="text-slate-500">建议仓位</div>
              <div className="text-sm font-black text-slate-200">{result.suggestedPositionPct != null ? `${result.suggestedPositionPct}%` : "—"}
                {result.stopLossPct != null && <span className="ml-1 text-[10px] text-slate-400">止损 {result.stopLossPct}%</span>}
                {result.targetPct != null && <span className="ml-1 text-[10px] text-slate-400">止盈 +{result.targetPct}%</span>}
              </div>
            </div>
          </div>

          {/* 五支柱 */}
          <div className="grid grid-cols-5 gap-1.5">
            {pillars.map(([label, key]) => {
              const p = result.pillars[key];
              return (
                <div key={key} className={`rounded p-1.5 text-center ${p.pass ? "bg-emerald-500/10" : "bg-red-500/10"}`} title={p.detail}>
                  <div className="text-[9px] text-slate-400">{label}</div>
                  <div className={`text-xs font-bold ${p.pass ? "text-emerald-300" : "text-red-300"}`}>{p.score}</div>
                </div>
              );
            })}
          </div>

          {result.reasons.length > 0 && <div className="text-emerald-300/80">✓ {result.reasons.join("；")}</div>}
          {result.blocks.length > 0 && <div className="text-red-300/80">✗ {result.blocks.join("；")}</div>}

          {/* v9.121.0（卓越 S2-1b）：游资战术行（接力分/情绪买卖点/买点/卖点纪律/梯队位置） */}
          {result.tactics && (
            <div className="rounded bg-black/20 p-2">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">🎯 游资战术</span>
                <span className={`text-[11px] font-bold ${result.tactics.relayScore >= 70 ? "text-emerald-300" : result.tactics.relayScore >= 50 ? "text-amber-300" : "text-red-300"}`}>
                  接力分 {result.tactics.relayScore}
                </span>
              </div>
              <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-slate-300">
                <div>情绪买卖点：<b className="text-amber-300">{result.tactics.stageAction}</b></div>
                <div>买点：<b className="text-cyan-300">{result.tactics.buyPoint}</b></div>
                <div>卖点纪律：<span className="text-slate-400">{result.tactics.sellDiscipline}</span></div>
                <div>梯队位置：<b className={result.tactics.ladderPos === "tier1龙头" ? "text-rose-300" : result.tactics.ladderPos === "tier2跟风" ? "text-amber-300" : "text-slate-400"}>{result.tactics.ladderPos}</b></div>
              </div>
            </div>
          )}

          <div className="rounded bg-black/20 p-2">
            <div className="text-slate-500">证据链</div>
            <div className="mt-0.5 text-slate-300">
              {result.evidence.caliber}
              <span className="ml-1 text-[10px] text-slate-500">· 耗时 {result.latencyMs}ms · 离线纯函数</span>
            </div>
          </div>
          <p className="text-[10px] leading-relaxed text-slate-500">{result.disclaimer}</p>
        </div>
      )}
    </div>
  );
}
