// ============================================================
// v9.65（V2-P2）：运维可观测面板 —— 数据源健康 / AI 配额 / 请求队列 / 因子健康
// 展示：apiHealth 成功率与慢接口、AI 今日调用/失败/平均延迟、JSONP 队列、因子失效占比
// ============================================================
import { useState, useEffect } from "react";
import { getApiHealth, getOverallHealth } from "../lib/apiHealth";
import { getAIStats } from "../lib/ai";
import { getJsonpQueueState } from "../lib/jsonpQueue";

interface FactorInfo {
  total: number;
  decayed: number;
  missing: number;
  samples: number | null;
}

export default function OpsPanel() {
  const [apiRecs, setApiRecs] = useState<ReturnType<typeof getApiHealth>>([]);
  const [aiStats, setAiStats] = useState<ReturnType<typeof getAIStats>>(null as never);
  const [queue, setQueue] = useState({ inflight: 0, queueLength: 0 });
  const [factor, setFactor] = useState<FactorInfo | null>(null);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try { setApiRecs(getApiHealth().slice(0, 12)); } catch { /* 静默 */ }
      try { setAiStats(getAIStats()); } catch { /* 静默 */ }
      try { setQueue(getJsonpQueueState()); } catch { /* 静默 */ }
      try {
        const { evaluateFactorHealth } = await import("../lib/agentTools");
        const r = await evaluateFactorHealth();
        if (r && alive) {
          setFactor({
            total: r.total,
            decayed: r.decayedCount,
            missing: r.items.filter(i => (i as any).missing).length,
            samples: r.items[0]?.samples ?? null,
          });
        }
      } catch { /* 静默 */ }
    };
    refresh();
    const t = setInterval(refresh, 30000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const overall = (() => { try { return getOverallHealth(); } catch { return "yellow" as const; } })();
  const overallColor = overall === "green" ? "text-emerald-300" : overall === "yellow" ? "text-amber-300" : "text-rose-300";
  const totalCalls = apiRecs.reduce((s, r) => s + r.recentCalls, 0);
  const totalOk = apiRecs.reduce((s, r) => s + r.recentSuccesses, 0);
  const okRate = totalCalls ? Math.round(totalOk / totalCalls * 100) : 0;

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-xs">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-bold text-slate-100">🛰 运维可观测 <span className="ml-1 text-[10px] text-slate-500 font-normal">数据源健康 · AI 配额 · 队列 · 因子</span></div>
        <div className={`text-[11px] font-bold ${overallColor}`}>整体 {overall === "green" ? "健康" : overall === "yellow" ? "注意" : "风险"}</div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {/* 数据源健康 */}
        <div className="rounded-lg bg-black/20 p-2 space-y-1">
          <div className="text-[10px] text-slate-500">数据源成功率（近 {totalCalls} 次）</div>
          <div className={`text-lg font-bold ${okRate >= 90 ? "text-emerald-300" : okRate >= 70 ? "text-amber-300" : "text-rose-300"}`}>{okRate}%</div>
          {apiRecs.filter(r => r.recentCalls >= 3 && r.recentSuccesses / r.recentCalls < 0.5).slice(0, 3).map((r, i) => (
            <div key={i} className="text-[9px] text-rose-300/80 truncate">✗ {r.name}</div>
          ))}
          {apiRecs.filter(r => r.recentCalls >= 2 && r.avgMs > 3000).slice(0, 2).map((r, i) => (
            <div key={i} className="text-[9px] text-amber-300/80 truncate">🐢 {r.name} {(r.avgMs / 1000).toFixed(1)}s</div>
          ))}
        </div>

        {/* AI 配额 */}
        <div className="rounded-lg bg-black/20 p-2 space-y-1">
          <div className="text-[10px] text-slate-500">AI 今日调用</div>
          <div className="text-lg font-bold text-violet-300">{aiStats?.calls ?? "—"}</div>
          <div className="text-[10px] text-slate-500">失败 {aiStats?.failures ?? 0} · 平均 {(aiStats?.avgLatency ?? 0) / 1000}s</div>
        </div>

        {/* 请求队列 */}
        <div className="rounded-lg bg-black/20 p-2 space-y-1">
          <div className="text-[10px] text-slate-500">JSONP 队列</div>
          <div className="text-lg font-bold text-amber-300">{queue.inflight}<span className="text-xs text-slate-500">/3 并发</span></div>
          <div className="text-[10px] text-slate-500">排队 {queue.queueLength} · 超过 3 说明东财限流中</div>
        </div>

        {/* 因子健康 */}
        <div className="rounded-lg bg-black/20 p-2 space-y-1">
          <div className="text-[10px] text-slate-500">因子健康（最新快照）</div>
          <div className={`text-lg font-bold ${factor && factor.decayed / Math.max(1, factor.total) >= 0.5 ? "text-rose-300" : "text-emerald-300"}`}>
            {factor ? `${factor.total - factor.decayed - factor.missing}/${factor.total} 正常` : "—"}
          </div>
          <div className="text-[10px] text-slate-500">
            {factor ? `失效 ${factor.decayed} · 数据缺失 ${factor.missing} · 样本 ${factor.samples ?? "?"} 天` : "暂无快照（本地部署盘后落库）"}
          </div>
        </div>
      </div>
    </div>
  );
}
