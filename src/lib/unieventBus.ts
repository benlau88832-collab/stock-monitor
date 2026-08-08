// ============================================================
// P2-5：统一事件总线 —— 事件广播元数据层（可查询可追溯）
// 与 alertBus 关系：alertBus 负责"前端通知"（声音/系统通知/标题闪烁/推送）；
// unieventBus 负责"事件留痕"（本地 + PG kv:unievent_log:日期）
// 接入方式：各触发源调 emitEvent 即可（alertBus 可同时 emit 做通知）
// ============================================================
import { localDateStr } from "./format";
import { isLocalServer } from "./cloudStore";

export type UniEventType = "watch" | "veto" | "seal" | "nuclear" | "auction" | "lhb" | "ai_post" | "sys_risk" | "sentiment";
export type UniSeverity = "info" | "warning" | "critical";

export interface UniEvent {
  id: string;
  ts: number;
  type: UniEventType;
  severity: UniSeverity;
  message: string;
  meta?: Record<string, unknown>;
}

const LS_KEY = "unievent_bus_log_v1";
const LS_LIMIT = 100;

function loadEvents(): UniEvent[] {
  try {
    const arr = JSON.parse(localStorage.getItem(LS_KEY) ?? "[]");
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function saveEvents(events: UniEvent[]): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(events.slice(0, LS_LIMIT))); } catch { /* 满 → 静默 */ }
}

/** 发布一条统一事件（本地留痕 + PG kv:unievent_log:日期 增量） */
export function emitEvent(e: Omit<UniEvent, "ts">): UniEvent {
  const full: UniEvent = { ...e, ts: Date.now() };
  const events = loadEvents();
  // 同 id 冷却 15 分钟（与 alertBus 对齐，防刷屏）
  const dup = events.find(x => x.id === full.id);
  if (dup && Date.now() - dup.ts < 15 * 60 * 1000) return dup;
  events.unshift(full);
  saveEvents(events);
  // 同步 PG（本地部署）
  if (isLocalServer()) {
    try {
      const key = `unievent_log:${localDateStr()}`;
      fetch("/api/db/kv", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value: JSON.stringify(events.filter(x => x.ts > Date.now() - 86400000)) }),
      }).catch(() => {});
    } catch { /* 静默 */ }
  }
  return full;
}

/** 查询事件列表（可选过滤） */
export function listEvents(filter?: Partial<UniEvent>): UniEvent[] {
  let arr = loadEvents();
  if (filter) {
    if (filter.type) arr = arr.filter(x => x.type === filter.type);
    if (filter.severity) arr = arr.filter(x => x.severity === filter.severity);
  }
  return arr;
}

/** 今日事件统计（按类型） */
export function statsByType(): Record<string, number> {
  const events = loadEvents();
  const today = localDateStr();
  const out: Record<string, number> = {};
  for (const e of events) {
    const d = new Date(e.ts);
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (ds !== today) continue;
    out[e.type] = (out[e.type] ?? 0) + 1;
  }
  return out;
}