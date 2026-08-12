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
import type { StockBrief } from "./api";

export interface SourceMeta { source: "pg" | "push2" | "tencent" | "push2delay" | "none"; asOf: number; stale: boolean; }

/** 结构化大盘快照（情绪/涨停/炸板/主线/资金/闸门）→ 永远 PG（cron 落库，新鲜且不被断） */
export async function fetchMarketSnapshot(): Promise<{ data: any; meta: SourceMeta } | null> {
  if (!isLocalServer()) return null;
  try {
    const r = await fetch("/api/brain/context", { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const j = await r.json();
    const ts = j?.sources?.market ?? j?.snapshotVersion ?? Date.now();
    const stale = Date.now() - (ts ?? 0) > 25 * 60 * 1000; // >25min 标延迟（cron 最慢 20min 周期 + 余量）
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
