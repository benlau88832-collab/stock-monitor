import { useState, useEffect, useRef, useCallback } from "react";
import { callAI, type AIResult } from "../lib/ai";
import type { OverviewData, GlobalData, MainlineData } from "../App";
import { loadPrevTradingDaySentiment } from "../lib/sentimentStore";
import { buildThemeLadder, type ZTPoolItem } from "../lib/themeLadder";

// ============== 常量 ==============
const LOCK_TIME = "09:30";
const POST_MARKET_TIME = "15:05";
const PB_PREFIX = "playbook:";

// ============== 数据结构 ==============
interface PlaybookData {
  date: string;
  plan: string;
  executed: "yes" | "partial" | "no" | null;
  aiReview: string | null;
  aiReviewDegraded: boolean;
  updatedAt: string | null;
  aiPlanTime: string | null;      // AI 生成盘前剧本的时间 HH:MM
  aiPlanDegraded: boolean;        // 盘前剧本是否走了规则版
}

function emptyPlaybook(date: string): PlaybookData {
  return { date, plan: "", executed: null, aiReview: null, aiReviewDegraded: false, updatedAt: null, aiPlanTime: null, aiPlanDegraded: false };
}

// ============== 时间工具（北京时间） ==============
function getBJNow(): Date {
  const now = new Date();
  return new Date(now.getTime() + (now.getTimezoneOffset() + 480) * 60000);
}
function getBJHHMM(): string {
  const bj = getBJNow();
  return `${String(bj.getHours()).padStart(2, "0")}:${String(bj.getMinutes()).padStart(2, "0")}`;
}
function getBJDate(): string { return getBJNow().toISOString().slice(0, 10); }
function isWeekend(): boolean { const d = getBJNow().getDay(); return d === 0 || d === 6; }

// ============== localStorage ==============
function loadPlaybook(date: string): PlaybookData {
  try {
    const raw = localStorage.getItem(PB_PREFIX + date);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.assumption != null && parsed.plan == null) {
        parsed.plan = [parsed.assumption, parsed.conditions, parsed.redlines].filter(Boolean).join("；");
      }
      // 兼容旧数据缺字段
      return { ...emptyPlaybook(date), ...parsed };
    }
  } catch { /* ignore */ }
  return emptyPlaybook(date);
}

function savePlaybook(data: PlaybookData) {
  localStorage.setItem(PB_PREFIX + data.date, JSON.stringify(data));
}

function getWeekPlaybooks(): PlaybookData[] {
  const today = new Date(getBJDate() + "T00:00:00+08:00");
  const dayOfWeek = today.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(today.getTime() + mondayOffset * 86400000);
  const result: PlaybookData[] = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(monday.getTime() + i * 86400000);
    result.push(loadPlaybook(d.toISOString().slice(0, 10)));
  }
  return result;
}

// ============== AI 数据组装 ==============
// 从站内已有数据组装 preopenPlan payload（T-1 口径）
function buildPreopenPayload(
  overview: OverviewData | null,
  globalData: GlobalData | null,
): Parameters<typeof callAI<"preopenPlan">>[1] {
  const prev = loadPrevTradingDaySentiment();
  const pool = overview?.limitPool;
  const rawPool = pool?.rawZTPool as ZTPoolItem[] | undefined;
  const groups = rawPool ? buildThemeLadder(rawPool) : [];
  const top3 = groups.slice(0, 3).map(g => `${g.theme}(${g.height}板${g.count}只)`).join("、");

  // 公告★★★种子：从 localStorage 读当日缓存
  let annSeeds = "";
  try {
    const today = getBJDate();
    const annRaw = localStorage.getItem(`ann:${today}`);
    if (annRaw) {
      const { items } = JSON.parse(annRaw);
      const seeds = (items as any[]).filter(i => {
        const t = String(i.title || "");
        return /中标|涨价|投产|重组|实际控制人变更/.test(t);
      }).slice(0, 5);
      annSeeds = seeds.map((s: any) => `${s.stockName || ""}:${(s.title || "").slice(0, 25)}`).join("；") || "";
    }
  } catch { /* 无则省略 */ }

  // 隔夜外围
  let overnightSignals = "";
  if (globalData) {
    const sigs = globalData.globalSignals.slice(0, 5).map(g => `${g.name}${g.pct >= 0 ? "+" : ""}${g.pct.toFixed(2)}%`);
    const coms = globalData.commodities.slice(0, 3).map(c => `${c.name}${c.pct >= 0 ? "+" : ""}${c.pct.toFixed(2)}%`);
    overnightSignals = [...sigs, ...coms].join("、");
  }

  // 最高板
  let maxBoard = 1;
  if (pool?.boardCounts) {
    for (const k of Object.keys(pool.boardCounts)) {
      const n = Number(k);
      if (n > maxBoard) maxBoard = n;
    }
  }

  return {
    date: getBJDate(),
    sentiment: prev?.score ?? (overview?.sentiment ?? 50),
    sentimentLabel: prev ? (prev.score >= 80 ? "极度贪婪" : prev.score >= 65 ? "贪婪" : prev.score >= 45 ? "中性" : prev.score >= 25 ? "恐慌" : "极度恐慌") : (overview?.sentimentLabel ?? "中性"),
    limitUpCount: pool?.limitUpCount ?? 0,
    blastedRate: pool?.blastedRate ?? 0,
    maxBoard,
    ladderTop3: top3,
    annSeeds,
    overnightSignals,
  };
}

