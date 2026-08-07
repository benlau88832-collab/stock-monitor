// ============================================================
// v9.38.1（V3-12）：事件三级分类面板 —— 政策/行业/事件三级研判
// 游资逻辑：同一事件 → 判断是"政策级(全市场)/行业级(产业链)/事件级(个股)"，
//   再按催化强度 + 受益板块决定是否值得跟踪（对接 decisionBus 消息面证据源）。
// 数据：kv event_classify:日期（cron 15:40 盘后 LLM 批量分级落库）
// v11-5（P1）：移回驾驶舱（决策区下方）+ 增强 —— 可点击跳消息面 / 力度★ / 影响方向 / 受益个股数
// v12-5（P1）：盘中实时化 —— 盘后 kv 未生成时，用本地快讯流（getAllSince 今日）关键词轻量分级，不等盘后 LLM
// ============================================================
import { useState, useEffect } from "react";
import { isLocalServer, kvGet } from "../lib/cloudStore";
import { getAllSince } from "../lib/dataStore";
import DisclaimerTag from "./DisclaimerTag";

interface ClassifiedEvent {
  title: string;
  level: "政策" | "行业" | "事件";
  beneficiaries: string[];
  catalystScore: number;
  timeSensitivity: string;
  reason: string;
}

const LEVEL_META: Record<string, { label: string; color: string }> = {
  政策: { label: "🏛️ 政策级", color: "bg-rose-500/20 text-rose-300 border-rose-500/40" },
  行业: { label: "🏭 行业级", color: "bg-amber-500/20 text-amber-300 border-amber-500/40" },
  事件: { label: "⚡ 事件级", color: "bg-sky-500/20 text-sky-300 border-sky-500/40" },
};

// ============== v12-5（P1）：盘中快讯轻量分级（游资视角，不等盘后 LLM） ==============
// 政策级（红 ★★★）：国家部委 → 全市场；行业级（橙 ★★）：产业链/供需 → 板块；事件级（蓝 ★）：个股公告/业绩
const POLICY_RE = /国务院|央行|证监会|发改委|财政部|国常会|工信部|商务部|税务总局|金融监管总局|中央|部委|政府工作/;
const INDUSTRY_RE = /产业链|技术突破|供需|涨价|降价|景气|规划|峰会|出口|产量|开工|招标|落地|试点|方案|产业|行业|政策/;
const EVENT_RE = /业绩|预增|预减|中标|签订|合同|增持|减持|回购|重组|收购|定增|公告|披露|新品|订单|投产|获批|涨停|异动/;
function classifyLive(title: string): { level: "政策" | "行业" | "事件"; catalystScore: number } | null {
  if (POLICY_RE.test(title)) return { level: "政策", catalystScore: 72 };
  if (INDUSTRY_RE.test(title)) return { level: "行业", catalystScore: 52 };
  if (EVENT_RE.test(title)) return { level: "事件", catalystScore: 38 };
  return null;
}

// v11-5：影响方向推断（利好↑/利空↓/中性）—— 从标题关键词轻量判断（数据无 direction 字段）
const BULL_RE = /利好|增长|提价|涨价|中标|获批|突破|加速|扩大|支持|加码|回购|增持|落地|提速|超预期/;
const BEAR_RE = /利空|下跌|下滑|亏损|减持|处罚|立案|退市|下调|终止|延期|不及预期|暴雷/;
function directionOf(title: string): "利好" | "利空" | "中性" {
  if (BEAR_RE.test(title)) return "利空";
  if (BULL_RE.test(title)) return "利好";
  return "中性";
}

function ScoreBadge({ s }: { s: number }) {
  const cls = s >= 65 ? "bg-rose-500/25 text-rose-300" : s >= 40 ? "bg-amber-500/25 text-amber-300" : "bg-slate-500/25 text-slate-400";
  // v11-5：力度 ★（分数 → 1-3★）
  const stars = s >= 65 ? "★★★" : s >= 40 ? "★★" : "★";
  return <span className={`rounded px-1 py-0.5 text-[10px] font-bold ${cls}`} title={`催化 ${s} 分`}>{stars}</span>;
}

