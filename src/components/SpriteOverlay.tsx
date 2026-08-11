// ============================================================
// v9.102.0（第二批 A，T-A3）：盘中精灵浮层（通达信"盘中精灵"效果）
// 右下角常驻迷你条 + S 级事件弹窗（红闪）+ A 级高亮列表
// 数据源：5s 轮询 /api/db/kv?key=anomaly_latest（服务端 intradaySprint 最新一条，
//   字段与 runIntradayBrain 同构：level/type/board/reason/severity/ts）
// 声音/通知：复用 alertBus.emit（同 id 15 分钟冷却内置）
// 交互：S 级弹窗出现 6s 自动收起 / 可手动关闭；迷你条点击展开最近 5 条
// ============================================================
import { useEffect, useRef, useState } from "react";
import { isLocalServer } from "../lib/cloudStore";
import { emit as alertEmit } from "../lib/alertBus";
import { getBJDateStr } from "../lib/format";

interface SprintEvent {
  id: string;
  level: "S" | "A" | "B";
  type: string;
  board: string | null;
  reason: string;
  severity: string;
  ts: number;
  /** v9.102.0：服务端落库带 date（YYYY-MM-DD），v9.106.1 前端用它做跨日校验 */
  date?: string;
}

const levelColor: Record<string, string> = {
  S: "bg-rose-500/25 text-rose-300 border-rose-500/50",
  A: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  B: "bg-sky-500/15 text-sky-300 border-sky-500/30",
};

export default function SpriteOverlay() {
  const [latest, setLatest] = useState<SprintEvent | null>(null);
  const [popup, setPopup] = useState<SprintEvent | null>(null); // S 级弹窗
  const [history, setHistory] = useState<SprintEvent[]>([]);
  const [expanded, setExpanded] = useState(false);
  const lastIdRef = useRef<string>("");
  const popupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isLocalServer()) return;
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/db/kv?key=anomaly_latest");
        const j = await r.json();
        const v = j?.value;
        if (!v || typeof v !== "object") return;
        const ev = v as SprintEvent;
        // v9.106.1（验收观察项②）：跨日校验 —— 盘前 anomaly_latest 残留昨日事件时清空，
        // 不再显示昨日"涨停潮"误导。事件日期 = 显式 date 字段优先，缺失时按 ts 换算北京日期
        // （覆盖历史无 date 字段的测试残留事件）
        const evDate = ev.date || (ev.ts ? getBJDateStr(new Date(ev.ts)) : "");
        if (evDate && evDate !== getBJDateStr()) {
          if (lastIdRef.current !== ev.id || latest != null) {
            setLatest(null);
            setPopup(null);
            setHistory([]);
          }
          return;
        }
        if (!ev.id || ev.id === lastIdRef.current) return;
        lastIdRef.current = ev.id;
        if (!alive) return;
        setLatest(ev);
        setHistory(prev => [ev, ...prev].slice(0, 5));
        // 声音/通知（复用 alertBus，同 id 15 分钟冷却）
        alertEmit({ severity: ev.severity as "critical" | "warning" | "info", id: `sprint_${ev.id}`, message: `⚡盘中精灵[${ev.level}] ${ev.reason}` });
        // S 级弹窗（红闪 6s 自动收起）
        if (ev.level === "S") {
          setPopup(ev);
          if (popupTimer.current) clearTimeout(popupTimer.current);
          popupTimer.current = setTimeout(() => setPopup(null), 6000);
        }
      } catch { /* 轮询失败静默 */ }
    };
    load();
    const t = setInterval(load, 5000); // 5s 轮询最新精灵事件
    return () => { alive = false; clearInterval(t); if (popupTimer.current) clearTimeout(popupTimer.current); };
  }, []);

  if (!latest && !popup) return null;

  return (
    <>
      {/* S 级弹窗（右下角上方，红闪 6s） */}
      {popup && (
        <div className={`fixed bottom-16 right-3 z-[100] w-80 rounded-xl border-2 p-3 shadow-2xl animate-pulse ${levelColor[popup.level]}`}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-black">⚡ 盘中精灵[{popup.level}] {popup.type}</span>
            <button onClick={() => setPopup(null)} className="text-xs text-slate-400 hover:text-white">✕</button>
          </div>
          <div className="text-[11px] leading-relaxed text-slate-200">{popup.reason}</div>
          {popup.board && <div className="mt-1 text-[10px] text-amber-300/80">板块：{popup.board}</div>}
        </div>
      )}

      {/* 右下角常驻迷你条 */}
      <div className="fixed bottom-3 right-3 z-[99] flex flex-col items-end gap-1">
        <button
          onClick={() => setExpanded(v => !v)}
          className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-bold shadow-lg backdrop-blur transition ${latest ? levelColor[latest.level] : "bg-white/5 text-slate-500 border-white/10"}`}
          title="盘中精灵：板块异动第一时间提醒"
        >
          ⚡ 精灵
          {latest && <span className="max-w-[180px] truncate">{latest.type}{latest.board ? `·${latest.board}` : ""}</span>}
        </button>
        {expanded && history.length > 0 && (
          <div className="w-72 rounded-xl border border-white/10 bg-black/80 p-2 space-y-1">
            {history.map(h => (
              <div key={h.id} className={`rounded px-2 py-1 text-[10px] ${levelColor[h.level]}`}>
                <span className="font-bold">[{h.level}] {h.type}</span>
                <span className="ml-1 text-slate-300">{h.reason}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
