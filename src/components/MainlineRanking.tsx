// 主线强度排行榜（v9.24-P1-1，PRD B1）
// 资金主线页首屏：按"主线强度分"排序的决策表格（替代旧的按资金净流入简单排序）
// 核心思想：金额大 ≠ 主线强，以强度分(PRD 6.1 六维公式)为准
import { fmtMoney } from "../lib/format";
import type { MainlineGroup } from "../lib/stockToMainline";
import type { BattlePlanData } from "./BattlePlan";
import DisclaimerTag from "./DisclaimerTag";
import { stageOfStrength, STAGE_COLOR } from "../lib/stageModel";

// ============== 阶段判定（v9.27：统一走 stageModel.stageOfStrength，词表与全局一致） ==============

// ============== 操作建议徽章（四色，与 FiveQBar 同口径） ==============
function actionBadge(c: MainlineGroup): { label: string; cls: string } {
  if (c.exitSignal) return { label: "应离场", cls: "bg-rose-500/20 text-rose-300 border-rose-500/40" };
  const s = c.strengthScore ?? c.score;
  if (s >= 80) return { label: "可参与", cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" };
  if (s >= 60) return { label: "谨慎参与", cls: "bg-amber-500/20 text-amber-300 border-amber-500/40" };
  return { label: "观望", cls: "bg-slate-500/20 text-slate-400 border-slate-500/40" };
}

// ============== 主组件 ==============
export default function MainlineRanking({ battlePlan, loading }: {
  battlePlan: BattlePlanData | null;
  loading: boolean;
}) {
  if (loading && !battlePlan) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-slate-400 text-sm">
        主线强度榜加载中…
      </div>
    );
  }
  const candidates: MainlineGroup[] = battlePlan?.candidates ?? [];
  if (candidates.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-slate-400 text-sm">
        暂无主线数据（今日可能无涨停潮，或数据源未返回）
      </div>
    );
  }

  // 按强度分降序（LLM 精排结果 llmRanked 已在 App 端重排 candidates，这里再兜底一次）
  const rows = [...candidates].sort((a, b) => (b.strengthScore ?? b.score) - (a.strengthScore ?? a.score));

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-200">
          🏆 主线强度排行榜 <span className="text-[11px] font-normal text-slate-500">（强度分 = 涨停占比25% + 连板20% + 晋级15% + 资金20% + 换手10% + 催化10%）</span>
        </h3>
        <span className="text-[11px] text-slate-500">按强度分排序 · 红=≥80 橙=60-79 灰=&lt;60</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-[11px] text-slate-500 border-b border-white/10">
              <th className="py-2 pr-2">#</th>
              <th className="py-2 pr-2">主线</th>
              <th className="py-2 pr-2 text-right">强度分</th>
              <th className="py-2 pr-2">阶段</th>
              <th className="py-2 pr-2 text-right">涨停</th>
              <th className="py-2 pr-2 text-right">连板高度</th>
              <th className="py-2 pr-2 text-right" title="晋级率得分（强度因子）">晋级率</th>
              <th className="py-2 pr-2 text-right" title="换手活跃度得分（强度因子）">换手</th>
              <th className="py-2 pr-2 text-right">资金净流入(今/5日)</th>
              <th className="py-2 pr-2">龙头</th>
              <th className="py-2 pr-2">AI 诊断</th>
              <th className="py-2 pr-2 text-right" title="非缺失因子占比；缺失越多置信度越低">完整度</th>
              <th className="py-2">操作参考</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c, i) => {
              const s = c.strengthScore ?? c.score;
              const scoreCls = s >= 80 ? "text-rose-300" : s >= 60 ? "text-amber-300" : "text-slate-400";
              const rowBg = s >= 80 ? "bg-rose-500/5" : i % 2 === 1 ? "bg-white/[0.02]" : "";
              const leader = c.leaders[0];
              const badge = actionBadge(c);
              const stage = stageOfStrength(c);
              return (
                <tr key={c.mainline} className={`border-b border-white/5 ${rowBg}`}>
                  <td className="py-2 pr-2 text-slate-500">{i + 1}</td>
                  <td className="py-2 pr-2 font-semibold text-slate-200">
                    {c.mainline}
                    {c.isPulse && <span className="ml-1 text-[10px] text-slate-500">脉冲</span>}
                  </td>
                  <td className={`py-2 pr-2 text-right text-base font-black ${scoreCls}`}>{s}</td>
                  <td className="py-2 pr-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${STAGE_COLOR[stage] ?? ""}`}>{stage}</span>
                  </td>
                  <td className="py-2 pr-2 text-right text-slate-300">{c.ztCount}只</td>
                  <td className="py-2 pr-2 text-right text-slate-300">{c.height}板</td>
                  <td className="py-2 pr-2 text-right text-slate-400">
                    {c.strengthFactors?.promotion != null ? `${c.strengthFactors.promotion}` : "—"}
                  </td>
                  <td className="py-2 pr-2 text-right text-slate-400">
                    {c.strengthFactors?.turnover != null ? `${c.strengthFactors.turnover}` : "—"}
                  </td>
                  <td className="py-2 pr-2 text-right">
                    <span className={c.mainNet >= 0 ? "text-rose-300" : "text-emerald-300"}>{fmtMoney(c.mainNet)}</span>
                    <span className="text-slate-600"> / </span>
                    <span className={c.mainNet5d >= 0 ? "text-rose-300/70" : "text-emerald-300/70"}>{fmtMoney(c.mainNet5d)}</span>
                  </td>
                  <td className="py-2 pr-2 text-slate-300">
                    {leader ? (
                      <a href={leader.code ? `https://quote.eastmoney.com/${leader.code.startsWith("6") ? "sh" : "sz"}${leader.code}.html` : "#"}
                        target="_blank" rel="noopener noreferrer" className="hover:text-amber-300">
                        {leader.name}<span className="text-slate-500">({leader.role})</span>
                      </a>
                    ) : "—"}
                  </td>
                  <td className="py-2 pr-2 max-w-[220px] text-slate-400" title={c.logic}>{c.logic || c.caution || "—"}</td>
                  {/* v9.26 F-12：数据完整度（缺失字段 → 置信度下调提示） */}
                  <td className="py-2 pr-2 text-right">
                    {c.strengthCompleteness != null ? (
                      <span className={c.strengthCompleteness >= 0.75 ? "text-emerald-300" : c.strengthCompleteness >= 0.5 ? "text-amber-300" : "text-rose-300"}
                        title={`缺失字段：${c.strengthMissing?.join("、") || "无"}`}>
                        {Math.round(c.strengthCompleteness * 100)}%
                      </span>
                    ) : "—"}
                  </td>
                  <td className="py-2">
                    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${badge.cls}`}>{badge.label}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[10px] text-slate-600">
          强度分 = 涨停占比25% + 连板20% + 晋级15% + 资金20% + 换手10% + 催化10%（版本 v1，PRD 6.1）
          · 完整度 = 非缺失因子占比（晋级率/10日资金/换手/催化剂 任一缺失即下调）
        </span>
        <DisclaimerTag />
      </div>
    </div>
  );
}
