// ============================================================
// v9.147.0（重建·对齐 v9.146 接口）：决策反馈小组件
// 用途：波段决策卡（SwingWarRoomV2 决策区）下方就地反馈 —— 判定"准/不准" + 归因，
//   写入 decision_feedback 表（POST /api/db/decision_feedback），供 feedbackPenalty
//   与 userProfile 画像消费（决策质量闭环的输入侧）。
// Props: ticketId（AI-Swing 留痕 id）/ code —— 与 PostButtons 的反馈通道并存，
//   PostButtons 服务拍板动作，本组件服务波段决策卡。
// ============================================================
import { useState } from "react";
import { apiFetch } from "../lib/cloudStore";
import { recordDecisionFeedback } from "../lib/userProfile";

const ATTRIBUTIONS = [
  { key: "chain", label: "产业链判断错" },
  { key: "fundamentals", label: "基本面判断错" },
  { key: "timing", label: "择时判断错" },
  { key: "data", label: "数据本身错" },
];

export default function DecisionFeedback({ ticketId, code }: { ticketId: string | null; code: string | null }) {
  const [attr, setAttr] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (feedback: "accurate" | "inaccurate") => {
    if (!ticketId || busy) return;
    setBusy(true);
    try {
      await apiFetch("/api/db/decision_feedback", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId, code, mainline: null, feedback, attribution: attr ?? undefined, note: note || undefined }),
      });
      recordDecisionFeedback(feedback, attr ?? undefined);
      setSent(true);
    } catch { /* 反馈失败不打扰 */ }
    finally { setBusy(false); }
  };

  if (!ticketId) return null;

  return (
    <div className="rounded bg-black/20 p-1.5">
      {sent ? (
        <div className="text-[10px] text-emerald-300">反馈已记录，用于画像与置信校准</div>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-slate-500">本次决策：</span>
          <button onClick={() => submit("accurate")} disabled={busy} className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50">✓ 准确</button>
          <button onClick={() => submit("inaccurate")} disabled={busy} className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-bold text-rose-300 hover:bg-rose-500/25 disabled:opacity-50">✗ 不准</button>
          <select value={attr ?? ""} onChange={(e) => setAttr(e.target.value || null)} className="rounded bg-slate-950/60 border border-slate-700 px-1 py-0.5 text-[10px] text-slate-300 focus:outline-none">
            <option value="">归因（可选）</option>
            {ATTRIBUTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="补充（可选）" className="w-28 rounded bg-slate-950/60 border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-200 focus:outline-none" />
        </div>
      )}
    </div>
  );
}
