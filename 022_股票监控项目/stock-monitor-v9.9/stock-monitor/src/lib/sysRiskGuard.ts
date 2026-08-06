// ============================================================
// 系统性风险预警（v9.32 · 游资审查缺口3）
// 背景：系统性杀跌时所有主线分析失效，游资第一眼必须看"大盘是否安全"。
// 本模块：基于已有 overview 数据（沪深300涨幅/跌停数/炸板率/情绪）输出 red/yellow 预警。
// 纯函数，不碰 DOM/localStorage/网络
// ============================================================

import { BLAST_RATE_EXTREME, BLAST_RATE_HIGH, DT_COUNT_PANIC, DT_COUNT_WARN, SENTI_ICEBERG, SENTI_EXTREME_GREED, HS300_CRASH, HS300_WARN } from "./thresholds";

export interface SysRiskInput {
  /** 沪深300 涨跌幅 %（从 overview.indices 找 code=000300） */
  hs300Pct: number | null;
  /** 今日跌停家数 */
  limitDownCount: number;
  /** 今日炸板率 % */
  blastedRate: number;
  /** 情绪温度计 0-100 */
  sentiment: number | null;
}

export interface SysRiskVerdict {
  level: "red" | "yellow" | "none";
  reasons: string[];
  /** 一句话汇总（供 AlertBanner 展示） */
  text: string;
}

export function checkSysRisk(input: SysRiskInput): SysRiskVerdict {
  const { hs300Pct, limitDownCount, blastedRate, sentiment } = input;
  const redReasons: string[] = [];
  const yellowReasons: string[] = [];

  // ---- red 级（系统性杀跌，所有主线失效） ----
  if (hs300Pct != null && hs300Pct <= HS300_CRASH) redReasons.push(`沪深300 ${hs300Pct.toFixed(2)}%（系统性杀跌）`);
  if (limitDownCount >= DT_COUNT_PANIC) redReasons.push(`跌停 ${limitDownCount} 只（恐慌蔓延）`);
  if (blastedRate >= BLAST_RATE_EXTREME) redReasons.push(`炸板率 ${blastedRate.toFixed(0)}%（极端分歧）`);
  if (sentiment != null && sentiment <= SENTI_ICEBERG) redReasons.push(`情绪 ${sentiment}（冰点）`);

  if (redReasons.length > 0) {
    return { level: "red", reasons: redReasons, text: `🔴 系统性风险预警：${redReasons.join("，")}，建议空仓观望` };
  }

  // ---- yellow 级（风险偏高，收缩战线） ----
  if (hs300Pct != null && hs300Pct <= HS300_WARN) yellowReasons.push(`沪深300 ${hs300Pct.toFixed(2)}%`);
  if (limitDownCount >= DT_COUNT_WARN) yellowReasons.push(`跌停 ${limitDownCount} 只`);
  if (blastedRate >= BLAST_RATE_HIGH) yellowReasons.push(`炸板率 ${blastedRate.toFixed(0)}%`);
  if (sentiment != null && sentiment >= SENTI_EXTREME_GREED) yellowReasons.push(`情绪 ${sentiment}（极度贪婪）`);

  if (yellowReasons.length > 0) {
    return { level: "yellow", reasons: yellowReasons, text: `🟡 风险偏高：${yellowReasons.join("，")}，建议收缩战线` };
  }

  return { level: "none", reasons: [], text: "" };
}
