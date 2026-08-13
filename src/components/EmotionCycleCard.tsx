// 情绪周期雷达卡片（v9.18-F5）
// 把温度计升级为"周期判断 + 证据链"——避免黑箱评分
// v9.129.0（一致性收敛）：词表=emotionStage 六词（与认知层同构），删除 emotionToStage 映射
//   （原"冰点→退潮期"词表混用，与认知横幅互斥）
// v9.32.1（缺口1）：溢价分布 4 档柱图 —— 游资看第一眼是分布不是均值（焖面多=亏钱效应）
import { useEffect, useState } from "react";
import { computeEmotionCycle, PHASE_META, type EmotionCycleInput, type EmotionCycleResult } from "../lib/emotionCycle";
import DisclaimerTag from "./DisclaimerTag";

interface Props {
  input: EmotionCycleInput;
  /** v9.32.1：昨日涨停今日溢价分布（4 档） */
  premiumDist?: { ltNeg5: number; neg5to0: number; zeroTo3: number; gt3: number } | null;
}

export default function EmotionCycleCard({ input, premiumDist = null }: Props) {
  const result: EmotionCycleResult = computeEmotionCycle(input);
  const meta = PHASE_META[result.phase];
  const stageLabel = result.phase; // v9.129.0：六词直显（与认知层同词表，不再映射主线词表）
  // v9.130.0（终审 N5）：阶段回测统计接线（/api/backtest/stage，N≥5 才展示次日溢价胜率）
  const [bt, setBt] = useState<{ winRate: number; n: number } | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/backtest/stage?days=60", { signal: AbortSignal.timeout(6000) });
        if (!r.ok) return;
        const j = await r.json();
        if (!alive || !Array.isArray(j.perStage)) return;
        const cur = j.perStage.find((g: { stage: string }) => g.stage === result.phase);
        if (cur && cur.sampleEnough) setBt({ winRate: cur.winRate, n: cur.n });
      } catch { /* 静默 */ }
    })();
    return () => { alive = false; };
  }, [result.phase]);

  // v9.32.1：溢价分布 → 赚钱/亏钱效应定性
  const distTotal = premiumDist ? premiumDist.ltNeg5 + premiumDist.neg5to0 + premiumDist.zeroTo3 + premiumDist.gt3 : 0;
  const distBars = premiumDist && distTotal > 0 ? [
    { label: "<-5%", val: premiumDist.ltNeg5, color: "bg-rose-500" },
    { label: "-5~0", val: premiumDist.neg5to0, color: "bg-orange-500" },
    { label: "0~3%", val: premiumDist.zeroTo3, color: "bg-amber-400" },
    { label: ">3%", val: premiumDist.gt3, color: "bg-emerald-500" },
  ] : null;
  const distLabel = distTotal > 0
    ? premiumDist!.ltNeg5 / distTotal >= 0.3
      ? "⚠ 焖面占比高（亏钱效应强）"
      : premiumDist!.gt3 / distTotal >= 0.3
        ? "🔥 高溢价占比高（赚钱效应强）"
        : "溢价分布中性"
    : "";
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-200">🎚️ 情绪周期雷达</span>
          <span className={`rounded border px-1.5 py-0.5 text-[11px] font-black ${meta.color}`}>
            {meta.icon} {stageLabel}
          </span>
          <span className="text-[10px] text-slate-500">置信度 {result.confidence}%</span>
          {bt && (
            <span className="text-[10px] text-slate-400">历史回测：次日溢价胜率 {bt.winRate}%（n={bt.n}）</span>
          )}
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

      {/* v9.32.1：溢价分布 4 档柱图（昨日涨停今日表现） */}
      {distBars && (
        <div className="rounded-lg border border-white/10 bg-black/20 p-2">
          <div className="flex items-center justify-between text-[10px] mb-1">
            <span className="text-slate-400">昨日涨停今日溢价分布</span>
            <span className={`font-bold ${distLabel.startsWith("⚠") ? "text-rose-300" : distLabel.startsWith("🔥") ? "text-emerald-300" : "text-slate-400"}`}>{distLabel}</span>
          </div>
          <div className="flex items-end gap-1.5 h-8">
            {distBars.map(b => (
              <div key={b.label} className="flex-1 flex flex-col items-center gap-0.5">
                <span className="text-xs text-slate-400">{b.val}</span>
                <div className={`w-full rounded-sm ${b.color}`} style={{ height: `${Math.max(8, b.val / distTotal * 32)}px`, opacity: 0.8 }} />
                <span className="text-xs text-slate-500">{b.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {result.ebbAlert && result.ebbAlertText && (
        <div className="rounded border border-rose-500/20 bg-rose-500/5 px-2 py-1 text-[10px] text-rose-300">
          {result.ebbAlertText} <DisclaimerTag text="历史统计规律参考" />
        </div>
      )}
    </div>
  );
}
