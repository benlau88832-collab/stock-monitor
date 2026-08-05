// 情绪周期雷达卡片（v9.18-F5）
// 把温度计升级为"五档周期判断 + 证据链"——避免黑箱评分
// v9.27：显示层词表对齐 stageModel（情绪五档 → 权威词表），避免"启动 vs 启动期"混用
import { computeEmotionCycle, PHASE_META, type EmotionCycleInput, type EmotionCycleResult } from "../lib/emotionCycle";
import { emotionToStage } from "../lib/stageModel";
import DisclaimerTag from "./DisclaimerTag";

export default function EmotionCycleCard({ input }: { input: EmotionCycleInput }) {
  const result: EmotionCycleResult = computeEmotionCycle(input);
  const meta = PHASE_META[result.phase];
  const stageLabel = emotionToStage(result.phase);
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-200">🎚️ 情绪周期雷达</span>
          <span className={`rounded border px-1.5 py-0.5 text-[11px] font-black ${meta.color}`}>
            {meta.icon} {stageLabel}
          </span>
          <span className="text-[10px] text-slate-500">置信度 {result.confidence}%</span>
          <DisclaimerTag />
        </div>
        {result.ebbAlert && (
          <span className="rounded border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-bold text-rose-300">
            {result.ebbAlertText.slice(0, 14)}…
          </span>
        )}
      </div>

      {/* 操作基调（中性表述） */}
      <div className="text-[11px] text-slate-300 leading-relaxed">{result.base}</div>

      {/* 证据链（避免黑箱） */}
      <div className="flex flex-wrap gap-1">
        {result.evidence.map((e, i) => (
          <span key={i} className="rounded bg-black/30 px-1.5 py-0.5 text-[10px] text-slate-400">📊 {e}</span>
        ))}
      </div>

      {result.ebbAlert && result.ebbAlertText && (
        <div className="rounded border border-rose-500/20 bg-rose-500/5 px-2 py-1 text-[10px] text-rose-300">
          {result.ebbAlertText} <DisclaimerTag text="历史统计规律参考" />
        </div>
      )}
    </div>
  );
}
