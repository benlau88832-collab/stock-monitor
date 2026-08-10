// ============================================================
// v9.95.2（第五段 P1）：两融 AI 情绪研判 —— 基于全市场两融真实数据
// LLM 判断融资客情绪（偏多/中性/偏空），失败走规则兜底（净买入方向+余额趋势）
// 数据源：fetchMarginHistory（RPTA_RZRQ_LSHJ，T+1 披露，滞后 1-3 交易日）
// ============================================================
import { callAI, type AIResult } from "./ai";
import type { MarginHistoryRow } from "./margin";
import { setAIResult } from "./aiConclusionStore";

export interface MarginSentimentLLMResult {
  verdict: "偏多" | "中性" | "偏空";
  confidence: number;
  points: string[];
  fromLLM: boolean;
}

const VERDICTS = ["偏多", "中性", "偏空"] as const;

/** 构建研判输入文本：最新 3 日明细 + 5/10 日窗口统计（亿元） */
export function buildMarginPrompt(rows: MarginHistoryRow[]): string {
  const latest = rows[0];
  const lines: string[] = [];
  lines.push(`数据日期：${latest.date}（T+1 披露，可能滞后）`);
  lines.push(`融资余额：${(latest.rzBalance / 1e8).toFixed(1)} 亿（较前日 ${latest.rzBalance >= (rows[1]?.rzBalance ?? latest.rzBalance) ? "+" : ""}${((latest.rzBalance - (rows[1]?.rzBalance ?? latest.rzBalance)) / 1e8).toFixed(1)} 亿）`);
  lines.push(`融券余额：${(latest.rqBalance / 1e8).toFixed(1)} 亿`);
  lines.push(`最新日融资净买入：${latest.rzNet >= 0 ? "+" : ""}${(latest.rzNet / 1e8).toFixed(1)} 亿`);
  const sum5 = rows.slice(0, 5).reduce((s, r) => s + r.rzNet, 0);
  const sum10 = rows.slice(0, 10).reduce((s, r) => s + r.rzNet, 0);
  lines.push(`近5日融资净买入累计：${sum5 >= 0 ? "+" : ""}${(sum5 / 1e8).toFixed(1)} 亿`);
  lines.push(`近10日融资净买入累计：${sum10 >= 0 ? "+" : ""}${(sum10 / 1e8).toFixed(1)} 亿`);
  const rqChg = rows[1] && latest.rqBalance !== rows[1].rqBalance
    ? `融券余额较前日：${latest.rqBalance > rows[1].rqBalance ? "+" : ""}${((latest.rqBalance - rows[1].rqBalance) / 1e8).toFixed(1)} 亿`
    : "融券余额较前日：—";
  lines.push(rqChg);
  return lines.join("\n");
}

/** 规则兜底：净买入 5 日方向 + 余额趋势 */
function ruleFallback(rows: MarginHistoryRow[]): MarginSentimentLLMResult {
  const latest = rows[0];
  const prev = rows[1];
  const sum5 = rows.slice(0, 5).reduce((s, r) => s + r.rzNet, 0);
  const balanceUp = prev ? latest.rzBalance > prev.rzBalance : null;
  let verdict: MarginSentimentLLMResult["verdict"] = "中性";
  const points: string[] = [];
  if (sum5 > 0 && balanceUp !== false) {
    verdict = "偏多";
    points.push(`近5日融资净买入+${(sum5 / 1e8).toFixed(1)}亿`);
  } else if (sum5 < 0 && balanceUp !== true) {
    verdict = "偏空";
    points.push(`近5日融资净偿还${(-sum5 / 1e8).toFixed(1)}亿`);
  } else {
    points.push(`近5日融资净买入${sum5 >= 0 ? "+" : ""}${(sum5 / 1e8).toFixed(1)}亿，方向不明`);
  }
  points.push("规则版（LLM不可用）");
  return { verdict, confidence: 50, points, fromLLM: false };
}

/** 两融情绪研判：LLM 优先，失败规则兜底；结果登记 aiConclusionStore（全站可见） */
export async function judgeMarginSentiment(rows: MarginHistoryRow[]): Promise<MarginSentimentLLMResult> {
  if (!rows || rows.length === 0) {
    return { verdict: "中性", confidence: 40, points: ["暂无两融数据"], fromLLM: false };
  }
  const prompt = buildMarginPrompt(rows);
  let result: AIResult;
  try {
    result = await callAI("marginSentiment", { prompt });
  } catch {
    return ruleFallback(rows);
  }
  if (result.degraded) return ruleFallback(rows);
  try {
    const parsed = JSON.parse(result.text) as { verdict?: string; confidence?: number; points?: unknown };
    const verdict = VERDICTS.includes(parsed.verdict as never) ? parsed.verdict as MarginSentimentLLMResult["verdict"] : "中性";
    const confidence = Number(parsed.confidence);
    const points = Array.isArray(parsed.points) ? parsed.points.slice(0, 3).map(String) : [];
    const out: MarginSentimentLLMResult = { verdict, confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(100, confidence)) : 50, points, fromLLM: true };
    try { setAIResult("marginSentiment", "market", { verdict: out.verdict, confidence: out.confidence, points: out.points, ts: Date.now() }, "auto"); } catch { /* 静默 */ }
    return out;
  } catch {
    return ruleFallback(rows);
  }
}
