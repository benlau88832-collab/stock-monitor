// ============================================================
// P0-1：人类拍板台账 —— 把"AI 提议 → 人类拍板"这一关键环节记录下来
// 数据：localStorage decision_post:YYYY-MM-DD（cloudStore 5 分钟同步 PG decision_post 表）
// ticket_id 唯一颗粒：同一次 AI 裁决只能拍一次板
// 作用：补全决策闭环中"人类决策"环节的留痕，配合 P0-3 做真实盈亏归因
// ============================================================
import { isLocalServer } from "./cloudStore";
import { localDateStr } from "./format";

export type HumanAction = "confirm" | "watch" | "reject";

export interface DecisionPost {
  ticketId: string;            // 主键（日期 + actionType + 主题 + ms 末段）
  date: string;                // YYYY-MM-DD（本地日）
  ts: number;                  // 毫秒戳
  mainline: string | null;     // 主线决策时填，个股决策可空
  code: string | null;         // 个股决策时填，主线决策可空
  humanAction: HumanAction;
  confidenceAtPost: number | null;
  priceAtPost: number | null;
  notes: string;
  decisionLogRef: string | null;  // 关联原 AI 裁决的 ts string（用于配对）
  executed: boolean;              // P0-3 修改
  pnl: number | null;            // P0-3 修改
}

const KEY_PREFIX = "decision_post:";

/** 生成 ticket_id：日期 + actionType + 主题 + 6 位 ms 末段 */
export function makeTicketId(date: string, mainline: string | null, code: string | null, actionType: string): string {
  const tail = String(Date.now()).slice(-6);
  const subject = (code ?? mainline ?? "default").replace(/[^\w\u4e00-\u9fa5]/g, "").slice(0, 12);
  return `${date}_${actionType}_${subject}_${tail}`;
}

/** 读取当日拍板记录（按 ts 倒序） */
export function loadDayPosts(date?: string): DecisionPost[] {
  const d = date ?? localDateStr();
  try {
    const arr = JSON.parse(localStorage.getItem(KEY_PREFIX + d) ?? "[]");
    if (!Array.isArray(arr)) return [];
    return (arr as DecisionPost[]).sort((a, b) => b.ts - a.ts);
  } catch { return []; }
}

/** 读取近 N 天拍板记录（按 ts 全局倒序） */
export function loadRecentPosts(days = 30): DecisionPost[] {
  const all: DecisionPost[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    all.push(...loadDayPosts(ds));
  }
  return all.sort((a, b) => b.ts - a.ts);
}

/** 是否已经对某次 AI 裁决拍过板（按 decisionLogRef 近 3 天查） */
export function hasPosted(decisionLogRef: string): boolean {
  if (!decisionLogRef) return false;
  const recent = loadRecentPosts(3);
  return recent.some(p => p.decisionLogRef === decisionLogRef);
}

/** 写入一条拍板（同 ticketId 幂等不重复写） */
export async function savePost(post: DecisionPost): Promise<void> {
  const d = post.date;
  const key = KEY_PREFIX + d;
  const arr = loadDayPosts(d);
  if (arr.some(p => p.ticketId === post.ticketId)) return;  // 幂等
  arr.push(post);
  try { localStorage.setItem(key, JSON.stringify(arr)); } catch { /* 容量满：静默 */ }
  if (isLocalServer()) {
    try {
      await fetch("/api/db/decision_post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(post),
      });
    } catch { /* 服务端不可用：5 分钟 cloudStore 同步兜底 */ }
  }
  // P1-7：AI 决策拍板同步进入信号账本（纳入净值曲线统一核算；线上无 signalLedger 也可用）
  try {
    const { appendSignal } = await import("./signalLedger");
    appendSignal({
      date: post.date,
      type: "ai_decision",
      typeLabel: `AI裁决·${post.humanAction === "confirm" ? "确认上车" : post.humanAction === "watch" ? "观望" : "否决"}`,
      code: post.code ?? "MARKET",
      name: post.mainline ?? post.code ?? "—",
      priceAtSignal: post.priceAtPost ?? 0,
      description: `AI裁决 ${post.mainline ?? ""} → 人类拍 ${post.humanAction}`,
    });
  } catch { /* 失败不影响主链 */ }
}

/** 构造拍板对象（提供给按钮 handler 用） */
export function buildPost(opts: {
  mainline?: string | null;
  code?: string | null;
  humanAction: HumanAction;
  confidenceAtPost?: number | null;
  priceAtPost?: number | null;
  notes?: string;
  decisionLogRef?: string | null;
}): DecisionPost {
  const date = localDateStr();
  return {
    ticketId: makeTicketId(date, opts.mainline ?? null, opts.code ?? null, opts.humanAction),
    date,
    ts: Date.now(),
    mainline: opts.mainline ?? null,
    code: opts.code ?? null,
    humanAction: opts.humanAction,
    confidenceAtPost: opts.confidenceAtPost ?? null,
    priceAtPost: opts.priceAtPost ?? null,
    notes: opts.notes ?? "",
    decisionLogRef: opts.decisionLogRef ?? null,
    executed: false,
    pnl: null,
  };
}