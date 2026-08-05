// ============================================================
// v9.37（V3-7）：AI 终裁决卡 —— "替代决策"的用户可见终点
// v9.39（改造1）：AI 主导反转 —— 若 Agent 裁决可用，AI 结论置顶大号显示，
//   规则投票折叠为"证据链/反对意见"佐证区（不再并列抢眼球）
// 数据：decisionBus.runConsensus（规则多源）+ aiAgent（LLM 工具调研裁决）
// ============================================================
import { useMemo, useEffect, useState } from "react";
import { runConsensus, type EvidenceSource, type DecisionVerdict } from "../lib/decisionBus";
import { gateWeight } from "../lib/decisionBus";
import type { AgentVerdict } from "../lib/aiAgent";
import DisclaimerTag from "./DisclaimerTag";

interface Props {
  /** 今日最强主线（用于展示主体） */
  mainline?: string;
  /** 多源证据（由调用方从各引擎汇聚） */
  sources?: EvidenceSource[];
  /** 信号回测门控（可选，命中后降权） */
  signalGates?: Array<{ name: string; winRate: number | null; samples: number | null }>;
  /** v9.39：因子健康度（factorLib IC 评估：失效因子占比高 → 置信下调） */
  factorStats?: { decayed: number; total: number };
  /** v9.39：Agent 裁决（LLM 工具调研结果，有则置顶为主结论） */
  agent?: AgentVerdict | null;
}

