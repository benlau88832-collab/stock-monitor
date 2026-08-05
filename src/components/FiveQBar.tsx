// 游资五问条（v9.23-3，PRD 5.1-A1）
// 驾驶舱顶部常驻 5 卡片横排：主线/阶段/龙头/操作/离场信号
// 价值主张："3 秒告诉我今天最强的主线是什么、现在是什么阶段、我该不该上车、什么时候该跑"
// 60 秒自动刷新；v9.28（P1-5）：第4问"操作"改用最终准入闸（强度×阶段×闸门×梯队）
import { useState, useEffect } from "react";
import type { BattlePlanData } from "./BattlePlan";
import { STRENGTH_META } from "../lib/mainlineScore";
import { evaluateAdmission } from "../lib/admissionGate";
import { stageOfStrength } from "../lib/stageModel";
import DisclaimerTag from "./DisclaimerTag";

interface Props {
  battlePlan: BattlePlanData | null;
}

export default function FiveQBar({ battlePlan }: Props) {
  const [, setTick] = useState(0);
  // 60s 自动刷新（v9.23-A1）
  useEffect(() => {
    const t = setInterval(() => setTick(v => v + 1), 60000);
    return () => clearInterval(t);
  }, []);

  // 取最强主线（强度分最高，优先看 score/ztCount 兜底）
  const candidates = battlePlan?.candidates ?? [];
  const top = candidates.length > 0 ? candidates[0] : null;
  const topMainline = top?.mainline ?? "—";
  const topScore = top?.strengthScore ?? 0;
  const topStage = battlePlan?.marketStyle?.label ?? "—";

  // v9.28（P1-5）：操作徽章基于最终准入闸（强度×阶段×闸门×梯队×诱多）
  const admission = evaluateAdmission({
    strengthScore: top?.strengthScore ?? null,
    stage: top ? stageOfStrength({ strengthScore: top.strengthScore, ztCount: top.ztCount, exitSignal: top.exitSignal }) : "观察中",
    gateMode: battlePlan?.gate?.mode ?? "empty",
    ztCount: top?.ztCount ?? 0,
    height: top?.height ?? 0,
  });
  let action = admission.action;
  let actionColor = "bg-slate-500/20 text-slate-400 border-slate-500/30";
  if (!top) {
    action = "观望";
  } else if (admission.action === "禁止") {
    actionColor = "bg-rose-500/25 text-rose-300 border-rose-500/40";
  } else if (admission.action === "可上车") {
    actionColor = "bg-emerald-500/25 text-emerald-300 border-emerald-500/40";
  } else {
    actionColor = "bg-amber-500/25 text-amber-300 border-amber-500/40";
  }

  const strengthMeta = STRENGTH_META[topScore >= 80 ? "gold" : topScore >= 60 ? "silver" : "bronze"];

  // v9.26 A.3：三态输出（唯一可交易 / 多主线轮动 / 无可交易）—— 避免"无论如何给第一名"
  // 规则：Top1 强度≥60 且 与 Top2 分差≥10 → 唯一可交易；分差<10 → 轮动；无合格 → 无可交易
  const top2Score = candidates[1]?.strengthScore ?? candidates[1]?.score ?? 0;
  const gapOk = top && (topScore - top2Score) >= 10;
  const qualified = top && topScore >= 60 && (top?.strengthCompleteness ?? 1) >= 0.5;
  let mainlineState: { label: string; cls: string; desc: string };
  if (!top || !qualified) {
    mainlineState = { label: "无可交易主线", cls: "text-slate-500", desc: "强度不足或数据缺失，只观察" };
  } else if (gapOk) {
    mainlineState = { label: `唯一可交易：${topMainline}`, cls: "text-rose-300", desc: `Top2 ${top2Score}分，分差${Math.round(topScore - top2Score)}分` };
  } else {
    mainlineState = { label: "多主线轮动", cls: "text-amber-300", desc: `Top1 ${topScore} / Top2 ${top2Score}，分差<10` };
  }

  return (
    <div className="grid grid-cols-2 gap-1.5 lg:grid-cols-5">
      {/* 1. 主线是什么（v9.26 A.3 三态：唯一可交易/多主线轮动/无可交易） */}
      <div className="rounded-lg border border-white/10 bg-white/5 p-2">
        <div className="text-[9px] text-slate-500">1️⃣ 主线是什么</div>
        <div className={`mt-0.5 text-xs font-bold truncate ${mainlineState.cls}`} title={mainlineState.desc}>
          {mainlineState.label}
          {top && <span className={`ml-1 rounded px-1 py-0.5 text-[9px] font-black ${strengthMeta.color}`}>{topScore}分</span>}
        </div>
        <div className="text-[9px] text-slate-500" title={mainlineState.desc}>
          {mainlineState.desc}
          {top && top.strengthMissing && top.strengthMissing.length > 0 && (
            <span className="text-amber-400/80"> 缺:{top.strengthMissing.join("/")}</span>
          )}
        </div>
      </div>

      {/* 2. 处于什么阶段 */}
      <div className="rounded-lg border border-white/10 bg-white/5 p-2">
        <div className="text-[9px] text-slate-500">2️⃣ 处于什么阶段</div>
        <div className="mt-0.5 text-xs font-bold text-amber-300 truncate">{topStage}</div>
        <div className="text-[9px] text-slate-500">{battlePlan?.gate?.label ?? "—"}</div>
      </div>

      {/* 3. 谁是龙头 */}
      <div className="rounded-lg border border-white/10 bg-white/5 p-2">
        <div className="text-[9px] text-slate-500">3️⃣ 谁是龙头</div>
        <div className="mt-0.5 text-xs font-bold text-slate-100 truncate">
          {top?.leaders[0]?.name ?? "—"}
          <span className="text-slate-500 ml-1">{top?.leaders[0]?.code ?? ""}</span>
        </div>
        <div className="text-[9px] text-slate-500">{top?.leaders[0]?.reason?.slice(0, 12) ?? "梯队数据积累中"}</div>
      </div>

      {/* 4. 能不能上车 */}
      <div className="rounded-lg border border-white/10 bg-white/5 p-2">
        <div className="text-[9px] text-slate-500">4️⃣ 能不能上车</div>
        <div className={`mt-0.5 inline-block rounded border px-1.5 py-0.5 text-[11px] font-black ${actionColor}`}>
          {action}
          {admission.pass && <span className="ml-1 text-[9px] font-normal opacity-80">置信 {admission.confidence}%</span>}
        </div>
        <div className="text-[9px] text-slate-500 mt-0.5 truncate" title={admission.pass ? admission.reasons.join("；") : admission.blockers.join("；")}>
          {admission.pass ? admission.reasons.join("；") : (admission.blockers[0] ?? "—")}
        </div>
        <div className="text-[9px] text-slate-500 mt-0.5">
          闸门×{battlePlan?.gate?.factor?.toFixed(1) ?? "—"}
          <DisclaimerTag />
        </div>
      </div>

      {/* 5. 什么时候跑 */}
      <div className="rounded-lg border border-white/10 bg-white/5 p-2">
        <div className="text-[9px] text-slate-500">5️⃣ 什么时候跑</div>
        {top?.exitSignal ? (
          <div className="mt-0.5 text-[11px] font-bold text-rose-400">⚠ 已触发</div>
        ) : (
          <div className="mt-0.5 text-[11px] font-bold text-emerald-400">✓ 尚未触发</div>
        )}
        <div className="text-[9px] text-slate-500 truncate" title={top?.exitSignalText ?? ""}>
          {top?.exitSignalText ?? "持续监控炸板率/晋级率"}
        </div>
      </div>
    </div>
  );
}
