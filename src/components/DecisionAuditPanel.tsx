// ============================================================
// v9.44（②）：决策过程审计面板 —— 今日/近N日 AI 决策回放时间线
// 数据源：localStorage decision_log:YYYY-MM-DD（DecisionVerdictCard 每次裁决落库，
// 每日最多 50 条；cloudStore 5 分钟同步 PG 防丢失）
// 复盘用途：看清每次裁决的 时间/主线/动作/置信/来源/门控/AI理由/Critic
// ============================================================
import { useState, useEffect, useMemo } from "react";
import { computeDecisionHitrate, type HitrateResult } from "../lib/decisionAttribution";
import DisclaimerTag from "./DisclaimerTag";

interface DecisionLog {
  ts: string;
  mainline: string;
  action: "可上车" | "观望" | "禁止";
  confidence: number;
  source: string;
  gatedDowngrade?: string | null;
  votes?: Array<{ name: string; verdict: string; weight: number }>;
  dissent?: string[];
  agentReason?: string;
  agentCritic?: string;
  // v9.45（V5-2）：Agent 路径埋点
  path?: "native_toolcall" | "manual_json" | "rule_fallback";
  rounds?: number;
  toolsCalled?: string[];
  rateLimited?: boolean;
}

function loadLogs(days: number): Array<{ date: string; logs: DecisionLog[] }> {
  const out: Array<{ date: string; logs: DecisionLog[] }> = [];
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    let logs: DecisionLog[] = [];
    try { logs = JSON.parse(localStorage.getItem(`decision_log:${ds}`) ?? "[]"); } catch { logs = []; }
    if (logs.length > 0) out.push({ date: ds, logs });
  }
  return out;
}

const actionColor: Record<string, string> = {
  "可上车": "bg-rose-500/20 text-rose-300 border-rose-500/40",
  "观望": "bg-amber-500/20 text-amber-300 border-amber-500/40",
  "禁止": "bg-emerald-500/20 text-emerald-300 border-emerald-500/40", // A股习惯：绿=跌/禁止
};

