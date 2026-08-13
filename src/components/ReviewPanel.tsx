// 每日复盘卡片（v9.19-F10）
// 收盘后引导填写：今日主线/龙头/参与个股/盈亏/一句话反思
// 支持按题材检索 + 题材盈亏统计（沉淀打法体系）
// v9.33（缺口2）：新增服务端自动复盘展示 + 历史回放（本地部署 /api/db/kv + /api/db/zt）
// v9.84.2（AI大脑层 · 3.5）：接线 dailyReviewAuto 死任务 —— "立即 AI 复盘"按钮，
//   用大脑快照真实数据喂前端模板生成复盘（不等 cron 15:40），结果并入本地复盘库
// v9.94.1（第四段·复盘重构）：服务端复盘升级 13 维度结构化（tdxclaw 式）——
//   展示"数据表格（dimensions）+ AI 研判文本"双区；无 dimensions 时回退纯文本
import { useState, useEffect, useRef } from "react";
import { loadReviews, saveReviews, upsertReview, searchReviews, statByMainline, computeLossStreak, type DailyReview } from "../lib/dailyReview";
import { localDateStr } from "../lib/format";
import { getCurrentSession } from "../lib/tradingSession";
import { isLocalServer } from "../lib/cloudStore";
import { callAI } from "../lib/ai";
import { fetchBrainContext } from "../lib/assistantAgent";
import { apiFetch } from "../lib/cloudStore";
import { exportElementAsPng } from "../lib/exportImage"; // v9.99.1（批次 5-3）：导出通用化（与情绪报告共用）

// v9.94.1：13 维度结构化复盘类型（与服务端 cron.generateDailyReview 的 dimensions 对齐）
interface ReviewDimensions {
  d0?: { date?: string; generatedAt?: string; sources?: Record<string, unknown> };
  d2?: { fundBoards?: Array<{ name: string; mainNet: number }>; stockFundTop?: Array<{ name: string; code: string; fund: number; pct?: number }> };
  d3?: { limitUp?: number; ladder?: Array<{ name: string; lbc: number; hybk?: string; pct?: number }>; blasted?: Array<unknown> };
  d4?: { boards?: Array<{ name: string; count: number; pct?: number; leaders?: string; maxLbc?: number }> };
  d5?: { catalysts?: Array<{ kw: string; count: number }> };
  d6?: { anomalies?: Array<{ name: string; reason: string; note?: string }> };
  d7?: { anns?: Array<{ name?: string; title?: string; score?: number | null }> };
  d8?: { lhb?: Array<{ name?: string; code?: string; netBuy?: number; pct?: number }> };
  d9?: { watch?: Array<{ code: string; name?: string; pct?: number | null; lbc?: number }> };
  d10?: { events?: Array<{ title?: string; name?: string; level?: string }> };
  d11?: { picks?: Array<{ name?: string; code?: string; fund?: number }> };
  d12?: { text?: string };
}
interface AutoReview { date: string; text: string; dimensions?: ReviewDimensions }

const fmtYi = (n?: number) => (n == null ? "-" : `${(n / 1e8).toFixed(1)}亿`);

