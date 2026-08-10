// ============================================================
// v9.96.0（批次 1）：市场情绪叙事报告面板（VibeAlpha 全栈落地前端）
// - 触发分析：POST /api/emotion/analyze（服务端周期引擎 + LLM 报告 + kv 落库）
// - 历史列表：GET /api/db/kv-prefix?prefix=report:emotion:
// - 报告渲染：renderMiniMarkdown（零依赖）
// - 导出图片：html2canvas
// - 舆情三分类：复用 fetchHotRank（人气核心/赚钱效应/接飞刀）
// ============================================================
import { useState, useEffect, useCallback, useRef } from "react";
import { fetchPopularityRank, type PopularityItem } from "../lib/api";
import { renderMiniMarkdown } from "../lib/md";

interface EmotionReport {
  date: string;
  phase: string;
  rule: string;
  sealRate: number | null;
  metrics: {
    ztCount: number; zbCount: number; dtCount: number;
    blastedRate: number | null; maxBoardHeight: number | null;
    premiumAvg: number | null; promotionRate: number | null; sentiment: number | null;
  };
  newsStats: { total: number; positive: number; negative: number; neutral: number; top: string[] };
  report: string;
  degraded: boolean;
  generatedAt: string;
}

interface HotItem { code: string; name: string; pct: number; rank: number; }

