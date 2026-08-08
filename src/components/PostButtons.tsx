// ============================================================
// P0-1：人类拍板按钮 —— AI 提议之后，"人类决策"环节的 UI 入口
// 三个按钮：✅ 确认上车 / ⏸ 等等观望 / 🚫 否决回避
// 拍板写入 decision_post（localStorage + PG）
// 设计：仅 confirm 触发 P0-2 联动；watch/reject 仅留痕
// 与 DecisionVerdictCard 同卡渲染，仅当 AI/规则裁决可用时显示
// ============================================================
import { useRef, useState } from "react";
import { buildPost, savePost, hasPosted, type HumanAction, type DecisionPost } from "../lib/decisionPost";
import { emit as emitAlert } from "../lib/alertBus";
import type { PostHookCtx } from "../lib/hookDecisionPost";
import DisclaimerTag from "./DisclaimerTag";

interface Props {
  /** 当前主线索（先支柱） */
  mainline: string;
  /** AI Agent 裁决结果（如有，用于拍板时记录此时置信） */
  agentVerdict?: { action: string; confidence: number; reason: string } | null;
  /** 决策日志 ts（用于幂等：同次 AI 裁决不能重复拍板） */
  aiLogTs: string | null;
  /** 个股决策时填 code（可选） */
  code?: string | null;
  /** 拍价（个股时可填） */
  priceAtPost?: number | null;
  /** v9.77（P0-15）：真实 stage/闸门/强度 —— 拍板联动算仓位不再用硬编码"观察中" */
  hookCtx?: PostHookCtx;
}

export default function PostButtons({ mainline, agentVerdict, aiLogTs, code = null, priceAtPost = null, hookCtx }: Props) {
  const [posted, setPosted] = useState<HumanAction | null>(null);
  const [note, setNote] = useState("");
  const lastTicketId = useRef<string | null>(null);

  // 仅当有 AI 或规则裁决时才显示按钮（无 agentVerdict 时仍可显示，使用户随手记一句"否决"）
  if (posted) {
    return (
      <div className="mt-2 px-3 py-2 rounded bg-slate-800/60 text-slate-200 text-xs flex items-center justify-between">
        <span>已记录拍板：
          <b className={posted === "confirm" ? "text-emerald-400" : posted === "watch" ? "text-amber-300" : "text-rose-300"}>
            {posted === "confirm" ? "✅ 确认上车" : posted === "watch" ? "⏸ 等等观望" : "🚫 否决回避"}
          </b>
        </span>
        <button className="text-sky-400 hover:text-sky-300 underline" onClick={() => setPosted(null)}>撤销重拍</button>
      </div>
    );
  }

  const handlePost = async (action: HumanAction) => {
    if (aiLogTs && hasPosted(aiLogTs)) {
      emitAlert({ id: `post_double_warn_${aiLogTs.slice(-6)}`, severity: "warning", message: "已对本次裁决拍过板，请到决策审计查看" });
      return;
    }
    // P2-1：纪律硬约束 —— confirm 前检查单票/总仓位超限（拦截确认，允许强确认）
    // v9.77（P0-14 修复）：原匹配"单票仓位上限/总仓位上限"两个子串，而 discipline 实际文本是
    //   "超过单票上限 30%" / "总仓位 X% 超过上限 Y%" → 拦截永不触发（死代码）。
    //   改为匹配"单票上限/总仓位"，且仅 level==='critical'（超限）才拦，开仓次数警告不拦。
    if (action === "confirm") {
      try {
        const { computeDisciplineViolations, loadDisciplineState } = await import("../lib/discipline");
        const violations = computeDisciplineViolations(loadDisciplineState());
        const blockV = violations.find(v => v.level === "critical" && (v.text.includes("单票上限") || v.text.includes("总仓位")));
        if (blockV) {
          if (!window.confirm(`⚠ 违反纪律：${blockV.text}\n\n确定仍要拍板？（此操作会写入纪律审计）`)) return;
          emitAlert({ id: `post_block_${code ?? mainline}`, severity: "critical", message: `🚨 拍板突破纪律：${blockV.text}` });
        }
      } catch { /* 纪律数据不可用不拦截（不影响拍板） */ }
    }
    const post = buildPost({
      mainline: mainline === "—" ? null : mainline,
      code,
      humanAction: action,
      confidenceAtPost: agentVerdict?.confidence ?? null,
      priceAtPost,
      notes: note,
      decisionLogRef: aiLogTs,
    });
    lastTicketId.current = post.ticketId;
    await savePost(post);
    setPosted(action);
    emitAlert({
      id: `post_record_${post.ticketId}`,
      severity: "info",
      message: `🎬 已记录拍板：${action === "confirm" ? "确认上车" : action === "watch" ? "等观望" : "否决回避"}（${mainline}）`,
    });
    // P0-2 联动：仅 confirm 触发，懒加载防影响主链
    if (action === "confirm") {
      try {
        const { runPostHook } = await import("../lib/hookDecisionPost");
        const hook = await runPostHook(post as DecisionPost, hookCtx);
        if (hook.addedToDiscipline) {
          emitAlert({ id: `post_disc_${post.ticketId}`, severity: "info", message: `已加入纪律面板持仓（默认 20% 仓位，可到纪律面板修订）` });
        }
        if (hook.addedToWatch) {
          emitAlert({ id: `post_watch_${post.ticketId}`, severity: "info", message: `已自动开启盯价监控（止损 ${hook.positionAdvice?.stopLoss ?? "?"}%）` });
        }
        if (hook.positionAdvice) {
          emitAlert({ id: `post_pos_${post.ticketId}`, severity: "info", message: `仓位建议 ${hook.positionAdvice.suggestedPct}% · 分批 ${hook.positionAdvice.tranches.join("/") || "—"} · 止损 ${hook.positionAdvice.stopLoss}%` });
        }
      } catch { /* P0-2 未就绪时静默；不影响拍板落库 */ }
    }
  };

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-slate-700/60 bg-slate-900/40 p-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-bold text-slate-300">🎬 人类拍板（AI 仅提议，最终由你决定）</div>
        <DisclaimerTag />
      </div>
      <div className="flex gap-2">
        <button onClick={() => handlePost("confirm")}
          className="flex-1 px-3 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold transition">
          ✅ 确认上车
        </button>
        <button onClick={() => handlePost("watch")}
          className="flex-1 px-3 py-2 rounded bg-amber-600 hover:bg-amber-500 text-white text-sm font-bold transition">
          ⏸ 等等观望
        </button>
        <button onClick={() => handlePost("reject")}
          className="flex-1 px-3 py-2 rounded bg-rose-600 hover:bg-rose-500 text-white text-sm font-bold transition">
          🚫 否决回避
        </button>
      </div>
      <input value={note} onChange={(e) => setNote(e.target.value)}
        placeholder="一句话理由（可选，≤40 字）"
        className="w-full px-2 py-1 text-xs rounded bg-slate-950/60 border border-slate-700 text-slate-200 focus:outline-none focus:border-sky-500"
        maxLength={40} />
      <div className="text-[10px] text-slate-500">
        拍板写入"决策闭环台账"用于归因（确认上车会自动入纪律+盯价）。AI 推荐不构成投资建议，请独立判断。
      </div>
    </div>
  );
}