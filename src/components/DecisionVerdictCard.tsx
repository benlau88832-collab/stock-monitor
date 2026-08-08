// ============================================================
// v9.37（V3-7）：AI 终裁决卡 —— "替代决策"的用户可见终点
// v9.39（改造1）：AI 主导反转 —— 若 Agent 裁决可用，AI 结论置顶大号显示，
//   规则投票折叠为"证据链/反对意见"佐证区（不再并列抢眼球）
// 数据：decisionBus.runConsensus（规则多源）+ aiAgent（LLM 工具调研裁决）
// ============================================================
import { useMemo, useEffect, useRef, useState } from "react";
import { runConsensus, type EvidenceSource, type DecisionVerdict } from "../lib/decisionBus";
import { gateWeight } from "../lib/decisionBus";
import type { AgentVerdict } from "../lib/aiAgent";
import DisclaimerTag from "./DisclaimerTag";
import PostButtons from "./PostButtons";
// P1-1：用户画像摘要（AI 看到"你是谁"）
import { loadUserProfile, profileToPrompt } from "../lib/userProfile";
// P1-2：决策改判解释（AI 为何从 X 改判为 Y）
import { diffLastDecision, diffToText } from "../lib/decisionDiff";

interface Props {
  /** 今日最强主线（用于展示主体） */
  mainline?: string;
  /** 多源证据（由调用方从各引擎汇聚） */
  sources?: EvidenceSource[];
  /** 信号回测门控（可选，命中后降权） */
  signalGates?: Array<{ name: string; winRate: number | null; samples: number | null }>;
  /** v9.39：因子健康度（factorLib IC 评估：失效因子占比高 → 置信下调）；samples<30 时不扣（V8-3） */
  factorStats?: { decayed: number; total: number; samples?: number | null };
  /** v9.39：Agent 裁决（LLM 工具调研结果，有则置顶为主结论） */
  agent?: AgentVerdict | null;
  /** v11-3（P0）：上次裁决 action（裁决变化时显示"与上次不同"，让用户知道变化是数据驱动的） */
  prevAction?: string | null;
}

