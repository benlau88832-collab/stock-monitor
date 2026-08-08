// ============================================================
// P1-3：极简盯盘皮肤 —— 盘中 3 秒扫一眼
// 3 张关键卡：情绪周期 / 当前最强主线 / 自选预警
// 不做深度分析；"展开深度视图"按钮由 Dashboard 提供
// 设计：高对比大字号（3秒可读），红色高亮危险项
// ============================================================
import DisclaimerTag from "./DisclaimerTag";
import type { OverviewData } from "../App";

export interface TopMainlineBrief {
  mainline: string;
  score: number | null;
  height: number | null;
  zt: number | null;
  agent?: { action: string; confidence: number } | null;
}

export interface WatchAlertBrief {
  code: string;
  name: string;
  deviationPct: number;
}

interface Props {
  overview: OverviewData | null;
  topMainline: TopMainlineBrief | null;
  watchAlerts: WatchAlertBrief[];
}

export default function SimpleWatchSkin({ overview, topMainline, watchAlerts }: Props) {
  const sentiment = overview?.sentiment;
  const sentimentColor =
    sentiment != null && sentiment >= 80 ? "text-rose-400"
    : sentiment != null && sentiment <= 25 ? "text-emerald-400"
    : "text-amber-300";
  const agentAction = topMainline?.agent?.action;
  const agentColor = agentAction === "可上车" ? "text-emerald-400" : agentAction === "禁止" ? "text-rose-400" : "text-amber-300";

  return (
    <div className="space-y-3 p-3">
      {/* 情绪周期 */}
      <div className="rounded-xl border-l-4 border-amber-400 bg-slate-900 p-4">
        <div className="text-xs text-slate-400 mb-1">🌡 情绪周期</div>
        <div className={`text-4xl font-black ${sentimentColor}`}>
          {sentiment ?? "?"} <span className="text-base font-bold">{overview?.sentimentLabel ?? "数据不足"}</span>
        </div>
        <div className="mt-1 text-xs text-slate-400">
          涨停 {overview?.limitPool?.limitUpCount ?? "?"} · 炸板率 {overview?.limitPool?.blastedRate?.toFixed(0) ?? "?"}% · 最高板 {overview?.maxBoardHeight ?? "?"}
        </div>
        {overview?.premiumAvg != null && (
          <div className="mt-0.5 text-xs text-slate-500">昨日涨停今日均溢 {overview.premiumAvg > 0 ? "+" : ""}{overview.premiumAvg}%</div>
        )}
      </div>

      {/* 当前最强主线 */}
      <div className="rounded-xl border-l-4 border-sky-400 bg-slate-900 p-4">
        <div className="text-xs text-slate-400 mb-1">🎯 当前最强主线</div>
        <div className="text-2xl font-bold text-slate-100">{topMainline?.mainline ?? "—"}</div>
        <div className="mt-1 text-xs text-slate-400">
          强度 {topMainline?.score ?? "?"} · 涨停 {topMainline?.zt ?? "?"} · 高度 {topMainline?.height ?? "?"}板
          {topMainline?.agent && (
            <span className={`ml-2 font-bold ${agentColor}`}>🤖 {topMainline.agent.action} {topMainline.agent.confidence}%</span>
          )}
        </div>
      </div>

      {/* 自选预警 */}
      <div className="rounded-xl border-l-4 border-rose-400 bg-slate-900 p-4">
        <div className="text-xs text-slate-400 mb-1">🚨 自选预警</div>
        {watchAlerts.length === 0 ? (
          <div className="text-sm text-slate-500">无触发 ✓</div>
        ) : (
          <div className="space-y-1">
            {watchAlerts.slice(0, 5).map(w => (
              <div key={w.code} className="flex items-center gap-2 text-sm">
                <span className={`font-bold ${Math.abs(w.deviationPct) > 5 ? "text-rose-400" : "text-sky-300"}`}>
                  ⚡ {w.name}（{w.code}）
                </span>
                <span className="ml-auto text-slate-400">偏离 {w.deviationPct}%</span>
              </div>
            ))}
            {watchAlerts.length > 5 && <div className="text-xs text-slate-500">… 共 {watchAlerts.length} 条</div>}
          </div>
        )}
      </div>

      <DisclaimerTag />
    </div>
  );
}