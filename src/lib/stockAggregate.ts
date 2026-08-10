// ============================================================
// v9.95.3（第五段 P1）：个股聚合器接线 —— 消费 /api/db/stock/:code 全景端点
// 公告+新闻+舆情(sentiment 统计)+政策+席位+涨停历史 → 一次聚合 → LLM 综合研判
// 背景：端点 v9.84 已建但全仓库无消费方（验收缺口），本模块补消费 + AI 分析管线
// ============================================================
import { callAI, type AIResult } from "./ai";

export interface StockAggregateData {
  code: string;
  concepts: { themes: string[]; allBoards?: string[]; hybk?: string } | null;
  news: Array<{ title: string; time: string; sentiment?: string | null }>;
  announcements: Array<{ title: string; stock_name?: string; column_name?: string; time: string }>;
  reports: unknown[];
  watch: unknown[];
  seats: Array<{ date: string; deptName: string; direction: string; net: number }>;
  ztHistory: Array<{ date: string; lbc: number; hybk?: string }>;
  /** v9.95.3：政策维度（近3日泛市场政策快讯） */
  policy: Array<{ title: string; time: string }>;
  /** v9.95.3：舆情统计（news sentiment 聚合） */
  sentimentSummary: { bullish: number; bearish: number; neutral: number } | null;
  asOf: string;
}

export interface StockAggregateLLMResult {
  verdict: "关注" | "回避" | "中性";
  thesis: string;
  risks: string[];
  watch: string;
  fromLLM: boolean;
}

/** 拉取聚合端点（失败返回 null） */
export async function fetchStockAggregate(code: string): Promise<StockAggregateData | null> {
  try {
    const resp = await fetch(`/api/db/stock/${code}`);
    if (!resp.ok) return null;
    return await resp.json() as StockAggregateData;
  } catch { return null; }
}

/** 构造研判输入文本（聚合各维度 → 结构化文本） */
export function buildAggregatePrompt(d: StockAggregateData): string {
  const lines: string[] = [];
  lines.push(`股票代码：${d.code}`);
  if (d.concepts) {
    lines.push(`概念：${d.concepts.themes?.join("、") || (d.concepts.allBoards?.join("、") ?? "无")}${d.concepts.hybk ? `（行业 ${d.concepts.hybk}）` : ""}`);
  } else {
    lines.push("概念：无数据");
  }
  if (d.news && d.news.length > 0) {
    lines.push(`最新新闻（${d.news.length} 条）：${d.news.slice(0, 5).map(n => n.title).join("；")}`);
  }
  if (d.announcements && d.announcements.length > 0) {
    lines.push(`最新公告（${d.announcements.length} 条）：${d.announcements.slice(0, 5).map(a => a.title).join("；")}`);
  }
  if (d.policy && d.policy.length > 0) {
    lines.push(`近期政策：${d.policy.slice(0, 3).map(p => p.title).join("；")}`);
  }
  if (d.sentimentSummary) {
    lines.push(`舆情（消息面统计）：利好${d.sentimentSummary.bullish} / 利空${d.sentimentSummary.bearish} / 中性${d.sentimentSummary.neutral}`);
  }
  if (d.seats && d.seats.length > 0) {
    const buys = d.seats.filter(s => s.direction === "买").slice(0, 3);
    const sells = d.seats.filter(s => s.direction === "卖").slice(0, 3);
    lines.push(`近45日席位：净买 ${buys.map(b => `${b.deptName?.slice(0, 12)}${(b.net / 1e4).toFixed(0)}万`).join("、") || "无"}；净卖 ${sells.map(sl => `${sl.deptName?.slice(0, 12)}${(sl.net / 1e4).toFixed(0)}万`).join("、") || "无"}`);
  }
  if (d.ztHistory && d.ztHistory.length > 0) {
    lines.push(`近30日涨停历史：${d.ztHistory.map(z => `${z.date} ${z.lbc}板`).join("、")}`);
  } else {
    lines.push("近30日涨停历史：无");
  }
  return lines.join("\n");
}

/** 规则兜底：有涨停历史或利好舆情 > 利空 → 关注；利空 > 利好且无涨停 → 回避；否则中性 */
function ruleFallback(d: StockAggregateData): StockAggregateLLMResult {
  const zt = (d.ztHistory?.length ?? 0) > 0;
  const s = d.sentimentSummary;
  const bull = s?.bullish ?? 0;
  const bear = s?.bearish ?? 0;
  if (zt && bull >= bear) return { verdict: "关注", thesis: `近期有涨停记录${d.ztHistory?.[0] ? `（${d.ztHistory[0].date} ${d.ztHistory[0].lbc}板）` : ""}，消息面舆情偏暖`, risks: [], watch: "连板高度能否延续", fromLLM: false };
  if (bear > bull && !zt) return { verdict: "回避", thesis: "消息面利空占优且无涨停记录支撑", risks: ["舆情偏空"], watch: "利空消化情况", fromLLM: false };
  return { verdict: "中性", thesis: "规则版（LLM不可用）：数据面信号不明确", risks: [], watch: "", fromLLM: false };
}

/** 聚合 AI 综合研判：LLM 优先，失败规则兜底 */
export async function judgeStockAggregate(d: StockAggregateData): Promise<StockAggregateLLMResult> {
  const prompt = buildAggregatePrompt(d);
  let result: AIResult;
  try {
    result = await callAI("stockAggregate", { prompt });
  } catch { return ruleFallback(d); }
  if (result.degraded) return ruleFallback(d);
  try {
    const parsed = JSON.parse(result.text) as { verdict?: string; thesis?: string; risks?: unknown; watch?: string };
    const verdict = ["关注", "回避", "中性"].includes(parsed.verdict ?? "") ? parsed.verdict as StockAggregateLLMResult["verdict"] : "中性";
    return {
      verdict,
      thesis: String(parsed.thesis ?? "").slice(0, 140),
      risks: Array.isArray(parsed.risks) ? parsed.risks.slice(0, 2).map(String) : [],
      watch: String(parsed.watch ?? "").slice(0, 30),
      fromLLM: true,
    };
  } catch { return ruleFallback(d); }
}