export default function DecisionVerdictCard({ mainline = "—", sources = [], signalGates = [], factorStats, agent = null }: Props) {
  const [showEvidence, setShowEvidence] = useState(false);
  const verdict: DecisionVerdict | null = useMemo(() => {
    if (sources.length === 0) return null;
    return runConsensus(sources, { signalGates, factorStats });
  }, [sources, signalGates, factorStats]);

  // AI 主导：Agent 裁决优先作为主结论（degraded=true 表示 LLM 不可用，退规则）
  const aiVerdict = agent && !agent.degraded ? agent : null;
  const mainAction = aiVerdict?.action ?? verdict?.action;
  const mainConfidence = aiVerdict?.confidence ?? verdict?.confidence;

  useEffect(() => {
    if (!mainAction || !mainConfidence) return;
    // v9.37（V3-P2）：决策日志落库（可审计/可复盘）
    try {
      const log = {
        ts: new Date().toISOString(),
        mainline,
        action: mainAction,
        confidence: mainConfidence,
        source: aiVerdict ? "AI-Agent" : "规则投票",
        votes: verdict?.votes,
        dissent: verdict?.dissent,
        agentReason: aiVerdict?.reason,
        agentCritic: aiVerdict?.critic,
      };
      const key = `decision_log:${new Date().toISOString().slice(0, 10)}`;
      const arr = JSON.parse(localStorage.getItem(key) ?? "[]");
      arr.push(log);
      localStorage.setItem(key, JSON.stringify(arr.slice(-50))); // 每日最多留 50 条
    } catch { /* 日志失败不影响功能 */ }
  }, [mainAction, mainConfidence, aiVerdict, verdict?.votes, mainline]);

  if (!verdict && !aiVerdict) return null;

  const actionColor =
    mainAction === "可上车" ? "bg-emerald-500/25 text-emerald-300 border-emerald-500/40"
    : mainAction === "观望" ? "bg-amber-500/25 text-amber-300 border-amber-500/40"
    : "bg-rose-500/25 text-rose-300 border-rose-500/40";

  return (
    <div className={`rounded-xl border p-3 ${aiVerdict ? "border-amber-500/40 bg-amber-950/20" : "border-violet-500/30 bg-violet-950/15"}`}>
      {/* ===== AI 主导结论（置顶大号） ===== */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-200">
            {aiVerdict ? "🤖 AI 决策（自动主导）" : "🧠 AI 终裁决（规则投票）"}
          </span>
          {aiVerdict && <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">LLM 工具调研</span>}
          <DisclaimerTag />
        </div>
        <span className="max-w-[160px] truncate text-[10px] text-slate-500" title={mainline}>{mainline}</span>
      </div>

      <div className="mt-1.5 flex items-center gap-2">
        <span className={`rounded-lg border px-2.5 py-1 text-base font-black ${actionColor}`}>
          {mainAction === "可上车" ? "参考关注（可上车）" : mainAction === "观望" ? "观望" : "禁止参与"}
        </span>
        <span className="text-[11px] text-slate-400">置信 <b className="text-slate-200">{mainConfidence}%</b></span>
        {factorStats && factorStats.total >= 3 && factorStats.decayed >= Math.ceil(factorStats.total * 0.3) && (
          <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-bold text-rose-300" title="滚动IC<0.05的因子占比高，已自动下调置信">
            🧪 {factorStats.decayed}/{factorStats.total} 因子失效
          </span>
        )}
      </div>

      {/* AI 推理链（置顶理由） */}
      {aiVerdict ? (
        <div className="mt-1.5 space-y-1">
          <div className="text-[12px] leading-snug text-amber-200/90">💬 {aiVerdict.reason || "（AI 未给出理由）"}</div>
          {aiVerdict.critic && (
            <div className="rounded border border-rose-500/20 bg-rose-500/5 px-2 py-1 text-[10px] text-rose-300/80">
              {aiVerdict.critic}
            </div>
          )}
          <div className="text-[9px] text-slate-600">证据包：{aiVerdict.evidence?.length ?? 0} 项工具结果{agent?.selfConsistency ? ` · 自洽一致 ${agent.selfConsistency}%` : ""}</div>
        </div>
      ) : agent?.degraded ? (
        <div className="mt-1 text-[10px] text-slate-500">⚠ LLM 不可用，规则投票兜底{agent.reason ? `：${agent.reason}` : ""}</div>
      ) : (
        <div className="mt-1 text-[10px] text-slate-500">Agent 调研中（5 分钟自动刷新）…</div>
      )}

      {/* 规则投票（折叠为证据，不再并列抢眼球） */}
      {verdict && (
        <details className="mt-1.5" open={showEvidence}>
          <summary className="cursor-pointer text-[10px] text-slate-500 hover:text-slate-400" onClick={() => setShowEvidence(v => !v)}>
            📊 规则多源投票（{verdict.votes.length} 源 · 点击展开）
          </summary>
          <div className="mt-1 space-y-1">
            {verdict.votes.map(v => (
              <div key={v.name} className="flex items-center gap-2 text-[10px]">
                <span className="w-16 shrink-0 text-slate-400">{v.name}</span>
                <span className={`rounded px-1.5 py-0.5 font-bold ${
                  v.verdict === "可上车" ? "bg-emerald-500/15 text-emerald-300"
                  : v.verdict === "观望" ? "bg-amber-500/15 text-amber-300"
                  : "bg-rose-500/15 text-rose-300"
                }`}>{v.verdict}</span>
                <span className="text-slate-600">权重{v.weight.toFixed(1)}</span>
              </div>
            ))}
            {/* 反对意见 */}
            {verdict.dissent.length > 0 && (
              <div className="rounded border border-rose-500/20 bg-rose-500/5 px-2 py-1 text-[10px] text-rose-300/80">
                ⚠ 反对意见：{verdict.dissent.join("；")}
              </div>
            )}
            {/* 被门控信号 */}
            {verdict.gatedSignals.length > 0 && (
              <div className="text-[9px] text-slate-500">🚪 回测门控：{verdict.gatedSignals.join("；")}</div>
            )}
            {/* 证据链（可审计） */}
            <details>
              <summary className="cursor-pointer text-[10px] text-slate-500 hover:text-slate-400">📋 证据链（点击展开）</summary>
              <div className="mt-0.5 space-y-0.5">
                {verdict.evidence.map((e, i) => (
                  <div key={i} className="text-[10px] text-slate-400">• {e}</div>
                ))}
              </div>
            </details>
          </div>
        </details>
      )}
    </div>
  );
}

// 便捷：从 gateWeight 导出（组件外部也可能用）
export { gateWeight };
