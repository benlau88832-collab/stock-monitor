// ============================================================
// src/lib/dataLayer.ts —— 统一数据层（v9.113.0，T0-1/T0-2）
// 终审架构核心：结构化数据 PG 优先（2-20min 新鲜，不被 WAF 断）；
// 实时点位/现价走降级链 push2(健康)→腾讯→push2delay(最后)。
// 所有主面板/AI 经此层取数 → push2 断时显示 PG/腾讯新鲜数据 + asOf 标注，横幅不再常驻。
// 复用（T0-2 不重造轮子）：
//   - PG：/api/brain/context（market/limitLadder/mainlines/boardFund/sentiment）
//   - 实时报价：api.ts fetchStockBriefBatch（v9.109.3 已内置 push2→腾讯降级链）
//   - 源健康：jsonpQueue getSourceState（push2 最近命中判定）
// ============================================================
import { isLocalServer } from "./cloudStore";
import { getSourceState } from "./jsonpQueue";
import { getCurrentSession } from "./tradingSession";
import type { StockBrief, LimitPoolSummary } from "./api";

export interface SourceMeta { source: "pg" | "push2" | "tencent" | "push2delay" | "none"; asOf: number; stale: boolean; }

/** 结构化大盘快照（情绪/涨停/炸板/主线/资金/闸门）→ 永远 PG（cron 落库，新鲜且不被断） */
export async function fetchMarketSnapshot(): Promise<{ data: any; meta: SourceMeta } | null> {
  if (!isLocalServer()) return null;
  try {
    const r = await fetch("/api/brain/context", { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const j = await r.json();
    const ts = j?.sources?.market ?? j?.snapshotVersion ?? Date.now();
    // v9.113.1（T1-1）：stale 语义修正 —— 盘后/休市 market_daily 为收盘终值（不再更新），asOf 距今超时不算延迟；
    //   仅盘中/竞价（cron 每 5min 应持续更新）按 >25min 标延迟。盘后误标 stale → 横幅"PG 均不可达"误弹（实测 29min 触发）
    const phase = getCurrentSession().phase;
    const isClosed = phase !== "trading" && phase !== "auction";
    const stale = !isClosed && Date.now() - (ts ?? 0) > 25 * 60 * 1000; // 盘中 >25min 标延迟（cron 最慢 20min 周期 + 余量）
    return { data: j, meta: { source: "pg", asOf: ts ?? Date.now(), stale } };
  } catch { return null; }
}

/**
 * 实时报价（现价/涨跌/成交/换手）→ 降级链 push2(健康)→腾讯→push2delay(最后)。
 * 复用 fetchStockBriefBatch（内部已含 push2 全败 → 腾讯兜底）；命中源从 getSourceState 推断。
 */
export async function fetchLiveQuote(codes: string[]): Promise<{ quotes: Map<string, StockBrief>; meta: SourceMeta } | null> {
  if (codes.length === 0) return null;
  const { fetchStockBriefBatch } = await import("./api");
  const quotes = await fetchStockBriefBatch(codes);
  if (quotes.size === 0) return { quotes, meta: { source: "none", asOf: Date.now(), stale: true } };
  // 命中源推断：push2 最近 2min 有成功记录 → push2；否则（fetchStockBriefBatch 走了腾讯兜底）→ tencent
  const states = getSourceState();
  const push2Hit = states.find(s => s.host.includes("push2.eastmoney.com") && Date.now() - s.at < 120_000);
  const source: SourceMeta["source"] = push2Hit ? "push2" : "tencent";
  return { quotes, meta: { source, asOf: Date.now(), stale: false } };
}

/**
 * v9.113.1（T1-1 D-01 收尾）：PG 快照 → LimitPoolSummary 派生（纯函数，可单测）。
 * 语义：实时池（push2 直连）不可用/降级时，用 PG 快照（cron 2-20min 落库）合成涨停池展示，
 * 优先级：实时池成功非 degraded > PG 派生池 > push2delay 降级池（15min 旧，仅 PG 也空时）。
 * 注意：rawZTPool 来自 PG ladder（最多 20 条精简），仅用于展示，不得用于 zt_snapshot 落盘。
 */
export function buildPgLimitPool(snap: { data?: any; meta?: SourceMeta } | null): LimitPoolSummary | null {
  if (!snap || !snap.data) return null;
  const mkt = snap.data.market ?? null;
  const ladder = snap.data.limitLadder ?? null;
  if (!mkt || !ladder) return null;
  // 涨停计数必须来自今日快照：market_daily 回退最近交易日（fallbackDate 非空，盘中未落库场景）
  // 或 zt_snapshot 无今日池（ladder.total=0）→ 不得合成 —— 昨日涨停数冒充今日会污染情绪/梯队展示
  if (snap.data.fallbackDate) return null;
  if (!(ladder.total > 0)) return null;
  const ztCount = typeof mkt.ztCount === "number" ? mkt.ztCount : null;
  if (ztCount == null || ztCount <= 0) return null;
  const boardCounts: Record<number, number> = {};
  for (const [k, v] of Object.entries(ladder.boardCounts ?? {})) {
    const lbc = Number(k);
    if (Number.isFinite(lbc) && Number.isFinite(Number(v))) boardCounts[lbc] = Number(v);
  }
  const ladderRows: any[] = Array.isArray(ladder.ladder) ? ladder.ladder : [];
  const qdate = typeof snap.data.date === "string" ? snap.data.date.replace(/-/g, "") : null;
  return {
    limitUpCount: ztCount,
    limitDownCount: typeof mkt.dtCount === "number" ? mkt.dtCount : 0,
    blastedCount: typeof mkt.zbCount === "number" ? mkt.zbCount : 0,
    blastedRate: typeof mkt.blastedRate === "number" ? mkt.blastedRate : 0,
    boardCounts,
    totalBoardStocks: Object.entries(boardCounts).filter(([k]) => Number(k) >= 2).reduce((s, [, v]) => s + v, 0),
    rawZTPool: ladderRows.map(r => ({ c: r.code, n: r.name, lbc: r.lbc ?? 1, hybk: r.hybk ?? "" })),
    qdate,
    totalCount: ztCount,
    isTradingDay: true,
  };
}
