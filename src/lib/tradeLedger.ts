// ============================================================
// P0-3：成交台账 —— 拍板后真实回填执行/平仓
// 数据：localStorage trade_ledger_v1 上限 200 条 + PG trade_ledger 表
// 关键：与 decision_post 通过 decision_post_ref 关联
// 核心价值：让"AI 提议 → 人类拍板 → 真实盈亏"闭环成立（不再只靠宏观情绪代理）
// ============================================================
import { isLocalServer } from "./cloudStore";
import { localDateStr } from "./format";

export type TradeAction = "buy" | "sell" | "stop" | "adjust";

export interface TradeEntry {
  id?: number;
  date: string;
  ts: number;
  decisionPostRef: string | null;
  code: string;
  name: string;
  action: TradeAction;
  price: number;
  quantity: number;
  cost?: number | null;       // 仅 buy
  pnlPct?: number | null;     // 仅 sell/stop
  notes?: string;
}

const LS_KEY = "trade_ledger_v1";
const LS_LIMIT = 200;

export function loadTrades(): TradeEntry[] {
  try {
    const arr = JSON.parse(localStorage.getItem(LS_KEY) ?? "[]");
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

export async function saveTrade(t: TradeEntry): Promise<void> {
  const arr = loadTrades();
  arr.unshift(t);
  while (arr.length > LS_LIMIT) arr.pop();
  try { localStorage.setItem(LS_KEY, JSON.stringify(arr)); } catch { /* 满 → 静默 */ }
  if (isLocalServer()) {
    try {
      await fetch("/api/db/trade_ledger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(t),
      });
    } catch { /* 服务端不可用：5 分钟同步兜底 */ }
  }
}

/** 计算平仓盈亏% (sell/stop) — 仅简单 (price-cost)/cost，不加仓位权重 */
export function computePnl(sellPrice: number, cost: number): number {
  if (cost <= 0) return 0;
  return Math.round((sellPrice - cost) / cost * 100 * 10) / 10;
}

// ============================================================
// 核心：拍板 → 真实 T+1/T+5 盈亏回填（用日 K 收盘价）
// ============================================================
import { fetchStockDailyCloses } from "./api";
import { loadRecentPosts, type DecisionPost } from "./decisionPost";

export interface PnlBackfillResult {
  t1: number | null;   // T+1 收盘 vs 拍板价 涨跌幅%
  t5: number | null;   // T+5 收盘 vs 拍板价 涨跌幅%
}

/**
 * 对一次拍板做 T+1/T+5 盈亏推断（真实日 K）
 * - 拍板价 priceAtPost 为基准（当天未收盘则取 T0 收盘近似——用日K当日收盘兜底）
 * - T+1 = 下一交易日收盘 vs 基准
 * - T+5 = 第5个交易日后收盘 vs 基准
 * 返回 { t1, t5 }，数据不足返回 null
 */
export async function backfillPostPnl(post: DecisionPost): Promise<PnlBackfillResult | null> {
  if (!post.code || !post.priceAtPost || post.priceAtPost <= 0) return null;
  try {
    const closes = await fetchStockDailyCloses(post.code, 10);
    if (!closes || closes.size < 2) return null;
    const dates = [...closes.keys()].sort();
    // 找拍板日（含当日）在日K序列的位置：取 >= 拍板日的第一个交易日作为 T0
    const postDate = post.date;
    let idx = dates.indexOf(postDate);
    if (idx < 0) {
      // 拍板日无K线（可能节假日/数据延迟），取拍板日之后最近一个交易日
      for (let i = 0; i < dates.length; i++) {
        if (dates[i] >= postDate) { idx = i; break; }
      }
      if (idx < 0) return null;
    }
    const baseClose = closes.get(dates[idx])!;
    // 基准：优先用拍板价（盘中拍板更准），但拍板价不可信时用当日收盘
    const base = post.priceAtPost > 0 ? post.priceAtPost : baseClose;
    if (base <= 0) return null;
    const t1 = dates[idx + 1] ? Math.round((closes.get(dates[idx + 1])! / base - 1) * 10000) / 100 : null;
    const t5 = dates[idx + 5] ? Math.round((closes.get(dates[idx + 5])! / base - 1) * 10000) / 100 : null;
    return { t1, t5 };
  } catch { return null; }  // 接口失败静默
}

/**
 * 批量回填：遍历近期全部 confirm 拍板，对 T+5 已到期的（≥7自然日）做真实回填
 * 幂等：同一拍板只回填一次（写 decision_post.pnl + executed 标记）
 * 返回回填条数（供 cron 日志/UI 显示）
 */
export async function backfillAllPendingPosts(days = 30): Promise<number> {
  const posts = loadRecentPosts(days).filter(p => p.humanAction === "confirm" && !p.executed && p.code);
  let count = 0;
  for (const post of posts) {
    // T+5 需要拍板后至少 7 个自然日（5 交易日 + 余量）
    const ageDays = Math.floor((Date.now() - post.ts) / 86400000);
    if (ageDays < 7) continue;
    try {
      const r = await backfillPostPnl(post);
      if (r && (r.t1 != null || r.t5 != null)) {
        // 落本地
        const arr = loadRecentPosts(3);
        const target = arr.find(p => p.ticketId === post.ticketId);
        if (target) {
          target.pnl = r.t5 ?? r.t1;
          target.executed = true;
          try {
            const dayArr = JSON.parse(localStorage.getItem(`decision_post:${post.date}`) ?? "[]");
            const i = dayArr.findIndex((x: DecisionPost) => x.ticketId === post.ticketId);
            if (i >= 0) { dayArr[i] = target; localStorage.setItem(`decision_post:${post.date}`, JSON.stringify(dayArr)); }
          } catch { /* 单条失败不影响 */ }
        }
        // 落 PG
        if (isLocalServer()) {
          try {
            await fetch("/api/db/decision_post/pnl", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ticketId: post.ticketId, pnl: r.t5 ?? r.t1, executed: true }),
            });
          } catch { /* 静默 */ }
        }
        count++;
      }
    } catch { /* 单条失败继续 */ }
  }
  return count;
}

/** 便捷：记录一笔成交（供拍板联动/手动录入用） */
export function recordTrade(opts: {
  decisionPostRef?: string | null;
  code: string;
  name?: string;
  action: TradeAction;
  price: number;
  quantity?: number;
  cost?: number | null;
  notes?: string;
}): Promise<void> {
  return saveTrade({
    date: localDateStr(),
    ts: Date.now(),
    decisionPostRef: opts.decisionPostRef ?? null,
    code: opts.code,
    name: opts.name ?? "",
    action: opts.action,
    price: opts.price,
    quantity: opts.quantity ?? 0,
    cost: opts.cost ?? null,
    pnlPct: opts.action === "sell" || opts.action === "stop" ? computePnl(opts.price, opts.cost ?? opts.price) : null,
    notes: opts.notes ?? "",
  });
}