// 从站内已有数据组装 closeReview payload
function buildClosePayload(
  planText: string,
  overview: OverviewData | null,
  mainline: MainlineData | null,
  executed: string | null,
): Parameters<typeof callAI<"closeReview">>[1] {
  const pool = overview?.limitPool;
  // 梯队变化摘要
  const rawPool = pool?.rawZTPool as ZTPoolItem[] | undefined;
  const groups = rawPool ? buildThemeLadder(rawPool) : [];
  const ladderChange = groups.slice(0, 3).map(g => `${g.theme}(${g.height}板${g.count}只)`).join("、");
  // 主线板块涨跌
  const mainBoardPct = mainline?.boards.slice(0, 5).map(b => `${b.name}${b.pct >= 0 ? "+" : ""}${b.pct.toFixed(2)}%`).join("、") ?? "";
  // 警报记录
  let alertsLog = "";
  try {
    const mutedRaw = localStorage.getItem("alert_muted_today");
    if (mutedRaw) {
      const { ids } = JSON.parse(mutedRaw);
      alertsLog = (ids as string[]).join("、");
    }
  } catch { /* 无则空 */ }

  return {
    date: getBJDate(),
    planText,
    sentiment: overview?.sentiment ?? 50,
    limitUpCount: pool?.limitUpCount ?? 0,
    limitDownCount: pool?.limitDownCount ?? 0,
    blastedRate: pool?.blastedRate ?? 0,
    ladderChange,
    mainBoardPct,
    alertsLog,
    executed: executed || null,
  };
}

// ============== 从 AI 输出提取计划文本（填入预案本输入框） ==============
function extractPlanText(aiText: string): string {
  // 提取"出手条件"段的内容作为一句话预案
  const parts: string[] = [];
  const mainMatch = aiText.match(/【今日主线假设】([\s\S]*?)(?=【|$)/);
  if (mainMatch) parts.push(mainMatch[1].trim().split("\n")[0]);
  const condMatch = aiText.match(/【出手条件】([\s\S]*?)(?=【|$)/);
  if (condMatch) parts.push(condMatch[1].trim().split("\n")[0]);
  const riskMatch = aiText.match(/【风险红线】([\s\S]*?)(?=【|$)/);
  if (riskMatch) parts.push(riskMatch[1].trim().split("\n")[0]);
  return parts.join("；") || aiText.slice(0, 80);
}

// ============== 提取 AI 对照中的命中度 ==============
function extractHitRate(aiReview: string | null): string {
  if (!aiReview) return "—";
  const match = aiReview.match(/命中度[】\s]*(\d+\/\d+)/);
  return match ? match[1] : "—";
}

// ============== Props ==============
interface Props {
  sentiment?: number | null;
  limitUpCount?: number | null;
  blastedRate?: number | null;
  overview?: OverviewData | null;
  globalData?: GlobalData | null;
  mainline?: MainlineData | null;
}

