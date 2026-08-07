// ============================================================
// v9.66：个股盯价监控面板 —— 挂"个股雷达"Tab
// 功能：监控清单（现价/买入区/偏离度/状态）+ 偏离度进度条 + 价格走势图 + 触发强提示
// 数据：server /api/watch/*（PG price_watch + price_watch_log）
// 触发：轮询 /api/watch/events → alertBus.emit()（声音+系统通知+标题闪烁）
// ============================================================
import { useState, useEffect, useCallback, type ReactElement } from "react";
import { emit as alertEmit } from "../lib/alertBus";

interface WatchItem {
  code: string; name: string;
  buy_low: string | null; buy_high: string | null;
  stop_loss: string | null; trigger_pct: string;
  status: string; note: string | null;
  price: number | null; mid: number | null; deviation: number | null;
}

interface TrendPoint { date: string; price: string; deviation_pct: string; triggered: boolean; event_text: string | null; }
interface WatchEvent { id: number; code: string; name: string; price: string; deviation_pct: string; event_text: string; created_at: string; }

const devColor = (d: number | null, tp: number): string => {
  if (d == null) return "text-slate-500";
  const a = Math.abs(d);
  if (a <= tp) return "text-emerald-300";      // 已进关注区
  if (a <= tp * 2) return "text-amber-300";    // 接近
  return "text-slate-400";                     // 远离
};