export default function EventClassifyPanel({ onOpenNews }: { onOpenNews?: () => void }) {
  const [items, setItems] = useState<ClassifiedEvent[] | null>(null);
  const [date, setDate] = useState("");

  useEffect(() => {
    if (!isLocalServer()) return;
    let alive = true;
    (async () => {
      try {
        // ① 盘后 LLM 分级（kv event_classify:日期）—— 有则用
        for (let i = 0; i < 3; i++) {
          const d = new Date();
          d.setDate(d.getDate() - i);
          const key = `event_classify:${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          const v = (await kvGet(key)) as { date?: string; items?: ClassifiedEvent[] } | null;
          if (v && Array.isArray(v.items) && v.items.length > 0) {
            if (alive) { setItems(v.items!); setDate(v.date ?? ""); }
            return;
          }
        }
        // ② v12-5（P1）：盘中 kv 未生成 → 用今日快讯流轻量分级（不等盘后 15:40）
        const today = new Date();
        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
        const { news } = getAllSince(todayStr);
        const live: ClassifiedEvent[] = [];
        for (const n of news) {
          if (n.isOverseas) continue; // 海外快讯不参与事件分级
          const cls = classifyLive(n.title ?? "");
          if (cls) {
            live.push({
              title: n.title,
              level: cls.level,
              beneficiaries: Array.isArray(n.boards) ? n.boards.slice(0, 3) : [],
              catalystScore: cls.catalystScore,
              timeSensitivity: "盘中实时",
              reason: "盘中快讯轻量分级（关键词匹配，盘后 LLM 分级将覆盖）",
            });
            if (live.length >= 18) break; // 最多 18 条
          }
        }
        if (alive) {
          if (live.length > 0) { setItems(live); setDate(`${todayStr}（盘中实时）`); }
          else setItems([]);
        }
      } catch { if (alive) setItems([]); }
    })();
    return () => { alive = false; };
  }, []);

  if (items === null || items.length === 0) return null;

  const order = ["政策", "行业", "事件"] as const;
  const grouped = order
    .map(lv => ({ lv, list: items.filter(i => i.level === lv).sort((a, b) => b.catalystScore - a.catalystScore) }))
    .filter(g => g.list.length > 0);

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-200">📡 今日事件三级研判</span>
          {date && <span className="text-[10px] text-slate-500">{date}</span>}
          <span className="text-[10px] text-slate-500">{items.length} 事件</span>
          <DisclaimerTag />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {grouped.map(({ lv, list }) => {
          const meta = LEVEL_META[lv];
          return (
            <div key={lv} className="rounded border border-white/5 bg-black/20 p-2 space-y-1">
              <div className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-bold ${meta.color}`}>
                {meta.label}（{list.length}）
              </div>
              {list.slice(0, 6).map((e, i) => {
                const dir = directionOf(e.title);
                const dirCls = dir === "利好" ? "text-emerald-300" : dir === "利空" ? "text-rose-300" : "text-slate-500";
                return (
                <div key={i} className="text-xs leading-snug border-b border-white/5 pb-1 last:border-0">
                  <div className="flex items-start justify-between gap-1">
                    {/* v11-5：事件可点击 → 跳消息面 Tab 查看详情 */}
                    <span
                      className={`text-slate-300 flex-1 cursor-pointer hover:text-slate-100 ${onOpenNews ? "" : ""}`}
                      title={`${e.timeSensitivity ?? ""} · ${e.reason ?? ""}${onOpenNews ? "\n点击跳转消息面查看详情" : ""}`}
                      onClick={onOpenNews}
                    >
                      {e.title.length > 34 ? e.title.slice(0, 34) + "…" : e.title}
                    </span>
                    <span className={`shrink-0 text-[10px] font-bold ${dirCls}`}>{dir === "利好" ? "↑" : dir === "利空" ? "↓" : "→"}</span>
                    <ScoreBadge s={e.catalystScore} />
                  </div>
                  {e.beneficiaries && e.beneficiaries.length > 0 && (
                    <div className="text-xs text-slate-500 mt-0.5">
                      → {e.beneficiaries.slice(0, 3).join(" / ")}
                      <span className="text-slate-600">（{e.beneficiaries.length} 受益）</span>
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="text-xs text-slate-600">
        💡 政策级（全市场）&gt; 行业级（产业链）&gt; 事件级（个股）；高分事件可在 Agent 深审中点"事件深挖"看影响传导
      </div>
    </div>
  );
}