// v9.100.0（P1-04）：本地复盘条目"内容生成日"（本地时区 YYYY-MM-DD）—— 校验条目 date 是否被跨日错位写入
const createdLocalDate = (ts: number | undefined): string | null => {
  if (!ts) return null;
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// v9.101.0（P1-04 返工）：跨日错位判定（任一命中 → "⚠跨日"角标）——
//   ① dataDate（AI 复盘记录的大脑快照日期）≠ 条目日期（验收根因：08-11 02:22 生成、内容实为 08-10 收盘数据）
//   ② createdAt 日期 ≠ 条目日期（原判据）
//   ③ 存量错位启发式：凌晨 <9 点生成 + 长文本含"【"（AI 四段标题特征）→ 内容为昨日收盘数据
//     （覆盖验收 1786386148479=08-11 02:22 且无 dataDate 的旧条目）
const crossDayReview = (r: DailyReview): string | null => {
  if (r.dataDate && r.dataDate !== r.date) return `内容数据日期 ${r.dataDate} ≠ 条目日期 ${r.date}`;
  const cd = createdLocalDate(r.createdAt);
  if (cd != null && cd !== r.date) return `内容生成于 ${cd}，与条目日期 ${r.date} 不一致（跨日时段生成）`;
  if (r.createdAt) {
    const h = new Date(r.createdAt).getHours();
    if (h < 9 && r.reflection && r.reflection.length > 50 && r.reflection.includes("【")) {
      return `凌晨 ${h} 点生成的 AI 复盘文本，内容为昨日收盘数据（条目日期 ${r.date}）`;
    }
  }
  return null;
};

export default function ReviewPanel() {
  const [reviews, setReviews] = useState<DailyReview[]>(loadReviews);
  const [keyword, setKeyword] = useState("");
  const [mainline, setMainline] = useState("");
  const [leader, setLeader] = useState("");
  const [myStocks, setMyStocks] = useState("");
  const [pnl, setPnl] = useState("");
  const [reflection, setReflection] = useState("");
  const [showForm, setShowForm] = useState(false);
  // v9.33（缺口2）：自动复盘 + 历史回放
  const [autoReview, setAutoReview] = useState<AutoReview | null>(null);
  const [replayDate, setReplayDate] = useState<string>(localDateStr());
  const [replayText, setReplayText] = useState<string | null>(null);
  // v9.84.2（3.5）：立即 AI 复盘（dailyReviewAuto 前端模板 + 大脑快照真实数据）
  const [aiReviewing, setAiReviewing] = useState(false);

  // v9.99.1（批次 5-3）：导出复盘卡为 PNG（html2canvas 共用工具，与情绪报告同实现）
  const [exporting, setExporting] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  const exportPng = async () => {
    if (!exportRef.current || exporting) return;
    setExporting(true);
    try {
      await exportElementAsPng(exportRef.current, `复盘记录-${localDateStr()}.png`);
    } catch (e) { console.warn("[review] 导出失败:", e); }
    setExporting(false);
  };

  // 🤖 立即 AI 复盘：大脑快照（情绪/涨停/主线/黑天鹅/强催化）→ 前端模板 → 结果并入本地复盘库
  // v9.99.2（C3）：服务端复盘触发 —— /api/review/trigger 此前前端零调用，自动复盘区只能被动看 cron 15:40 结果；
  //   盘前/盘中想看"今日服务端复盘"没有入口。接线已有端点：POST → 轮询 review:今天（13 维结构化）
  const [serverReviewing, setServerReviewing] = useState(false);
  const triggerServerReview = async () => {
    if (serverReviewing) return;
    setServerReviewing(true);
    try {
      const r = await fetch("/api/review/trigger", { method: "POST" });
      if (!r.ok) return;
      const today = localDateStr();
      for (let i = 0; i < 12; i++) {
        await new Promise(res => setTimeout(res, 5000));
        try {
          const resp = await fetch(`/api/db/kv?key=${encodeURIComponent(`review:${today}`)}`);
          const j = await resp.json();
          const v = j?.value;
          if (v && (v.text || v.dimensions)) {
            setAutoReview({ date: today, text: v.text ?? "", dimensions: v.dimensions });
            break;
          }
        } catch { /* 轮询单次失败继续 */ }
      }
    } catch { /* 触发失败静默 */ }
    setServerReviewing(false);
  };

  const runAIReview = async () => {
    if (aiReviewing) return;
    setAiReviewing(true);
    try {
      const brain = await fetchBrainContext(true);
      const m = brain?.market ?? ({} as NonNullable<NonNullable<Awaited<ReturnType<typeof fetchBrainContext>>>["market"]>);
      const top = brain?.mainlines?.top ?? [];
      const ladder = brain?.limitLadder?.ladder ?? [];
      const r = await callAI("dailyReviewAuto", {
        date: localDateStr(),
        mainlines: top.map(t => `${t.theme}(${t.heat ?? "?"}分)`).join("、") || "暂无",
        topStocks: ladder.slice(0, 8).map(x => `${x.name ?? x.code}(${x.lbc}板)`).join("、") || "暂无",
        missedThemes: "",
        sentiment: m.sentiment ?? 50,
        blastedRate: m.blastedRate ?? 0,
        blackSwans: (brain?.blackSwans ?? []).slice(0, 3).map(b => b.title).join("；") || "无",
        annHighlights: (brain?.strongNews ?? []).slice(0, 3).map(a => `${a.name ?? ""}${a.title}`).join("；") || "无",
        userReview: todayReview?.reflection ?? "",
      });
      if (!r.text) return;
      setAutoReview({ date: localDateStr(), text: r.text });
      // v9.99.2（B5）：降级（规则版）文本只展示、不写入本地复盘库 —— 原实现把"⚡ 规则版"兜底文本
      //   upsertReview 持久化为正式"今日复盘"，规则内容污染复盘库/题材统计
      if (!todayReview && !r.degraded) {
        const review: DailyReview = {
          date: today, mainline: top[0]?.theme ?? "—", leader: ladder[0]?.name ?? "",
          myStocks: "", pnl: null, reflection: r.text.slice(0, 200), createdAt: Date.now(),
          // v9.101.0（P1-04 返工）：记录大脑快照数据日期 —— 凌晨跨日时快照是昨日收盘数据，
          //   dataDate=昨日 → 展示"⚠跨日"角标（验收：08-11 02:22 生成的内容实为 08-10 数据）
          dataDate: brain?.date ?? today,
        };
        update(upsertReview(review, reviews));
      }
    } catch { /* AI 复盘失败静默 */ }
    finally { setAiReviewing(false); }
  };

  // 自动复盘（本地服务端 kv review:YYYY-MM-DD，回退最近3个自然日）
  useEffect(() => {
    if (!isLocalServer()) return;
    let alive = true;
    (async () => {
      try {
        for (let i = 0; i < 3; i++) {
          const d = new Date();
          d.setDate(d.getDate() - i);
          const key = `review:${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          const r = await apiFetch(`/api/db/kv?key=${encodeURIComponent(key)}`);
          if (!r.ok) continue;
          const v = await r.json();
          if (v?.value?.text) { if (alive) setAutoReview({ date: v.value.date ?? key, text: v.value.text, dimensions: v.value.dimensions }); return; }
        }
      } catch { /* 静默 */ }
    })();
    return () => { alive = false; };
  }, []);

  // 历史回放：读 zt_snapshot 重建当日涨停池摘要
  const replay = async (date: string) => {
    if (!isLocalServer()) return;
    try {
      const r = await apiFetch(`/api/db/zt?date=${date}`);
      if (!r.ok) return;
      const v = await r.json();
      const pool = v?.data?.pool ?? v?.pool;
      if (!Array.isArray(pool) || pool.length === 0) { setReplayText("该日无涨停快照"); return; }
      const themeMap = new Map<string, number>();
      for (const p of pool) {
        const h = String(p.hybk || "未分类");
        themeMap.set(h, (themeMap.get(h) ?? 0) + 1);
      }
      const themes = [...themeMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
        .map(([t, n]) => `${t}(${n})`).join("、");
      const maxH = Math.max(0, ...pool.map((p: any) => Number(p.lbc ?? 1)));
      setReplayText(`${date} 涨停 ${pool.length} 只 · 最高 ${maxH} 板\n主线：${themes}`);
    } catch { setReplayText("回放失败（数据缺失）"); }
  };

  const today = localDateStr();
  const todayReview = reviews.find(r => r.date === today);
  const session = getCurrentSession();
  const isPostMarket = session.phase === "post";

  const update = (next: DailyReview[]) => { setReviews(next); saveReviews(next); };

  const submit = () => {
    if (!mainline.trim()) return;
    const review: DailyReview = {
      date: today,
      mainline: mainline.trim(),
      leader: leader.trim(),
      myStocks: myStocks.trim(),
      pnl: pnl.trim() !== "" && isFinite(parseFloat(pnl)) ? parseFloat(pnl) : null,
      reflection: reflection.trim(),
      createdAt: Date.now(),
    };
    update(upsertReview(review, reviews));
    setMainline(""); setLeader(""); setMyStocks(""); setPnl(""); setReflection("");
    setShowForm(false);
  };

  const filtered = searchReviews(reviews, keyword);
  const stats = statByMainline(reviews.slice(0, 30));
  // v9.137.0（审查 P1-02 边界说明）：复盘自评连亏（computeLossStreak）仅用于本面板展示；
  //   纪律面板的连亏熔断（discipline.lossStreak）已由 tradeLedger.saveTrade 的 sell/stop
  //   真实成交路径驱动（v9.137.0 接线 recordTradeResult），两套数据刻意不互写——复盘是主观自评，
  //   成交台账是客观记录，混写会双重计数。
  const lossStreak = computeLossStreak(reviews);

  return (
    <div ref={exportRef} className="rounded-xl border border-teal-500/20 bg-teal-950/10 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-teal-300">📝 每日复盘</span>
          {isPostMarket && !todayReview && (
            <span className="rounded bg-teal-500/20 px-1.5 py-0.5 text-[10px] font-bold text-teal-300">收盘后 · 建议记录</span>
          )}
          {todayReview && (
            <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">今日已记录</span>
          )}
          {lossStreak >= 3 && (
            <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-bold text-rose-300">连续亏损 {lossStreak} 天 · 冷静期</span>
          )}
        </div>
        <div className="flex gap-1.5">
          <button onClick={exportPng} disabled={exporting}
            className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] text-sky-200 hover:bg-sky-500/30 disabled:opacity-50"
            title="导出复盘卡为图片">
            {exporting ? "导出中…" : "📥 导出"}
          </button>
          <button onClick={() => setShowForm(v => !v)}
            className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-white/20">
            {showForm ? "收起" : todayReview ? "编辑今日" : "记录今日"}
          </button>
        </div>
      </div>

      {/* v9.33（缺口2）：服务端自动复盘展示 */}
      {autoReview && (
        <div className="rounded border border-violet-500/25 bg-violet-500/10 p-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-bold text-violet-300">🤖 自动复盘 {autoReview.date}（LLM/规则版）</span>
            <span className="flex items-center gap-1.5">
              {/* v9.99.2（C3）：服务端复盘触发按钮（今日 13 维结构化复盘） */}
              <button onClick={triggerServerReview} disabled={serverReviewing}
                className="rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] font-bold text-violet-200 hover:bg-violet-500/30 disabled:opacity-50"
                title="调用服务端生成今日 13 维结构化复盘（需当日快照数据）">
                {serverReviewing ? "生成中…" : "🔄 生成今日"}
              </button>
              <span className="text-[10px] text-slate-500">cron 15:40 自动 · 可手动</span>
            </span>
          </div>
          {/* v9.94.1：13 维度结构化数据（tdxclaw 式） */}
          {autoReview.dimensions && (
            <div className="space-y-1.5 mb-2">
              {(() => {
                const dm = autoReview.dimensions!;
                const rows: Array<{ label: string; body: React.ReactNode }> = [];
                if (dm.d3) rows.push({ label: `涨跌停 · ${dm.d3.limitUp ?? "-"} 只涨停`, body: (
                  <div className="flex flex-wrap gap-1">
                    {(dm.d3.ladder ?? []).slice(0, 5).map((x, i) => (
                      <span key={i} className="rounded bg-white/10 px-1 py-0.5 text-[10px] text-slate-200">{x.name}{x.lbc}板</span>
                    ))}
                    {dm.d3.ladder?.length === 0 && <span className="text-[10px] text-slate-500">无 2 板以上梯队</span>}
                  </div>
                )});
                if (dm.d4) rows.push({ label: "板块效应 TOP", body: (
                  <div className="space-y-0.5">
                    {dm.d4.boards?.slice(0, 6).map((b, i) => (
                      <div key={i} className="flex items-center gap-1 text-[10px]">
                        <span className="font-bold text-amber-300">{b.name}</span>
                        <span className="text-slate-400">{b.count}只</span>
                        {b.leaders && <span className="text-slate-500 truncate">龙头 {b.leaders}</span>}
                        {(b.maxLbc ?? 0) >= 2 && <span className="rounded bg-rose-500/20 px-1 text-rose-300">{b.maxLbc}板</span>}
                      </div>
                    ))}
                  </div>
                )});
                if (dm.d2) rows.push({ label: "主力资金 TOP", body: (
                  <div className="space-y-0.5">
                    {(dm.d2.stockFundTop ?? []).slice(0, 5).map((x, i) => (
                      <div key={i} className="flex items-center gap-1 text-[10px]">
                        <span className="text-slate-300">{x.name}</span>
                        <span className="text-rose-300 font-mono">+{fmtYi(x.fund)}</span>
                        {x.pct != null && <span className="text-slate-500">{x.pct > 0 ? "+" : ""}{x.pct.toFixed(1)}%</span>}
                      </div>
                    ))}
                    {(dm.d2.fundBoards ?? []).slice(0, 3).map((b, i) => (
                      <div key={`b${i}`} className="text-[10px] text-slate-500">行业 {b.name} +{fmtYi(b.mainNet)}</div>
                    ))}
                  </div>
                )});
                if (dm.d5) rows.push({ label: "事件催化词频", body: (
                  <div className="flex flex-wrap gap-1">
                    {(dm.d5.catalysts ?? []).slice(0, 8).map((c, i) => (
                      <span key={i} className="rounded bg-cyan-500/10 px-1 py-0.5 text-[10px] text-cyan-300">{c.kw} ×{c.count}</span>
                    ))}
                  </div>
                )});
                if (dm.d8) rows.push({ label: "龙虎榜", body: (
                  <div className="space-y-0.5">
                    {(dm.d8.lhb ?? []).slice(0, 5).map((x, i) => (
                      <div key={i} className="flex items-center gap-1 text-[10px]">
                        <span className="text-slate-300">{x.name}</span>
                        <span className={`font-mono ${(x.netBuy ?? 0) >= 0 ? "text-rose-300" : "text-emerald-300"}`}>
                          {(x.netBuy ?? 0) >= 0 ? "+" : ""}{fmtYi(x.netBuy)}
                        </span>
                      </div>
                    ))}
                    {dm.d8.lhb?.length === 0 && <span className="text-[10px] text-slate-500">无上榜</span>}
                  </div>
                )});
                if (dm.d7) rows.push({ label: "公告业绩", body: (
                  <div className="space-y-0.5">
                    {(dm.d7.anns ?? []).slice(0, 4).map((a, i) => (
                      <div key={i} className="text-[10px] text-slate-400 truncate">{a.name ? `${a.name}：` : ""}{a.title}</div>
                    ))}
                  </div>
                )});
                if (dm.d9) rows.push({ label: "自选股表现", body: (
                  <div className="flex flex-wrap gap-1">
                    {(dm.d9.watch ?? []).slice(0, 6).map((w, i) => (
                      <span key={i} className="rounded bg-white/10 px-1 py-0.5 text-[10px]">
                        <span className="text-slate-300">{w.name || w.code}</span>
                        <span className={w.pct != null && w.pct >= 0 ? "text-rose-300" : "text-emerald-300"}>
                          {" "}{w.pct != null ? `${w.pct >= 0 ? "+" : ""}${w.pct.toFixed(1)}%` : ""}{w.lbc ? ` ${w.lbc}板` : ""}
                        </span>
                      </span>
                    ))}
                  </div>
                )});
                if (dm.d6) rows.push({ label: "异常检测", body: (
                  <div className="space-y-0.5">
                    {(dm.d6.anomalies ?? []).slice(0, 3).map((a, i) => (
                      <div key={i} className="text-[10px] text-amber-300">⚠ {a.name} · {a.reason}{a.note ? `（${a.note}）` : ""}</div>
                    ))}
                    {dm.d6.anomalies?.length === 0 && <span className="text-[10px] text-slate-500">无显著异常</span>}
                  </div>
                )});
                if (dm.d10) rows.push({ label: "风险事件（黑天鹅）", body: (
                  <div className="space-y-0.5">
                    {(dm.d10.events ?? []).slice(0, 3).map((e, i) => (
                      <div key={i} className="text-[10px] text-rose-300/80">🔻 {e.title}</div>
                    ))}
                    {dm.d10.events?.length === 0 && <span className="text-[10px] text-slate-500">无</span>}
                  </div>
                )});
                if (dm.d11) rows.push({ label: "次日关注（资金兜底）", body: (
                  <div className="flex flex-wrap gap-1">
                    {(dm.d11.picks ?? []).slice(0, 5).map((p, i) => (
                      <span key={i} className="rounded bg-emerald-500/10 px-1 py-0.5 text-[10px] text-emerald-300">
                        {p.name}{p.fund ? ` +${fmtYi(p.fund)}` : ""}
                      </span>
                    ))}
                  </div>
                )});
                return (
                  <div className="grid grid-cols-1 gap-1.5">
                    {rows.map((r, i) => (
                      <div key={i} className="rounded bg-black/25 px-1.5 py-1">
                        <div className="text-[9px] font-bold text-violet-400/80 mb-0.5">{r.label}</div>
                        {r.body}
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          )}
          <pre className="whitespace-pre-wrap text-[10px] text-slate-300 leading-relaxed">{autoReview.text}</pre>
        </div>
      )}

      {/* v9.84.2（3.5）：立即 AI 复盘 —— dailyReviewAuto 前端模板 + 大脑快照数据，不等 cron */}
      {isLocalServer() && (
        <button onClick={runAIReview} disabled={aiReviewing}
          className="rounded bg-violet-500/15 px-2 py-1 text-[10px] font-bold text-violet-300 hover:bg-violet-500/25 disabled:opacity-40"
          title="用今日大脑快照（情绪/涨停/主线/黑天鹅）立即生成 AI 复盘，结果并入本地复盘库">
          {aiReviewing ? "🤖 AI 复盘生成中…" : "🤖 立即 AI 复盘"}
        </button>
      )}

      {/* v9.33（缺口2）：历史主线回放 */}
      {isLocalServer() && (
        <div className="flex items-center gap-1.5">
          <input type="date" value={replayDate} max={today}
            onChange={e => setReplayDate(e.target.value)}
            className="rounded bg-white/5 px-1.5 py-1 text-[10px] text-slate-300" />
          <button onClick={() => replay(replayDate)}
            className="rounded bg-white/10 px-1.5 py-1 text-[10px] text-slate-300 hover:bg-white/20">
            🕘 回放当日涨停池
          </button>
        </div>
      )}
      {replayText && (
        <pre className="whitespace-pre-wrap rounded bg-black/30 px-2 py-1.5 text-[10px] text-amber-200/80">{replayText}</pre>
      )}

      {/* 录入表单 */}
      {showForm && (
        <div className="rounded border border-white/10 bg-black/30 p-2 space-y-1.5">
          <div className="grid grid-cols-2 gap-1.5">
            <input value={mainline} onChange={e => setMainline(e.target.value)} placeholder="今日主线（如 AI应用）"
              className="rounded bg-white/5 px-1.5 py-1 text-[11px] text-slate-200 placeholder-slate-600" />
            <input value={leader} onChange={e => setLeader(e.target.value)} placeholder="今日龙头"
              className="rounded bg-white/5 px-1.5 py-1 text-[11px] text-slate-200 placeholder-slate-600" />
            <input value={myStocks} onChange={e => setMyStocks(e.target.value)} placeholder="我参与的个股（逗号分隔）"
              className="rounded bg-white/5 px-1.5 py-1 text-[11px] text-slate-200 placeholder-slate-600" />
            <input value={pnl} onChange={e => setPnl(e.target.value)} placeholder="当日盈亏%（正=赚）"
              className="rounded bg-white/5 px-1.5 py-1 text-[11px] text-slate-200 placeholder-slate-600" />
          </div>
          <input value={reflection} onChange={e => setReflection(e.target.value)} placeholder="一句话反思（为什么打/为什么没接/错在哪）"
            className="w-full rounded bg-white/5 px-1.5 py-1 text-[11px] text-slate-200 placeholder-slate-600" />
          <div className="flex gap-1.5">
            <button onClick={submit} className="rounded bg-teal-500/30 px-2 py-1 text-[10px] font-bold text-teal-200 hover:bg-teal-500/40">保存</button>
          </div>
        </div>
      )}

      {/* 题材盈亏统计（沉淀打法） */}
      {stats.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {stats.slice(0, 5).map(s => (
            <span key={s.mainline} className={`rounded border px-1.5 py-0.5 text-[10px] ${
              s.avgPnl >= 0 ? "border-rose-500/20 bg-rose-500/10 text-rose-300" : "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
            }`}>
              {s.mainline} · {s.count}次 · 均{s.avgPnl >= 0 ? "+" : ""}{s.avgPnl.toFixed(1)}% · 胜率{s.winRate}%
            </span>
          ))}
        </div>
      )}

      {/* 检索 + 列表 */}
      <div className="flex items-center gap-1.5">
        <input value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="🔍 按主线/龙头/个股检索"
          className="w-full rounded bg-white/5 px-1.5 py-1 text-[11px] text-slate-200 placeholder-slate-600" />
      </div>
      <div className="max-h-48 overflow-y-auto space-y-1">
        {filtered.map(r => (
          <div key={r.date} className="rounded bg-black/20 px-2 py-1 text-[11px]">
            <div className="flex items-center gap-2">
              <span className="font-mono text-slate-500">{r.date.slice(5)}</span>
              {/* v9.100.0（P1-04）：跨日错位校验标注 —— 审查实测 08-11 条目显示 08-10 时段的 AI 复盘文本（凌晨生成、日期键错位） */}
              {(() => { const cd = crossDayReview(r); return cd && (
                <span className="rounded bg-amber-500/20 px-1 text-[9px] font-bold text-amber-300" title={cd}>
                  ⚠跨日
                </span>
              ); })()}
              <span className="font-semibold text-teal-300">{r.mainline}</span>
              <span className="text-slate-400">{r.leader}</span>
              {r.pnl != null && (
                <span className={`ml-auto font-mono ${r.pnl >= 0 ? "text-rose-400" : "text-emerald-400"}`}>
                  {r.pnl >= 0 ? "+" : ""}{r.pnl.toFixed(1)}%
                </span>
              )}
            </div>
            {r.myStocks && <div className="text-[10px] text-slate-500">个股：{r.myStocks}</div>}
            {r.reflection && <div className="text-[10px] text-slate-400">💡 {r.reflection}</div>}
          </div>
        ))}
        {filtered.length === 0 && <div className="text-[10px] text-slate-600">暂无复盘记录，坚持记录才能沉淀打法</div>}
      </div>
    </div>
  );
}
