// ============================================================
// v9.102.0（第二批 A，T-A3）：盘中精灵浮层（通达信"盘中精灵"效果）
// 右下角常驻迷你条 + S 级事件弹窗（红闪）+ A 级高亮列表
// 数据源：30s 轮询 /api/db/kv?key=anomaly:今日（v9.147.0 阶段二C 修复：
//   原 anomaly_latest 由已停用的 intradaySprint 写入=死源；改接 runIntradayBrain
//   （每 5 分钟活跃）落库的 anomaly:日期 —— 板块集体涨停/资金脉冲，取最新一条展示）
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

// v9.147.0（阶段二C）：anomaly:日期 条目（集体涨停/资金脉冲）→ 精灵事件形状
// S=critical（集体涨停）、A=warning（资金脉冲）、B=info
function anomalyToSprint(a: any): SprintEvent | null {
  if (!a || typeof a !== "object") return null;
  const type = String(a.type ?? "");
  const board = a.board ? String(a.board) : null;
  let reason = "";
  if (type === "集体涨停") {
    reason = `${board ?? ""} ${a.count ?? 0} 只涨停（最高 ${a.lbc ?? 1} 板）${a.stocks ? " · " + a.stocks : ""}`;
  } else if (type === "资金脉冲") {
    reason = `${board ?? ""} 涨 ${a.pct ?? 0}% · 主力净流入 ${((Number(a.mainNet ?? 0) / 1e8)).toFixed(1)} 亿`;
  } else {
    reason = String(a.reason ?? type ?? "");
  }
  const level = a.severity === "critical" ? "S" : a.severity === "warning" ? "A" : "B";
  return {
    id: `anomaly:${board ?? type}:${Math.floor(Number(a.ts ?? 0) / 60000)}`,
    level, type, board, reason,
    severity: String(a.severity ?? "info"),
    ts: Number(a.ts ?? Date.now()),
    date: String(a.date ?? getBJDateStr()),
  };
}

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
        const today = getBJDateStr();
        // v9.147.0：改读活跃源 anomaly:今日（runIntradayBrain 每 5 分钟写，数组取最新）
        const r = await fetch(`/api/db/kv?key=${encodeURIComponent(`anomaly:${today}`)}`);
        const j = await r.json();
        const v = j?.value;
        const arr = Array.isArray(v) ? v : (v && typeof v === "object" && "__raw" in v ? JSON.parse(v.__raw) : null);
        if (!Array.isArray(arr) || arr.length === 0) return;
        const ev = anomalyToSprint(arr[arr.length - 1]); // 最新一条
        if (!ev) return;
        // 跨日校验：事件日期必须等于今日（anomaly:今日 键已按日隔离，双保险）
        if (ev.date && ev.date !== today) return;
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
    const t = setInterval(load, 30000); // 30s 轮询（anomaly 每 5 分钟一批，30s 足够及时）
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
