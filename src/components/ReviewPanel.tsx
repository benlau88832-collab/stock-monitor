// 每日复盘卡片（v9.19-F10）
// 收盘后引导填写：今日主线/龙头/参与个股/盈亏/一句话反思
// 支持按题材检索 + 题材盈亏统计（沉淀打法体系）
import { useState } from "react";
import { loadReviews, saveReviews, upsertReview, searchReviews, statByMainline, computeLossStreak, type DailyReview } from "../lib/dailyReview";
import { localDateStr } from "../lib/format";
import { getCurrentSession } from "../lib/tradingSession";

export default function ReviewPanel() {
  const [reviews, setReviews] = useState<DailyReview[]>(loadReviews);
  const [keyword, setKeyword] = useState("");
  const [mainline, setMainline] = useState("");
  const [leader, setLeader] = useState("");
  const [myStocks, setMyStocks] = useState("");
  const [pnl, setPnl] = useState("");
  const [reflection, setReflection] = useState("");
  const [showForm, setShowForm] = useState(false);

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
  const lossStreak = computeLossStreak(reviews);

  return (
    <div className="rounded-xl border border-teal-500/20 bg-teal-950/10 p-3 space-y-2">
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
        <button onClick={() => setShowForm(v => !v)}
          className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-white/20">
          {showForm ? "收起" : todayReview ? "编辑今日" : "记录今日"}
        </button>
      </div>

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