export default function PriceWatchPanel() {
  const [watches, setWatches] = useState<WatchItem[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [events, setEvents] = useState<WatchEvent[]>([]);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/watch/list");
      const j = await r.json();
      if (j.ok) setWatches(j.items ?? []);
    } catch { /* 服务端不可用 → 静默 */ }
    try {
      const r = await fetch("/api/watch/events");
      const j = await r.json();
      if (j.ok && j.items?.length > 0) {
        setEvents(prev => {
          const known = new Set(prev.map(e => e.id));
          const fresh = (j.items as WatchEvent[]).filter(e => !known.has(e.id));
          for (const e of fresh) {
            alertEmit({ id: `watch_${e.code}_${e.id}`, severity: "warning", message: `⚡ ${e.name}(${e.code}) 进入关注区间！现价 ${e.price}，偏离 ${e.deviation_pct}%` });
          }
          return fresh.length > 0 ? [...fresh, ...prev].slice(0, 20) : prev;
        });
        // 标记已读
        fetch("/api/watch/events/read", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: j.items.map((e: WatchEvent) => e.id) }),
        }).catch(() => {});
      }
    } catch { /* 静默 */ }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30000); // 30s 轮询清单+事件
    return () => clearInterval(t);
  }, [refresh]);

  // 选中标的后拉走势
  useEffect(() => {
    if (!selected) { setTrend([]); return; }
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/watch/trend?code=${encodeURIComponent(selected)}`);
        const j = await r.json();
        if (j.ok && alive) setTrend(j.items ?? []);
      } catch { /* 静默 */ }
    })();
    return () => { alive = false; };
  }, [selected]);

  const setStatus = async (code: string, status: string) => {
    await fetch("/api/watch/update", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, status }),
    }).catch(() => {});
    refresh();
  };
  const remove = async (code: string) => {
    await fetch("/api/watch/remove", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    }).catch(() => {});
    if (selected === code) setSelected("");
    refresh();
  };

  // ---------- 走势图（SVG 自绘，零依赖） ----------
  const W = 560, H = 150, PAD = 30;
  let trendSvg: ReactElement | null = null;
  if (trend.length > 0) {
    const pts = trend.filter(t => Number(t.price) > 0);
    if (pts.length > 0) {
      const prices = pts.map(t => Number(t.price));
      const min = Math.min(...prices) * 0.97, max = Math.max(...prices) * 1.03;
      const xOf = (i: number) => PAD + i / Math.max(1, pts.length - 1) * (W - PAD * 2);
      const yOf = (p: number) => H - PAD - (p - min) / (max - min || 1) * (H - PAD * 2);
      const line = pts.map((t, i) => `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)},${yOf(Number(t.price)).toFixed(1)}`).join(" ");
      const watch = watches.find(w => w.code === selected);
      const buyLow = watch ? Number(watch.buy_low) : NaN;
      const buyHigh = watch ? Number(watch.buy_high) : NaN;
      trendSvg = (
        <svg width={W} height={H} className="shrink-0">
          {[buyLow, buyHigh].filter(v => Number.isFinite(v)).map((v, i) => (
            <line key={i} x1={PAD} x2={W - PAD} y1={yOf(v)} y2={yOf(v)}
              stroke={i === 0 ? "rgba(29,158,117,0.4)" : "rgba(29,158,117,0.6)"} strokeWidth="1" strokeDasharray="4,3" />
          ))}
          <path d={line} fill="none" stroke="rgba(148,163,184,0.8)" strokeWidth="1.5" />
          {pts.map((t, i) => t.triggered && (
            <circle key={i} cx={xOf(i)} cy={yOf(Number(t.price))} r="3" fill="#E24B4A">
              <title>{`${t.date} 现价${t.price} 触发关注区间`}</title>
            </circle>
          ))}
          <text x={PAD} y={H - 8} fontSize="10" fill="rgba(148,163,184,0.7)">{pts[0].date}</text>
          <text x={W - PAD} y={H - 8} fontSize="10" fill="rgba(148,163,184,0.7)" textAnchor="end">{pts[pts.length - 1].date}</text>
        </svg>
      );
    }
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-xs">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-bold text-slate-100">
          🎯 盯价监控 <span className="ml-1 text-[10px] text-slate-500 font-normal">深度调研结论录入 · 跌入买入区 ±5% 强提示 · 盘中每5分钟</span>
        </div>
        {events.length > 0 && (
          <div className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-bold text-rose-300">⚡ {events.length} 条触发</div>
        )}
      </div>

      {watches.length === 0 ? (
        <div className="py-4 text-center text-slate-500">
          暂无监控标的 —— 在全站 AI 助手（右下角 🤖）发起「深度调研 600XXX」，
          完成后让助手把买入区/止损位加入盯价监控，这里就会实时显示偏离度并在跌入 ±5% 时强提示。
        </div>
      ) : (
        <div className="space-y-1.5">
          {watches.map(w => {
            const tp = Number(w.trigger_pct) || 5;
            const dev = w.deviation;
            const pct = dev == null ? 0 : Math.max(-100, Math.min(100, dev));
            const barPos = (pct + 100) / 2 * 100; // 0~100 → 进度条位置
            return (
              <div key={w.code}
                onClick={() => setSelected(w.code)}
                className={`cursor-pointer rounded-lg border border-white/5 bg-black/20 px-2.5 py-2 ${selected === w.code ? "ring-1 ring-amber-400/40" : ""}`}>
                <div className="flex items-center justify-between">
                  <div className="font-medium text-slate-100">
                    {w.name} <span className="text-slate-500">({w.code})</span>
                    {w.status !== "active" && (
                      <span className="ml-1 rounded bg-white/10 px-1 text-[9px] text-slate-400">{w.status === "paused" ? "已暂停" : "已完成"}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400">买入区 {w.buy_low}-{w.buy_high}</span>
                    <span className={`text-[11px] font-bold ${devColor(dev, tp)}`}>
                      现价 {w.price ?? "--"} · 偏离 {dev == null ? "--" : (dev > 0 ? "+" : "") + dev + "%"}
                    </span>
                    {w.status === "active" ? (
                      <>
                        <button onClick={(e) => { e.stopPropagation(); setStatus(w.code, "paused"); }}
                          className="rounded bg-white/5 px-1.5 py-0.5 text-slate-400 hover:bg-white/10">暂停</button>
                        <button onClick={(e) => { e.stopPropagation(); remove(w.code); }}
                          className="rounded bg-rose-500/10 px-1.5 py-0.5 text-rose-300 hover:bg-rose-500/20">删</button>
                      </>
                    ) : (
                      <button onClick={(e) => { e.stopPropagation(); setStatus(w.code, "active"); }}
                        className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-300 hover:bg-emerald-500/20">恢复</button>
                    )}
                  </div>
                </div>
                {/* 偏离度进度条：中间绿色带 = ±5% 触发区 */}
                <div className="relative mt-1.5 h-1.5 rounded bg-black/40">
                  <div className="absolute top-0 h-full rounded bg-emerald-500/30" style={{ left: `${50 - tp / 2}%`, width: `${tp}%` }} />
                  <div className="absolute top-0 h-full rounded bg-slate-300/70" style={{ left: `${barPos}%`, width: "3px", transform: "translateX(-50%)" }} title={`偏离 ${dev}%`} />
                </div>
                {w.note && <div className="mt-1 text-[9px] text-slate-600">{w.note}</div>}
              </div>
            );
          })}
        </div>
      )}

      {/* 走势图 */}
      {selected && (
        <div className="mt-3 rounded-lg bg-black/20 p-2">
          <div className="mb-1 text-[10px] text-slate-500">
            {watches.find(w => w.code === selected)?.name} 价格走势（虚线 = 买入区上下沿，红点 = 触发关注区间）
          </div>
          {trendSvg ?? <div className="py-6 text-center text-slate-600">走势数据积累中（每交易日收盘快照）</div>}
        </div>
      )}

      {/* 触发事件 */}
      {events.length > 0 && (
        <div className="mt-3 space-y-1">
          {events.slice(0, 5).map(e => (
            <div key={e.id} className="rounded bg-rose-500/10 px-2 py-1 text-[10px] text-rose-300">
              ⚡ {e.name}({e.code}) {e.event_text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
