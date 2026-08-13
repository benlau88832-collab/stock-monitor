// ============================================================
// v9.137.0（审查 P2-05 修复）：🎬 待你拍板任务条 —— 全站首个"AI 主动找用户确认"聚合入口
// 原状：AI 裁决（decision_log）与人类拍板（decision_post）是两条平行记录，无"未处理裁决"
//   聚合视图 → 用户拍板入口散落在裁决卡，盘后没有"AI 提议我还没拍板"的提醒，协同闭环缺
//   "待办"环节。
// 本组件：读当日 decision_log（AI/规则裁决）→ 与 decision_post 已拍板 refs 对比 → 未拍板的
//   裁决显示为任务条（主线/动作/置信/来源），点击跳转提示去裁决卡拍板；全部已拍或今日无
//   裁决 → 返回 null 不占版面。
// ============================================================
import { useState, useEffect } from "react";
import { localDateStr } from "../lib/format";
import { loadRecentPosts } from "../lib/decisionPost";

interface PendingVerdict {
  ts: string;
  mainline: string;
  action: string;
  confidence: number;
  source: string;
}

export default function PendingVerdictBar() {
  const [pending, setPending] = useState<PendingVerdict[]>([]);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () => {
      try {
        // 1. 当日 AI 裁决（decision_log:日期，localStorage）
        const key = `decision_log:${localDateStr()}`;
        const arr = JSON.parse(localStorage.getItem(key) ?? "[]") as Array<{
          ts: string; mainline?: string; action?: string; confidence?: number; source?: string;
        }>;
        // 2. 已拍板 refs（近 3 天，拍板幂等键 = 裁决 ts）
        const postedRefs = new Set(loadRecentPosts(3).map(p => p.decisionLogRef).filter(Boolean));
        // 3. 未拍板裁决 = 有 aiLogTs 语义（ts 匹配拍板 refs）且 action 明确的
        const unposted = arr
          .filter(x => x.ts && x.action && !postedRefs.has(x.ts))
          .map(x => ({
            ts: x.ts,
            mainline: x.mainline ?? "—",
            action: String(x.action),
            confidence: Number(x.confidence ?? 0),
            source: String(x.source ?? "AI"),
          }))
          .slice(0, 5); // 最多 5 条防刷屏
        if (alive) {
          setPending(unposted);
          setChecked(true);
        }
      } catch { /* localStorage 不可用静默 */ }
    };
    load();
    // 每 60s 刷新一次（盘后新裁决/拍板后消失）
    const t = setInterval(load, 60000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (!checked || pending.length === 0) return null;

  const colorOf = (a: string) =>
    a === "可上车" ? "text-emerald-300" : a === "禁止" ? "text-rose-300" : "text-amber-300";

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-950/15 p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-amber-300">🎬 待你拍板（{pending.length} 条 AI 裁决未表态）</span>
        <span className="text-[10px] text-slate-500">AI 仅提议，拍板才进闭环台账 · 裁决卡在下方</span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {pending.map(v => (
          <span key={v.ts} className="rounded bg-black/30 px-2 py-1 text-[11px] text-slate-300">
            {v.mainline}
            <b className={`ml-1 ${colorOf(v.action)}`}>{v.action}</b>
            <span className="ml-1 text-slate-500">置信{v.confidence}% · {v.source}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