export default function Playbook({ sentiment, limitUpCount, blastedRate, overview, globalData, mainline }: Props) {
  const today = getBJDate();
  const [data, setData] = useState<PlaybookData>(() => loadPlaybook(today));
  const [showWeek, setShowWeek] = useState(false);
  const [editing, setEditing] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [rateLimited, setRateLimited] = useState(false);
  const autoTriggeredRef = useRef(false);
  const reviewAutoRef = useRef(false);
  const hhmm = getBJHHMM();

  const weekend = isWeekend();
  const isLocked = !weekend && hhmm >= LOCK_TIME && hhmm < POST_MARKET_TIME;
  const isPostMarket = !weekend && hhmm >= POST_MARKET_TIME;
  const isPreopen = !weekend && hhmm >= "08:00" && hhmm < "09:25";

  // 持久化
  useEffect(() => { savePlaybook(data); }, [data]);

  // 刷新时钟
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick(v => v + 1), 60000); return () => clearInterval(t); }, []);

  // ============== 盘前剧本 AI ==============
  const generatePlan = useCallback(async () => {
    setAiLoading(true);
    setRateLimited(false);
    try {
      const payload = buildPreopenPayload(overview ?? null, globalData ?? null);
      const result: AIResult = await callAI("preopenPlan", payload);
      const now = getBJHHMM();
      setData(prev => {
        const updated = { ...prev };
        // AI 生成文本自动填入 plan（用户可以改）
        if (!prev.plan || prev.aiPlanTime) {
          updated.plan = extractPlanText(result.text);
        }
        updated.aiPlanTime = now;
        updated.aiPlanDegraded = result.degraded;
        updated.updatedAt = new Date().toISOString();
        return updated;
      });
      // 限速情况
      if (result.degraded && result.text.includes("每分钟限速")) {
        setRateLimited(true);
        setTimeout(() => setRateLimited(false), 60000);
      }
    } catch { /* callAI 内部已降级 */ }
    finally { setAiLoading(false); }
  }, [overview, globalData, mainline]);

  // 自动触发：8:00-9:25 首次打开驾驶舱且当日无缓存
  useEffect(() => {
    if (autoTriggeredRef.current || !isPreopen || data.aiPlanTime) return;
    autoTriggeredRef.current = true;
    generatePlan();
  }, [isPreopen, data.aiPlanTime, generatePlan]);

  // ============== 盘后对照 AI ==============
  const generateReview = useCallback(async () => {
    setReviewLoading(true);
    try {
      const payload = buildClosePayload(data.plan, overview ?? null, mainline ?? null, data.executed);
      const result: AIResult = await callAI("closeReview", payload);
      setData(prev => ({
        ...prev,
        aiReview: result.text,
        aiReviewDegraded: result.degraded,
        updatedAt: new Date().toISOString(),
      }));
    } catch { /* callAI 内部已降级 */ }
    finally { setReviewLoading(false); }
  }, [data.plan, data.executed, overview, mainline]);

  // 自动触发：15:05 后首次打开
  useEffect(() => {
    if (reviewAutoRef.current || !isPostMarket || data.aiReview) return;
    reviewAutoRef.current = true;
    generateReview();
  }, [isPostMarket, data.aiReview, generateReview]);

  const weekPlaybooks = showWeek ? getWeekPlaybooks() : [];

  // ============== 渲染 ==============
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-2" style={{ minHeight: 80 }}>
      {/* 标题栏 */}
      <div className="flex items-center justify-between">
        <div className="text-xs font-bold text-slate-300">
          📋 今日预案
          {isLocked && <span className="ml-1 text-amber-400 font-normal">（开盘后只读）</span>}
          {isPostMarket && <span className="ml-1 text-emerald-400 font-normal">盘后对照</span>}
          {data.aiPlanTime && (
            <span className={`ml-2 text-[11px] font-normal ${data.aiPlanDegraded ? "text-amber-400" : "text-violet-400"}`}>
              {data.aiPlanDegraded ? "规则版" : `AI生成 ${data.aiPlanTime}`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* 重新生成按钮：盘前可用 */}
          {!isLocked && !isPostMarket && (
            <button
              onClick={generatePlan}
              disabled={aiLoading || rateLimited}
              className="rounded px-2 py-0.5 text-[11px] bg-violet-500/10 text-violet-300 hover:bg-violet-500/20 border border-violet-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {aiLoading ? "生成中…" : rateLimited ? "请求过频，稍候" : "🤖 生成剧本"}
            </button>
          )}
          <span className="text-[11px] text-slate-600">{today}</span>
        </div>
      </div>

      {/* 盘后对照模式 */}
      {isPostMarket ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded bg-black/20 p-2">
              <div className="text-slate-500 mb-1">预案</div>
              <div className="text-slate-200">{data.plan || "未填写"}</div>
            </div>
            <div className="rounded bg-black/20 p-2">
              <div className="text-slate-500 mb-1">实际</div>
              <div className="text-slate-300">
                情绪{sentiment ?? "—"} · 涨停{limitUpCount ?? "—"} · 炸板{blastedRate != null ? `${blastedRate.toFixed(0)}%` : "—"}
              </div>
            </div>
          </div>

          {/* 执行度 */}
          <div className="flex items-center gap-2 text-[11px]">
            <span className="text-slate-500">执行：</span>
            {(["yes", "partial", "no"] as const).map(v => (
              <button key={v} onClick={() => setData(prev => ({ ...prev, executed: v }))}
                className={`rounded px-2 py-0.5 ${data.executed === v ? "bg-amber-500/30 text-amber-300" : "bg-white/5 text-slate-500"}`}>
                {v === "yes" ? "是" : v === "partial" ? "部分" : "否"}
              </button>
            ))}
          </div>

          {/* AI 对照按钮 */}
          <button
            onClick={generateReview}
            disabled={reviewLoading}
            className="rounded px-2 py-0.5 text-[11px] bg-violet-500/10 text-violet-300 hover:bg-violet-500/20 border border-violet-500/20 disabled:opacity-40"
          >
            {reviewLoading ? "生成中…" : data.aiReview ? "🤖 重新生成对照" : "🤖 生成今日对照"}
          </button>

          {/* AI 对照结果 */}
          {data.aiReview && (
            <div className={`rounded-lg border p-2 text-[11px] leading-relaxed whitespace-pre-wrap ${
              data.aiReviewDegraded ? "border-amber-500/30 bg-amber-500/5 text-amber-200" : "border-violet-500/30 bg-violet-500/5 text-slate-200"
            }`}>
              {data.aiReviewDegraded && (
                <span className="inline-block rounded px-1 py-0.5 text-[9px] font-bold bg-amber-500/20 text-amber-300 mb-1">规则版</span>
              )}
              {data.aiReview}
            </div>
          )}
        </div>
      ) : (
        /* 编辑态 */
        <div>
          {editing || !data.plan ? (
            <input
              autoFocus
              value={data.plan}
              onChange={e => setData(prev => ({ ...prev, plan: e.target.value }))}
              onBlur={() => setEditing(false)}
              disabled={isLocked}
              placeholder="一句话写预案，如：主线AI算力，若光模块板块>3%半仓跟，亏5%无条件止损"
              className="w-full rounded bg-black/30 border border-amber-500/20 px-2 py-1.5 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-amber-400/50 disabled:opacity-50 disabled:cursor-not-allowed"
            />
          ) : (
            <div
              onClick={() => !isLocked && setEditing(true)}
              className={`rounded bg-black/20 px-2 py-1.5 text-xs cursor-pointer hover:bg-black/30 ${isLocked ? "cursor-not-allowed opacity-50" : ""}`}>
              <span className="text-slate-200">{data.plan}</span>
            </div>
          )}
        </div>
      )}

      {/* 周视图 */}
      <button onClick={() => setShowWeek(v => !v)} className="text-[11px] text-amber-400 hover:text-amber-300">
        {showWeek ? "收起" : "本周"}
      </button>
      {showWeek && (
        <div className="border-t border-white/10 pt-1 space-y-0.5">
          <div className="flex items-center gap-2 text-[11px] text-slate-600 pb-0.5">
            <span className="w-12 shrink-0">日期</span>
            <span className="flex-1">预案</span>
            <span className="w-10 text-center shrink-0">执行</span>
            <span className="w-10 text-center shrink-0">命中</span>
          </div>
          {weekPlaybooks.map(pb => (
            <div key={pb.date} className={`flex items-center gap-2 text-[11px] py-0.5 ${pb.date === today ? "text-amber-300" : "text-slate-500"}`}>
              <span className="w-12 shrink-0">{pb.date.slice(5)}</span>
              <span className="flex-1 truncate">{pb.plan || "—"}</span>
              <span className="w-10 text-center shrink-0">
                {pb.executed === "yes" ? "✅" : pb.executed === "partial" ? "⚠️" : pb.executed === "no" ? "❌" : "—"}
              </span>
              <span className="w-10 text-center shrink-0 text-violet-400">
                {extractHitRate(pb.aiReview)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
