// ============================================================
// v9.37（V3-7）：AI 终裁决卡 —— "替代决策"的用户可见终点
// 一屏看清：结论 + 凭什么（各源投票）+ 谁反对（dissent）+ 多确信（置信度）
// 数据来自 decisionBus.runConsensus 汇聚的多源证据
// ============================================================
import { useMemo, useEffect } from "react";
import { runConsensus, type EvidenceSource, type DecisionVerdict } from "../lib/decisionBus";
import { gateWeight } from "../lib/decisionBus";
import DisclaimerTag from "./DisclaimerTag";

interface Props {
  /** 今日最强主线（用于展示主体） */
  mainline?: string;
  /** 多源证据（由调用方从各引擎汇聚） */
  sources?: EvidenceSource[];
  /** 信号回测门控（可选，命中后降权） */
  signalGates?: Array<{ name: string; winRate: number | null; samples: number | null }>;
}

export default function DecisionVerdictCard({ mainline = "—", sources = [], signalGates = [] }: Props) {
  const verdict: DecisionVerdict | null = useMemo(() => {
    if (sources.length === 0) return null;
    return runConsensus(sources, { signalGates });
  }, [sources, signalGates]);

  if (!verdict) return null;

  // v9.37（V3-P2）：决策日志落库（可审计/可复盘）—— 每次裁决存 localStorage
  useEffect(() => {
    try {
      const log = {
        ts: new Date().toISOString(),
        mainline,
        action: verdict.action,
        confidence: verdict.confidence,
        votes: verdict.votes,
        dissent: verdict.dissent,
      };
      const key = `decision_log:${new Date().toISOString().slice(0, 10)}`;
      const arr = JSON.parse(localStorage.getItem(key) ?? "[]");
      arr.push(log);
      localStorage.setItem(key, JSON.stringify(arr.slice(-50))); // 每日最多留 50 条
    } catch { /* 日志失败不影响功能 */ }
  }, [verdict.action, verdict.confidence, verdict.votes, mainline]);

  const actionColor =
    verdict.action === "可上车" ? "bg-emerald-500/25 text-emerald-300 border-emerald-500/40"
    : verdict.action === "观望" ? "bg-amber-500/25 text-amber-300 border-amber-500/40"
    : "bg-rose-500/25 text-rose-300 border-rose-500/40";

  return (
    <div className="rounded-xl border border-violet-500/30 bg-violet-950/15 p-3">
      {/* 头部：结论 + 置信度 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-violet-200">🧠 AI 终裁决</span>
          <span className={`rounded-lg border px-2 py-0.5 text-sm font-black ${actionColor}`}>
            {verdict.action === "可上车" ? "参考关注（可上车）" : verdict.action === "观望" ? "观望" : "禁止参与"}
          </span>
          <span className="text-[10px] text-slate-500">置信 {verdict.confidence}%</span>
          <DisclaimerTag />
        </div>
        <span className="max-w-[160px] truncate text-[10px] text-slate-500" title={mainline}>
          {mainline}
        </span>
      </div>

      {/* 各源投票明细 */}
      <div className="mt-2 space-y-1">
        {verdict.votes.map(v => (
          <div key={v.name} className="flex items-center gap-2 text-[10px]">
            <span className="w-14 shrink-0 text-slate-400">{v.name}</span>
            <span className={`rounded px-1.5 py-0.5 font-bold ${
              v.verdict === "可上车" ? "bg-emerald-500/15 text-emerald-300"
              : v.verdict === "观望" ? "bg-amber-500/15 text-amber-300"
              : "bg-rose-500/15 text-rose-300"
            }`}>{v.verdict}</span>
            <span className="text-slate-600">权重{v.weight.toFixed(1)}</span>
          </div>
        ))}
      </div>

      {/* 反对意见 */}
      {verdict.dissent.length > 0 && (
        <div className="mt-1.5 rounded border border-rose-500/20 bg-rose-500/5 px-2 py-1 text-[10px] text-rose-300/80">
          ⚠ 反对意见：{verdict.dissent.join("；")}
        </div>
      )}

      {/* 被门控信号 */}
      {verdict.gatedSignals.length > 0 && (
        <div className="mt-1 text-[9px] text-slate-500">
          🚪 回测门控：{verdict.gatedSignals.join("；")}
        </div>
      )}

      {/* 证据链（可审计） */}
      <details className="mt-1.5">
        <summary className="cursor-pointer text-[10px] text-slate-500 hover:text-slate-400">📋 证据链（点击展开）</summary>
        <div className="mt-1 space-y-0.5">
          {verdict.evidence.map((e, i) => (
            <div key={i} className="text-[10px] text-slate-400">• {e}</div>
          ))}
        </div>
      </details>
    </div>
  );
}

// 便捷：从 gateWeight 导出（组件外部也可能用）
export { gateWeight };
