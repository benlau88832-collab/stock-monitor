import { isLocalServer } from "./cloudStore";
import { apiFetch } from "./cloudStore";
import { localDateStr } from "./format";

export type HumanAction = "confirm" | "watch" | "reject";

export interface DecisionPost {
  ticketId: string;
  date: string;
  ts: number;
  mainline: string | null;
  code: string | null;
  humanAction: HumanAction;
  confidenceAtPost: number | null;
  priceAtPost: number | null;
  notes: string;
  decisionLogRef: string | null;
  executed: boolean;
  pnl: number | null;
  simulated?: boolean;
}

const KEY_PREFIX = "decision_post:";

export function makeTicketId(date: string, mainline: string | null, code: string | null, actionType: string): string {
  const tail = String(Date.now()).slice(-6);
  const subject = (code ?? mainline ?? "default").replace(/[^\w\u4e00-\u9fa5]/g, "").slice(0, 12);
  return `${date}_${actionType}_${subject}_${tail}`;
}

export function loadDayPosts(date?: string): DecisionPost[] {
  const d = date ?? localDateStr();
  try {
    const arr = JSON.parse(localStorage.getItem(KEY_PREFIX + d) ?? "[]");
    if (!Array.isArray(arr)) return [];
    return (arr as DecisionPost[]).sort((a, b) => b.ts - a.ts);
  } catch { return []; }
}

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

export function hasPosted(decisionLogRef: string): boolean {
  if (!decisionLogRef) return false;
  const recent = loadRecentPosts(3);
  return recent.some((p) => p.decisionLogRef === decisionLogRef);
}

export async function savePost(post: DecisionPost): Promise<void> {
  const d = post.date;
  const key = KEY_PREFIX + d;
  const arr = loadDayPosts(d);
  if (arr.some((p) => p.ticketId === post.ticketId)) return;
  arr.push(post);
  try { localStorage.setItem(key, JSON.stringify(arr)); } catch { /* full */ }
  if (isLocalServer()) {
    try {
      await apiFetch("/api/db/decision_post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(post),
      });
    } catch { /* cloud sync fallback */ }
  }
  try {
    const { appendSignal } = await import("./signalLedger");
    appendSignal({
      date: post.date,
      type: "ai_decision",
      typeLabel: `AI裁决·${post.humanAction === "confirm" ? "确认上车" : post.humanAction === "watch" ? "观望" : "否决"}`,
      code: post.code ?? "MARKET",
      name: post.mainline ?? post.code ?? "-",
      priceAtSignal: post.priceAtPost ?? 0,
      description: `AI裁决 ${post.mainline ?? ""} → 人类拍板 ${post.humanAction}`,
    });
  } catch { /* ignore */ }
  try {
    const { updateUserProfile } = await import("./userProfile");
    updateUserProfile();
  } catch { /* ignore */ }
}

export function buildPost(opts: {
  mainline?: string | null;
  code?: string | null;
  humanAction: HumanAction;
  confidenceAtPost?: number | null;
  priceAtPost?: number | null;
  notes?: string;
  decisionLogRef?: string | null;
  simulated?: boolean;
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
    simulated: opts.simulated ?? false,
  };
}
