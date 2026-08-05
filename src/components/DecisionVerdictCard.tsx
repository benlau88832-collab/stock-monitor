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

  // ===== v9.40（V4-B/C）：AI 与规则的融合裁决（不再静默覆盖） =====
  const aiVerdict = agent && !agent.degraded ? agent : null;
  const ruleVerdict = verdict?.action ?? null;
  const aiRuleDivergent = Boolean(aiVerdict && ruleVerdict && aiVerdict.action !== ruleVerdict);

  // V4-B：门控约束最终结论 —— 因子失效占比高 → AI 说"可上车"强制降档；规则硬否决优先于 AI 乐观
  let gatedDowngrade: string | null = null;
  let mainAction: string | null = aiVerdict?.action ?? ruleVerdict;
  if (aiVerdict && factorStats && factorStats.total >= 3 && factorStats.decayed / factorStats.total >= 0.5 && mainAction === "可上车") {
    mainAction = "观望";
    gatedDowngrade = `🧪 ${factorStats.decayed}/${factorStats.total} 因子疑似失效，AI 判定自动降档（幻方门控）`;
  }
  if (aiVerdict && ruleVerdict === "禁止" && aiVerdict.action === "可上车") {
    mainAction = "禁止";
    gatedDowngrade = gatedDowngrade ?? "⛔ 规则硬否决（系统性风险/诱多/组合风险）优先于 AI 乐观判断";
  }
  const mainConfidence = mainAction === aiVerdict?.action
    ? aiVerdict?.confidence
    : (mainAction === "观望" && gatedDowngrade ? Math.min(aiVerdict?.confidence ?? 50, 60) : verdict?.confidence);

  // V4-I：样本不足提示
  const lowSamples = factorStats == null || factorStats.total < 3 || (verdict?.gatedSignals.length ?? 0) > 0;

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
        gatedDowngrade,
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
  }, [mainAction, mainConfidence, aiVerdict, verdict?.votes, mainline, gatedDowngrade]);

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
          {/* v9.43：AI 结论已计入因子健康度门控（finalize 强制扣置信） */}
          {aiVerdict && /因子健康度/.test(aiVerdict.reason || "") && (
            <span className="rounded bg-cyan-500/20 px-1.5 py-0.5 text-[10px] font-bold text-cyan-300">🧪 因子门控已计入</span>
          )}
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

      {/* V4-C：AI-规则分歧显式告警（不静默覆盖） */}
      {aiRuleDivergent && (
        <div className="mt-1.5 rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[10px] font-bold text-rose-300">
          ⚠ AI 与规则多源分歧：AI={aiVerdict!.action} / 规则={ruleVerdict}，已按{mainAction === ruleVerdict ? "规则" : "AI"}显示，建议人工复核
        </div>
      )}
      {/* V4-B：门控降档标注 */}
      {gatedDowngrade && (
        <div className="mt-1.5 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-300">
          {gatedDowngrade}
        </div>
      )}
      {/* V4-I：样本不足提示 */}
      {lowSamples && (
        <div className="mt-1 text-[9px] text-slate-500">⚠ 历史样本不足（因子/回测数据积累中），AI 结论仅参考，不构成高置信决策</div>
      )}

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
