// ============================================================
// v9.38.1（V3-12）：事件三级分类面板 —— 政策/行业/事件三级研判
// 游资逻辑：同一事件 → 判断是"政策级(全市场)/行业级(产业链)/事件级(个股)"，
//   再按催化强度 + 受益板块决定是否值得跟踪（对接 decisionBus 消息面证据源）。
// 数据：kv event_classify:日期（cron 15:40 盘后 LLM 批量分级落库）
// v11-5（P1）：移回驾驶舱（决策区下方）+ 增强 —— 可点击跳消息面 / 力度★ / 影响方向 / 受益个股数
// v12-5（P1）：盘中实时化 —— 盘后 kv 未生成时，用本地快讯流（getAllSince 今日）关键词轻量分级，不等盘后 LLM
// ============================================================
import { useState, useEffect, useRef } from "react";
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

export default function EventClassifyPanel({ onOpenNews }: {
  onOpenNews?: () => void;
}) {
  const [items, setItems] = useState<ClassifiedEvent[] | null>(null);
  const [date, setDate] = useState("");
  // v13-4（P0）：新闻驱动作战管线结果（theme_analysis:latest）—— 有则优先展示管线视图
  const [analysis, setAnalysis] = useState<any | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  // 上一轮 heat 对比（热度箭头 🔥/❄️/🆕）—— 组件内缓存上次的 heat map
  const prevHeatRef = useRef<Map<string, number> | null>(null);

  // v13-4：加载最新 theme_analysis + 30 分钟自动刷新
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r: any = await kvGet("theme_analysis:latest");
        if (r && Array.isArray(r.themes) && r.themes.length > 0 && alive) {
          const next = new Map<string, number>(r.themes.map((t: any) => [t.theme, t.heat] as [string, number]));
          const prev = prevHeatRef.current;
          const withDelta = r.themes.map((t: any) => {
            let delta: string | null = null;
            if (!prev) delta = "🆕";
            else {
              const p = prev.get(t.theme);
              if (p == null) delta = "🆕";
              else if (t.heat - p >= 10) delta = `🔥+${t.heat - p}`;
              else if (p - t.heat >= 10) delta = `❄️-${p - t.heat}`;
              else delta = "➖";
            }
            return { ...t, delta };
          });
          prevHeatRef.current = next;
          setAnalysis({ ...r, themes: withDelta });
        }
      } catch { /* 无管线结果 → 保持事件研判视图 */ }
    };
    load();
    const t = setInterval(load, 30 * 60 * 1000); // 30 分钟自动刷新
    return () => { alive = false; clearInterval(t); };
  }, []);

  // v13-4：🔄 立即分析（手动触发一轮管线）
  const triggerNow = async () => {
    setTriggering(true);
    try {
      const r = await fetch("/api/theme-analysis/trigger", { method: "POST" });
      if (r.ok) {
        const j = await r.json();
        if (j.result && Array.isArray(j.result.themes)) {
          prevHeatRef.current = new Map<string, number>(j.result.themes.map((t: any) => [t.theme, t.heat] as [string, number]));
          setAnalysis({ ...j.result, themes: j.result.themes.map((t: any) => ({ ...t, delta: "🆕" })) });
        }
      }
    } catch { /* 静默 */ }
    setTriggering(false);
  };

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

  // ============== v13-4（P0）：管线视图优先 ==============
  if (analysis) {
    const top3 = analysis.themes.slice(0, 3);
    const risks = analysis.themes.filter((t: any) => t.verdict === "风险警示");
    const rest = analysis.themes.slice(3);
    const showThemes = showAll ? analysis.themes : top3;
    return (
      <div className="rounded-xl border border-rose-500/25 bg-rose-950/10 p-3 space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-slate-200">📡 新闻驱动·热点主题作战</span>
            {analysis.time && (
              <span className="text-[10px] text-slate-500">
                最新 {analysis.time} · {analysis.round === "手动" ? "手动" : analysis.round}
              </span>
            )}
            <DisclaimerTag />
          </div>
          {/* 🔄 立即分析（手动触发一轮管线，不等 30 分钟 cron） */}
          <button onClick={triggerNow} disabled={triggering}
            className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs font-bold text-amber-300 hover:bg-amber-500/20 disabled:opacity-50">
            {triggering ? "🤖 分析中…" : "🔄 立即分析"}
          </button>
        </div>

        {/* TOP 主题（默认 3，全部可展开）—— v13-6：整行点击展开/收起，展开显示新闻+选股+ETF */}
        {showThemes.map((t: any) => {
          const isExpanded = expanded === t.theme;
          const hasDetail = (t.evidence?.length ?? 0) + (t.picks?.length ?? 0) + (t.etfs?.length ?? 0) > 0;
          return (
          <div key={t.theme} className="rounded-lg border border-white/10 bg-black/20 p-2.5 space-y-1">
            {/* 主行：点击展开/收起（始终可见） */}
            <div className="flex items-center gap-2 flex-wrap cursor-pointer select-none"
              onClick={() => hasDetail && setExpanded(isExpanded ? null : t.theme)}>
              <span className="text-xs text-slate-500 w-3">{hasDetail ? (isExpanded ? "▾" : "▸") : ""}</span>
              <span className={`rounded px-1.5 py-0.5 text-xs font-black ${
                t.verdict === "领涨龙头" ? "bg-rose-500/20 text-rose-300"
                : t.verdict === "风险警示" ? "bg-red-500/20 text-red-300"
                : t.verdict === "潜力起爆" ? "bg-emerald-500/20 text-emerald-300"
                : "bg-amber-500/15 text-amber-300"
              }`}>
                {t.verdict === "领涨龙头" ? "🏛️" : t.verdict === "风险警示" ? "🚫" : t.verdict === "潜力起爆" ? "⚡" : "👀"} {t.theme}
              </span>
              {/* 热度条 */}
              <span className="h-1.5 w-20 rounded bg-white/10 overflow-hidden inline-block align-middle">
                <span className="block h-full rounded bg-rose-500/70" style={{ width: `${t.heat}%` }} />
              </span>
              <span className="text-xs font-black text-slate-200">{t.heat}分</span>
              {/* 热度变化箭头（与上一轮对比） */}
              {t.delta && (
                <span className={`text-xs font-bold ${
                  t.delta.startsWith("🔥") ? "text-rose-300" : t.delta.startsWith("❄️") ? "text-emerald-300" : "text-slate-500"
                }`}>{t.delta}</span>
              )}
              <span className="text-xs text-slate-500">{t.fundAnalysis ?? ""}</span>
              {/* 角标：新闻/选股/ETF 数量（V13-6） */}
              {(t.picks?.length ?? 0) > 0 && (
                <span className="rounded bg-rose-500/10 px-1 py-0.5 text-xs text-rose-300">🎯{t.picks.length}</span>
              )}
              {(t.etfs?.length ?? 0) > 0 && (
                <span className="rounded bg-cyan-500/10 px-1 py-0.5 text-xs text-cyan-300">📊{t.etfs.length}</span>
              )}
            </div>
            <div className="text-xs text-amber-200/80">{t.action ?? ""}</div>

            {/* 展开区域（V13-6）：📰 新闻（可点击）+ 🎯 选股（可点击+关联%）+ 📊 ETF（可点击） */}
            {isExpanded && (
              <div className="mt-1.5 space-y-2 border-t border-white/5 pt-1.5">
                {/* 📰 支撑新闻（可点击跳东财原文） */}
                {t.evidence && t.evidence.length > 0 && (
                  <div className="space-y-0.5">
                    <div className="text-xs font-bold text-slate-300">📰 支撑新闻</div>
                    {t.evidence.map((ev: any, j: number) => (
                      <div key={j} className="text-xs leading-snug">
                        {ev.url ? (
                          <a href={ev.url} target="_blank" rel="noopener noreferrer"
                            className="text-sky-400 hover:text-sky-300 underline">
                            • {ev.title}
                          </a>
                        ) : (
                          <span className="text-slate-400">• {ev.title}</span>
                        )}
                        {ev.time && <span className="text-slate-600 ml-1">{String(ev.time).slice(11, 16)}</span>}
                      </div>
                    ))}
                  </div>
                )}

                {/* 🎯 高关联标的（LLM 验证关联度，可点击跳东财个股） */}
                {t.picks && t.picks.length > 0 && (
                  <div className="space-y-0.5">
                    <div className="text-xs font-bold text-slate-300">🎯 高关联标的（LLM 验证）</div>
                    {t.picks.map((p: any, j: number) => (
                      <div key={j} className="flex items-center gap-2 text-xs flex-wrap">
                        <span className={`rounded px-1 py-0.5 font-bold ${
                          p.role === "首选" ? "bg-rose-500/20 text-rose-300" : "bg-amber-500/20 text-amber-300"
                        }`}>{p.role}</span>
                        <a href={`https://quote.eastmoney.com/${String(p.code).startsWith("6") ? "sh" : "sz"}${p.code}.html`}
                          target="_blank" rel="noopener noreferrer"
                          className="font-bold text-slate-100 hover:text-amber-300">
                          {p.name}
                        </a>
                        <span className="text-slate-600">{p.code}</span>
                        <span className="text-emerald-400">关联{Math.round((p.correlation ?? 0) * 100)}%</span>
                        <span className={`rounded px-1 font-bold ${
                          p.aiVerdict === "可买" ? "text-emerald-300" : p.aiVerdict === "回避" ? "text-rose-300" : "text-amber-300"
                        }`}>{p.aiVerdict ?? "谨慎"}</span>
                        <span className="text-slate-500 truncate flex-1 min-w-[120px]">{p.buyTrigger}</span>
                        <span className="text-emerald-400/60">止损 {p.stopLoss}</span>
                        <span className="text-rose-300/60">风险 {p.risk}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* 📊 关联 ETF（可点击跳东财 ETF 详情） */}
                {t.etfs && t.etfs.length > 0 && (
                  <div className="space-y-0.5">
                    <div className="text-xs font-bold text-slate-300">📊 关联 ETF</div>
                    {t.etfs.map((e: any, j: number) => (
                      <div key={j} className="flex items-center gap-2 text-xs">
                        <a href={`https://quote.eastmoney.com/${String(e.code).startsWith("5") ? "sh" : "sz"}${e.code}.html`}
                          target="_blank" rel="noopener noreferrer"
                          className="text-cyan-300 hover:text-cyan-200 underline">
                          {e.name}({e.code})
                        </a>
                        <span className="text-slate-500">匹配{e.matchScore ?? e.score ?? 0}%</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          );
        })}

        {/* L3 折叠：全部主题 / 风险警示 */}
        <div className="flex items-center gap-2 flex-wrap text-xs">
          {rest.length > 0 && (
            <button onClick={() => setShowAll(v => !v)} className="rounded bg-white/5 px-1.5 py-0.5 text-slate-400 hover:text-slate-200">
              📋 全部主题({analysis.themes.length}) {showAll ? "▴" : "▾"}
            </button>
          )}
          {risks.length > 0 && (
            <button onClick={() => setExpanded(expanded === "__risks" ? null : "__risks")}
              className="rounded bg-red-500/10 px-1.5 py-0.5 font-bold text-red-300 hover:bg-red-500/20">
              🚫 风险警示({risks.length}) {expanded === "__risks" ? "▴" : "▾"}
            </button>
          )}
          <span className="text-slate-600">每 30 分钟自动分析 · 点击"立即分析"即时刷新</span>
        </div>
        {expanded === "__risks" && risks.length > 0 && (
          <div className="space-y-1 rounded border border-red-500/20 bg-red-500/5 p-2">
            {risks.map((t: any) => (
              <div key={t.theme} className="text-xs text-red-300/80">
                🚫 {t.theme}（{t.heat}分）{t.fundAnalysis ?? ""} · {t.action ?? ""}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

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