export default function DecisionAuditPanel() {
  const [days, setDays] = useState(1);
  const [data, setData] = useState<Array<{ date: string; logs: DecisionLog[] }>>([]);
  const [hitrate, setHitrate] = useState<HitrateResult | null>(null);

  useEffect(() => { setData(loadLogs(days)); }, [days]);

  // v9.45（V5-3）：决策器命中率对账（AI vs 规则，近 30 日，情绪延续标签）
  useEffect(() => {
    let alive = true;
    computeDecisionHitrate(30).then(r => { if (alive) setHitrate(r); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const stats = useMemo(() => {
    const all = data.flatMap(d => d.logs);
    const withPath = all.filter(l => l.path);
    const pathCount: Record<string, number> = { native_toolcall: 0, manual_json: 0, rule_fallback: 0 };
    for (const l of withPath) if (l.path && l.path in pathCount) pathCount[l.path]++;
    return {
      total: all.length,
      ai: all.filter(l => l.source === "AI-Agent").length,
      veto: all.filter(l => l.action === "禁止").length,
      gated: all.filter(l => l.gatedDowngrade).length,
      rateLimited: all.filter(l => l.rateLimited).length,
      pathCount,
      pathTotal: withPath.length,
    };
  }, [data]);

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-sm font-bold text-slate-100">
          📜 决策审计 <span className="ml-1 text-[10px] text-slate-500 font-normal">AI 与规则每次裁决的完整回放 · 可复盘可追责</span>
        </div>
        <div className="flex items-center gap-1">
          {[1, 3, 7].map(n => (
            <button key={n} onClick={() => setDays(n)}
              className={`rounded px-2 py-0.5 text-[10px] font-bold ${days === n ? "bg-cyan-500/25 text-cyan-200" : "bg-white/5 text-slate-400 hover:bg-white/10"}`}>
              {n === 1 ? "今日" : `近${n}天`}
            </button>
          ))}
          <DisclaimerTag />
        </div>
      </div>

      {stats.total === 0 ? (
        <div className="text-[11px] text-slate-500">
          暂无决策记录。AI 裁决卡每次出结论都会落库 decision_log（每日最多 50 条，cloudStore 同步 PG），下一次裁决后此处出现时间线。
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span>决策 <b className="font-black text-slate-200">{stats.total}</b> 次</span>
            <span>AI 主导 <b className="font-black text-amber-300">{stats.ai}</b></span>
            <span>禁止 <b className="font-black text-emerald-300">{stats.veto}</b></span>
            {stats.gated > 0 && <span>门控降档 <b className="font-black text-rose-300">{stats.gated}</b></span>}
            {stats.rateLimited > 0 && <span>配额受限 <b className="font-black text-rose-300">{stats.rateLimited}</b></span>}
          </div>

          {/* v9.45（V5-3）：决策器命中率 —— "凭什么信 AI"的证据（近30日 可上车→次日情绪延续） */}
          {hitrate && hitrate.ai.total + hitrate.rule.total > 0 && (() => {
            const aiBetter = (hitrate.ai.rate ?? 0) > (hitrate.rule.rate ?? 0);
            return (
              <div className={`rounded-lg border px-2.5 py-1.5 text-[11px] ${aiBetter ? "border-emerald-500/30 bg-emerald-500/10" : "border-amber-500/30 bg-amber-500/10"}`}>
                🎯 可上车命中率（次日情绪延续）：<b className={hitrate.ai.rate != null ? (hitrate.ai.rate >= 55 ? "text-emerald-300" : "text-amber-300") : "text-slate-400"}>
                  AI {hitrate.ai.rate != null ? hitrate.ai.rate + "%" : "样本不足"}（{hitrate.ai.total}）
                </b> vs 规则 <b className={hitrate.rule.rate != null ? (hitrate.rule.rate >= 55 ? "text-emerald-300" : "text-amber-300") : "text-slate-400"}>
                  {hitrate.rule.rate != null ? hitrate.rule.rate + "%" : "样本不足"}（{hitrate.rule.total}）
                </b>
                {hitrate.ai.rate != null && hitrate.rule.rate != null && (
                  <span className="ml-1">{aiBetter
                    ? <span className="text-emerald-300">✅ AI 优于规则</span>
                    : <span className="text-amber-300">⚠ AI 未优于规则，建议人工复核</span>}</span>
                )}
              </div>
            );
          })()}

          {/* v9.45（V5-2）：Agent 路径占比 —— 验证 flash 真在用原生 tool_calls */}
          {stats.pathTotal > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/5 bg-white/[0.03] px-2.5 py-1.5 text-[10px]">
              <span className="text-slate-500">Agent 路径：</span>
              <span className="text-emerald-300">⚙ 原生 tool_calls {Math.round(stats.pathCount.native_toolcall / stats.pathTotal * 100)}%（{stats.pathCount.native_toolcall}）</span>
              <span className="text-sky-300">🧩 JSON 协议 {Math.round(stats.pathCount.manual_json / stats.pathTotal * 100)}%（{stats.pathCount.manual_json}）</span>
              <span className="text-slate-400">⛔ 规则兜底 {Math.round(stats.pathCount.rule_fallback / stats.pathTotal * 100)}%（{stats.pathCount.rule_fallback}）</span>
              {stats.pathCount.native_toolcall / Math.max(1, stats.pathTotal) < 0.5 && (
                <span className="text-amber-300">⚠ 原生 tool_calls 占比 &lt;50%，flash 可能需换更稳定的调用约定</span>
              )}
            </div>
          )}

          {/* 时间线 */}
          <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
            {data.map(({ date, logs }) => (
              <div key={date}>
                <div className="mb-1 text-[10px] font-bold text-slate-400">── {date}（{logs.length} 次）</div>
                <div className="space-y-1.5">
                  {[...logs].reverse().map((l, i) => {
                    const t = new Date(l.ts);
                    const hm = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}:${String(t.getSeconds()).padStart(2, "0")}`;
                    return (
                      <div key={i} className="rounded-lg border border-white/5 bg-white/[0.03] px-2.5 py-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] text-slate-500">{hm}</span>
                          <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${actionColor[l.action] ?? "bg-slate-500/20 text-slate-300"}`}>
                            {l.action === "可上车" ? "可上车" : l.action}
                          </span>
                          <span className="text-[10px] text-slate-400">置信 <b className="text-slate-200">{l.confidence}%</b></span>
                          <span className={`rounded px-1 py-0.5 text-xs font-bold ${l.source === "AI-Agent" ? "bg-amber-500/20 text-amber-300" : "bg-violet-500/20 text-violet-300"}`}>
                            {l.source === "AI-Agent" ? "🤖 AI" : "🧠 规则"}
                          </span>
                          <span className="ml-auto max-w-[150px] truncate text-[10px] text-slate-500" title={l.mainline}>{l.mainline}</span>
                        </div>
                        {l.gatedDowngrade && (
                          <div className="mt-1 rounded bg-rose-500/10 px-1.5 py-0.5 text-[10px] text-rose-300">⛔ {l.gatedDowngrade}</div>
                        )}
                        {l.agentReason && (
                          <div className="mt-1 text-[10px] text-amber-200/80">💬 {l.agentReason}</div>
                        )}
                        {l.agentCritic && (
                          <div className="mt-0.5 text-[10px] text-rose-300/80">🔍 {l.agentCritic}</div>
                        )}
                        {l.dissent && l.dissent.length > 0 && (
                          <div className="mt-0.5 text-xs text-amber-300/60">分歧：{l.dissent.join("；").slice(0, 80)}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="text-[10px] text-slate-600">
            数据源：decision_log:日期（localStorage → cloudStore 5 分钟同步 PG）。含门控降档/分歧/Critic 痕迹，供盘后复盘"AI 为什么这么判"。
          </div>
        </>
      )}
    </div>
  );
}
