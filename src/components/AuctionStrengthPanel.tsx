// ============================================================
// v9.36（A2）：竞价强度榜 —— 9:15-9:25 抢筹信号
// 游资痛点：竞价是全天最关键的 10 分钟，抢筹/抢跑都看竞价。
// 复用 auction.ts 的 fetchAuctionBoard（腾讯行情接口，竞价期间返回竞价开盘数据）
// 展示：昨日涨停池 + 今日涨停池 的竞价涨幅榜 top 12
// ============================================================
import { useState, useEffect, useCallback, useRef } from "react";
import { fetchAuctionBoard, type AuctionItem } from "../lib/auction";
import { stockRealUrl } from "../lib/realLinks";

interface Props {
  /** 昨日涨停股（竞价前参考） */
  yesterdayZt?: Array<{ code: string; name: string }>;
  /** 今日涨停池（已封板的显示封板信息） */
  todayZt?: Array<{ c: string; n: string; fbt: number; lbc: number }>;
}

export default function AuctionStrengthPanel({ yesterdayZt = [], todayZt = [] }: Props) {
  const [items, setItems] = useState<AuctionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const fetchedRef = useRef(false);

  const load = useCallback(async () => {
    if (yesterdayZt.length === 0) return;
    setLoading(true);
    try {
      const list = await fetchAuctionBoard(yesterdayZt.map(s => s.code), todayZt);
      setItems(list);
    } catch { /* 静默 */ }
    setLoading(false);
  }, [yesterdayZt, todayZt]);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    load();
    const t = setInterval(() => load(), 60000); // 竞价期 60s 刷新
    return () => clearInterval(t);
  }, [load]);

  if (yesterdayZt.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-[11px] text-slate-500">
        竞价强度榜需要昨日涨停数据（竞价前可用）。
      </div>
    );
  }

  const sorted = [...items].sort((a, b) => b.auctionPct - a.auctionPct);
  const top = sorted.slice(0, 12);
  const limitUp = top.filter(i => i.auctionLimitUp);

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-slate-200">
          ⚡ 竞价强度榜
          <span className="ml-1 text-[10px] text-slate-500 font-normal">竞价涨幅 top12 · 昨日涨停池</span>
        </span>
        {loading ? (
          <span className="text-[10px] text-slate-500">刷新中…</span>
        ) : (
          <span className="text-[10px] text-slate-500">{top.length}只</span>
        )}
      </div>

      {limitUp.length > 0 && (
        <div className="mb-2 rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-300">
          🔒 竞价即涨停 {limitUp.length} 只：{limitUp.map(i => i.name).join("、")}
        </div>
      )}

      <div className="space-y-1">
        {top.map((it, i) => (
          <a key={it.code} href={stockRealUrl(it.code)} target="_blank" rel="noopener noreferrer"
            className={`flex items-center gap-2 rounded px-2 py-1 text-[11px] transition hover:bg-white/10 ${
              it.auctionLimitUp ? "bg-rose-500/10 border border-rose-500/20" : "bg-black/20 border border-white/5"
            }`}>
            <span className="w-4 shrink-0 text-center font-mono text-slate-500">{i + 1}</span>
            <span className="w-16 shrink-0 truncate font-semibold text-slate-100">{it.name}</span>
            <span className={`shrink-0 font-mono font-bold ${it.auctionPct >= 0 ? "text-rose-300" : "text-emerald-300"}`}>
              {it.auctionPct >= 0 ? "+" : ""}{it.auctionPct.toFixed(1)}%
            </span>
            {it.auctionLimitUp && <span className="rounded bg-rose-500/30 px-1 text-xs font-black text-rose-200">竞价封板</span>}
            {it.auctionGapDown && <span className="rounded bg-emerald-500/20 px-1 text-xs font-black text-emerald-300">低开</span>}
            {it.boardCount != null && (
              <span className="rounded bg-amber-500/15 px-1 text-xs font-bold text-amber-300">{it.boardCount}板</span>
            )}
            <span className="ml-auto shrink-0 text-slate-500">{it.openAmountYi > 0 ? `竞价${it.openAmountYi.toFixed(1)}亿` : ""}</span>
          </a>
        ))}
        {top.length === 0 && (
          <div className="py-3 text-center text-[11px] text-slate-500">
            竞价数据未返回（可能不在竞价时段或接口暂不可用）
          </div>
        )}
      </div>
    </div>
  );
}