export default function EmotionReportPanel() {
  const [reports, setReports] = useState<EmotionReport[]>([]);
  const [running, setRunning] = useState(false);
  const [hot, setHot] = useState<HotItem[]>([]);
  const [exporting, setExporting] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const resp = await fetch("/api/db/kv-prefix?prefix=report:emotion:&limit=10");
      const j = await resp.json();
      const items: EmotionReport[] = (j.items ?? []).map((x: { value: unknown }) => {
        let v = x.value;
        if (typeof v === "string") { try { v = JSON.parse(v); } catch { /* 保持 */ } }
        return v as EmotionReport;
      }).filter((r: EmotionReport) => r && r.report);
      setReports(items);
    } catch { /* 历史加载失败不阻塞 */ }
  }, []);

  // 人气榜舆情三分类（VibeAlpha social_media.py 对照：Top5 人气核心 / ≤20 且涨>9% 赚钱效应 / ≤20 且跌<-5% 接飞刀）
  useEffect(() => {
    let alive = true;
    fetchPopularityRank().then(list => {
      if (!alive) return;
      const items: HotItem[] = (list ?? []).slice(0, 20).map((h: PopularityItem, i: number) => ({
        code: String(h.code ?? ""), name: String(h.name ?? ""), pct: Number((h as { pct?: number }).pct ?? 0), rank: i + 1,
      }));
      setHot(items);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => { load(); }, [load]);

  const trigger = async () => {
    if (running) return;
    setRunning(true);
    try {
      await fetch("/api/emotion/analyze", { method: "POST" });
      // 后台执行 → 轮询等最新报告
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const resp = await fetch("/api/db/kv-prefix?prefix=report:emotion:&limit=1");
        const j = await resp.json();
        const v = j.items?.[0]?.value;
        const parsed = typeof v === "string" ? JSON.parse(v) : v;
        if (parsed?.report) { setReports(prev => [parsed, ...prev.filter(r => r.date !== parsed.date)]); break; }
      }
    } catch { /* 触发失败 */ }
    setRunning(false);
  };

  const exportPng = async () => {
    if (!reportRef.current || exporting) return;
    setExporting(true);
    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(reportRef.current, { backgroundColor: "#0b1020", scale: 2 });
      const a = document.createElement("a");
      a.download = `情绪叙事报告-${reports[0]?.date ?? "今日"}.png`;
      a.href = canvas.toDataURL("image/png");
      a.click();
    } catch (e) { console.warn("[emotion] 导出失败:", e); }
    setExporting(false);
  };

  const latest = reports[0];
  // 舆情三分类
  const topHot = hot.filter(h => h.rank <= 5);
  const emotionCore = hot.filter(h => h.rank <= 20 && h.pct > 9);
  const catchKnife = hot.filter(h => h.rank <= 20 && h.pct < -5);

  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-950/5 p-3 space-y-2" ref={ref}>
      <div className="flex items-center justify-between">
        <div className="text-sm font-bold text-amber-200">🎭 市场情绪叙事报告 <span className="ml-1 text-[10px] text-slate-500">周期引擎 + LLM（VibeAlpha）</span></div>
        <div className="flex gap-1.5">
          <button onClick={trigger} disabled={running}
            className="rounded bg-amber-500/20 px-2.5 py-1 text-[11px] text-amber-200 hover:bg-amber-500/30 disabled:opacity-50">
            {running ? "分析中…" : "⚡ 运行分析"}
          </button>
          {latest && (
            <button onClick={exportPng} disabled={exporting}
              className="rounded bg-sky-500/20 px-2.5 py-1 text-[11px] text-sky-200 hover:bg-sky-500/30 disabled:opacity-50">
              {exporting ? "导出中…" : "📥 导出图片"}
            </button>
          )}
        </div>
      </div>

      {/* 舆情三分类（人气榜派生，VibeAlpha 对照） */}
      {hot.length > 0 && (
        <div className="grid grid-cols-3 gap-2 text-[10px]">
          <div className="rounded bg-black/20 p-1.5">
            <div className="text-rose-300 font-bold">🔥 人气核心（Top5）</div>
            <div className="mt-0.5 text-slate-400">{topHot.map(h => h.name).join("、") || "—"}</div>
          </div>
          <div className="rounded bg-black/20 p-1.5">
            <div className="text-amber-300 font-bold">💰 赚钱效应（≤20 且涨&gt;9%）</div>
            <div className="mt-0.5 text-slate-400">{emotionCore.map(h => h.name).join("、") || "—"}</div>
          </div>
          <div className="rounded bg-black/20 p-1.5">
            <div className="text-emerald-300 font-bold">🔪 接飞刀（≤20 且跌&lt;-5%）</div>
            <div className="mt-0.5 text-slate-400">{catchKnife.map(h => h.name).join("、") || "—"}</div>
          </div>
        </div>
      )}

      {/* 历史报告列表 */}
      <div className="flex flex-wrap gap-1">
        {reports.map(r => (
          <button key={r.date} onClick={() => setReports(prev => [r, ...prev.filter(x => x.date !== r.date)])}
            className={`rounded px-2 py-0.5 text-[10px] ${r.date === latest?.date ? "bg-amber-500/25 text-amber-200" : "bg-white/5 text-slate-400 hover:bg-white/10"}`}>
            {r.date} · {r.phase}
          </button>
        ))}
      </div>

      {/* 报告正文（可导出区） */}
      {latest ? (
        <div ref={reportRef} className="rounded-lg border border-white/10 bg-black/30 p-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-slate-400">{latest.date} · 周期阶段：<b className="text-amber-300">{latest.phase}</b></span>
            <span className="text-[10px] text-slate-600">{latest.degraded ? "规则版（LLM 不可用）" : `LLM 报告 · ${latest.generatedAt.slice(0, 16)}`}</span>
          </div>
          <div className="text-[10px] text-slate-500 mb-1.5">
            涨停 {latest.metrics.ztCount} · 炸板 {latest.metrics.zbCount} · 跌停 {latest.metrics.dtCount} · 封板率 {latest.sealRate != null ? latest.sealRate.toFixed(0) + "%" : "—"} · 最高 {latest.metrics.maxBoardHeight} 板 · 舆情 利好{latest.newsStats.positive}/利空{latest.newsStats.negative}/中性{latest.newsStats.neutral}
          </div>
          {renderMiniMarkdown(latest.report)}
        </div>
      ) : (
        <div className="text-[11px] text-slate-500">暂无报告 —— 点"⚡ 运行分析"生成今日情绪叙事报告（周期规则引擎 + LLM）</div>
      )}
    </div>
  );
}