export default function DecisionVerdictCard({ mainline = "—", sources = [], signalGates = [], factorStats, agent = null, prevAction = null }: Props) {
  const [showEvidence, setShowEvidence] = useState(false);
  // P0-1：记录最后一次 decision_log 的 ts（供 PostButtons 幂等用）
  const aiLogTsRef = useRef<string | null>(null);
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
    // v9.45（V5-2）：追加 Agent 路径埋点（path/rounds/toolsCalled/rateLimited）
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
        path: agent?.path,
        rounds: agent?.rounds,
        toolsCalled: agent?.toolsCalled,
        rateLimited: agent?.rateLimited,
      };
      const key = `decision_log:${new Date().toISOString().slice(0, 10)}`;
      const arr = JSON.parse(localStorage.getItem(key) ?? "[]");
      arr.push(log);
      localStorage.setItem(key, JSON.stringify(arr.slice(-50))); // 每日最多留 50 条
      // P0-1：把本轮裁决的 ts 暴露给 PostButtons（同次 AI 裁决只能拍一次板）
      aiLogTsRef.current = log.ts;
    } catch { /* 日志失败不影响功能 */ }
  }, [mainAction, mainConfidence, aiVerdict, verdict?.votes, mainline, gatedDowngrade, agent?.path, agent?.rounds, agent?.rateLimited]);

  if (!verdict && !aiVerdict) return null;

  const actionColor =
    mainAction === "可上车" ? "bg-emerald-500/25 text-emerald-300 border-emerald-500/40"
    : mainAction === "观望" ? "bg-amber-500/25 text-amber-300 border-amber-500/40"
    : "bg-rose-500/25 text-rose-300 border-rose-500/40";

  return (
    <div className={`rounded-xl border p-3 ${aiVerdict ? "border-amber-500/40 bg-amber-950/20" : "border-violet-500/30 bg-violet-950/15"}`}>
      {/* v9.45（V5-1）：配额受限显式标注 —— 用户能一眼看出"这次不是 AI 主导" */}
      {agent?.rateLimited && (
        <div className="mb-2 rounded border border-rose-500/40 bg-rose-500/15 px-2 py-1.5 text-[11px] font-bold text-rose-200">
          ⏸ AI 配额受限（服务端限速 30/min），本次为规则兜底，非 AI 主导
        </div>
      )}
      {/* ===== AI 主导结论（置顶大号） ===== */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-200">
            {aiVerdict ? "🤖 AI 决策（自动主导）" : agent?.rateLimited ? "🧠 规则决策（AI 配额受限）" : "🧠 AI 终裁决（规则投票）"}
          </span>
          {aiVerdict && <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-xs font-bold text-amber-300">LLM 工具调研</span>}
          {/* v9.45（V5-2）：Agent 路径徽标 —— 原生 tool_calls / JSON 协议 */}
          {aiVerdict?.path === "native_toolcall" && <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-xs font-bold text-emerald-300">⚙ 原生 tool_calls</span>}
          {aiVerdict?.path === "manual_json" && <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-xs font-bold text-sky-300">🧩 JSON 协议</span>}
          {/* v9.43：AI 结论已计入因子健康度门控（finalize 强制扣置信） */}
          {aiVerdict && /因子健康度/.test(aiVerdict.reason || "") && (
            <span className="rounded bg-cyan-500/20 px-1.5 py-0.5 text-xs font-bold text-cyan-300">🧪 因子门控已计入</span>
          )}
          <DisclaimerTag />
        </div>
        <span className="max-w-[160px] truncate text-xs text-slate-500" title={mainline}>{mainline}</span>
      </div>

      <div className="mt-1.5 flex items-center gap-2">
        {/* V10-1：裁决 text-base → text-4xl font-black（整屏最大最亮，游资 3 秒看到结论） */}
        <span className={`rounded-xl border-2 px-4 py-2 text-4xl font-black ${actionColor}`}>
          {mainAction === "可上车" ? "✅ 可上车" : mainAction === "观望" ? "⏸ 观望" : "🚫 禁止"}
        </span>
        {/* V10-1：置信 text-[11px] → text-xl font-bold */}
        <span className="text-xl font-bold text-slate-200">置信 <b className="text-slate-100">{mainConfidence}%</b></span>
        {factorStats && factorStats.total >= 3 && factorStats.decayed >= Math.ceil(factorStats.total * 0.3) && (
          <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-xs font-bold text-rose-300" title="滚动IC<0.05的因子占比高，已自动下调置信">
            🧪 {factorStats.decayed}/{factorStats.total} 因子失效
          </span>
        )}
      </div>

      {/* v11-3（P0）+ P1-2：与上次裁决不同 → 显式解释（数据驱动 + 证据差异） */}
      {prevAction && mainAction && prevAction !== mainAction && (
        <div className="mt-1.5 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs font-bold text-amber-300">
          ⚠ 与上次裁决不同（上次={prevAction}）—— 数据变化导致，非随机
        </div>
      )}
      {/* P1-2：决策改判深度解释（基于 decisionDiff 提取证据差异） */}
      {aiVerdict && (() => {
        const diff = diffLastDecision({
          action: aiVerdict.action,
          confidence: aiVerdict.confidence,
          reason: aiVerdict.reason ?? "",
          mainline,
        });
        if (!diff.changed) return null;
        return (
          <div className="mt-1.5 rounded border border-cyan-500/25 bg-cyan-500/5 px-2 py-1 text-[11px] text-cyan-200/80">
            🔬 {diffToText(diff)}
          </div>
        );
      })()}

      {/* V4-C：AI-规则分歧显式告警（不静默覆盖） */}
      {aiRuleDivergent && (
        <div className="mt-1.5 rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-xs font-bold text-rose-300">
          ⚠ AI 与规则多源分歧：AI={aiVerdict!.action} / 规则={ruleVerdict}，已按{mainAction === ruleVerdict ? "规则" : "AI"}显示，建议人工复核
        </div>
      )}
      {/* V4-B：门控降档标注 */}
      {gatedDowngrade && (
        <div className="mt-1.5 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-300">
          {gatedDowngrade}
        </div>
      )}
      {/* V4-I：样本不足提示 */}
      {lowSamples && (
        <div className="mt-1 text-xs text-slate-500">⚠ 历史样本不足（因子/回测数据积累中），AI 结论仅参考，不构成高置信决策</div>
      )}

      {/* AI 推理链（置顶理由） */}
      {aiVerdict ? (
        <div className="mt-2 space-y-1">
          {/* V10-1：AI 理由 text-[12px] → text-base leading-relaxed */}
          <div className="text-base leading-relaxed text-amber-200/90">💬 {aiVerdict.reason || "（AI 未给出理由）"}</div>
          {/* v11-6（P1）：裁决基于部分推断数据 → 透明告知 */}
          {aiVerdict.reason && /基于部分(数据|推断)|推断[（(]/.test(aiVerdict.reason) && (
            <div className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs font-bold text-amber-300">
              ⚠ 基于部分推断数据（换手率/晋级率等为推断值，非真实落库），仅供参考
            </div>
          )}
          {aiVerdict.critic && (
            <div className="rounded border border-rose-500/20 bg-rose-500/5 px-2 py-1 text-xs text-rose-300/80">
              {aiVerdict.critic}
            </div>
          )}
          <div className="text-xs text-slate-600">证据包：{aiVerdict.evidence?.length ?? 0} 项工具结果{agent?.rounds ? ` · ${agent.rounds} 轮 ReAct` : ""}{agent?.toolsCalled?.length ? ` · 调 ${agent.toolsCalled.length} 工具` : ""}{agent?.selfConsistency ? ` · 自洽一致 ${agent.selfConsistency}%` : ""}</div>
        </div>
      ) : agent?.degraded ? (
        <div className="mt-1 text-xs text-slate-500">⚠ LLM 不可用，规则投票兜底{agent.reason ? `：${agent.reason}` : ""}</div>
      ) : (
        <div className="mt-1 text-xs text-slate-500">Agent 调研中（5 分钟自动刷新）…</div>
      )}

      {/* 规则投票（折叠为证据，不再并列抢眼球） */}
      {verdict && (
        <details className="mt-1.5" open={showEvidence}>
          <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-400" onClick={() => setShowEvidence(v => !v)}>
            📊 规则多源投票（{verdict.votes.length} 源 · 点击展开）
          </summary>
          <div className="mt-1 space-y-1">
            {verdict.votes.map(v => (
              <div key={v.name} className="flex items-center gap-2 text-xs">
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
              <div className="rounded border border-rose-500/20 bg-rose-500/5 px-2 py-1 text-xs text-rose-300/80">
                ⚠ 反对意见：{verdict.dissent.join("；")}
              </div>
            )}
            {/* 被门控信号 */}
            {verdict.gatedSignals.length > 0 && (
              <div className="text-xs text-slate-500">🚪 回测门控：{verdict.gatedSignals.join("；")}</div>
            )}
            {/* 证据链（可审计） */}
            <details>
              <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-400">📋 证据链（点击展开）</summary>
              <div className="mt-0.5 space-y-0.5">
                {verdict.evidence.map((e, i) => (
                  <div key={i} className="text-xs text-slate-400">• {e}</div>
                ))}
              </div>
            </details>
          </div>
        </details>
      )}

      {/* P1-1：用户画像一行（AI 决策已参考） */}
      {(() => {
        const profile = loadUserProfile();
        if (!profile || profile.totalPosts === 0) return null;
        const txt = profileToPrompt(profile);
        return (
          <div className="mt-1.5 rounded border border-sky-500/20 bg-sky-500/5 px-2 py-1 text-[10px] text-sky-200/70" title="AI 决策时参考的用户历史画像">
            👤 用户画像：{txt}
          </div>
        );
      })()}

      {/* P0-1：人类拍板按钮区 —— AI 仅提议，最终由人决定；拍板落 decision_post 闭环台账 */}
      {mainAction && (
        <PostButtons
          mainline={mainline}
          agentVerdict={aiVerdict ? { action: aiVerdict.action, confidence: aiVerdict.confidence, reason: aiVerdict.reason } : null}
          aiLogTs={aiLogTsRef.current}
        />
      )}
    </div>
  );
}

// 便捷：从 gateWeight 导出（组件外部也可能用）
export { gateWeight };
