// ============================================================
// src/lib/scenarios/auction.ts —— 竞价决策场景（v9.118.0，S4-1）
// 9:15-9:25 竞价量价匹配度评分 + 闸门判定 → 竞价打板/观望。
// 纯函数，0 token；服务端等价：server/lib/scenarios.js。
// ============================================================

export interface AuctionQuote {
  code: string;
  name?: string;
  /** 竞价涨幅 %（9:25 撮合价 vs 昨收） */
  auctionPct?: number | null;
  /** 竞价量比（vs 近 5 日均量） */
  volumeRatio?: number | null;
  /** 竞价成交额（万） */
  amount?: number | null;
  /** 是否主线/龙头 */
  isLeader?: boolean;
}

export interface AuctionVerdict {
  code: string;
  name: string;
  matchScore: number; // 0-100 匹配度
  decision: "竞价打板" | "竞价低吸" | "观望" | "回避";
  note: string;
}

/**
 * 竞价匹配度评分（规则近似，无委托簿明细时用量价代理）：
 * 龙头/主线 +25；高开 2-7%（强势不追高）分档；量比 ≥2 放量确认 +20；成交额规模 +15
 */
export function assessAuctionVolatility(q: AuctionQuote, cog: { risk?: { value?: { gateOpen?: boolean } } }): AuctionVerdict {
  let score = 40;
  const notes: string[] = [];
  if (q.isLeader) { score += 25; notes.push("主线/龙头"); }
  const pct = q.auctionPct;
  if (pct != null) {
    if (pct >= 2 && pct <= 7) { score += 15; notes.push(`高开${pct.toFixed(1)}% 强势区间`); }
    else if (pct > 7) { score -= 10; notes.push(`高开${pct.toFixed(1)}% 追高危险`); }
    else if (pct < -2) { score -= 20; notes.push(`低开${pct.toFixed(1)}% 弱`); }
    else { score += 5; notes.push("平开"); }
  } else { notes.push("竞价涨幅未知"); }
  if ((q.volumeRatio ?? 0) >= 2) { score += 20; notes.push(`量比${q.volumeRatio} 放量确认`); }
  else if ((q.volumeRatio ?? 0) >= 1) { score += 8; notes.push(`量比${q.volumeRatio} 温和`); }
  else { score -= 10; notes.push("量能不足"); }
  const amount = q.amount ?? 0;
  if (amount >= 5000) { score += 15; notes.push(`竞价${(amount / 10000).toFixed(1)}亿 大单`); }
  else if (amount >= 1000) { score += 6; notes.push(`竞价${(amount / 1000).toFixed(0)}千万`); }
  else { notes.push("竞价量小"); }
  score = Math.max(0, Math.min(100, score));
  const gateOpen = cog?.risk?.value?.gateOpen !== false;
  if (!gateOpen) score -= 25;
  const decision: AuctionVerdict["decision"] = !gateOpen ? "回避" : score >= 70 ? "竞价打板" : score >= 55 ? "竞价低吸" : "观望";
  return { code: q.code, name: q.name ?? q.code, matchScore: score, decision, note: notes.join("；") };
}
