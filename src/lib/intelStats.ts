// 代码计数器——模型不数数，代码完成全部计数统计
// 纯函数，不碰 DOM/localStorage/网络

import type { NewsItem, AnnItem } from "./llmNewsIntelligence";

// ============== 板块统计 ==============
export interface BoardStat {
  board: string;
  positive: number;
  negative: number;
  neutral: number;
  netScore: number;   // 热度 = 正−负（按 stars 加权：★★★=3, ★★=2, ★=1）
  starCount: number;  // ★★ 以上条目数
  topItems: Array<{ title: string; source: string; url?: string; sentiment: string }>;
}

export interface EventStructure {
  policy: number;   // 政策类
  company: number;  // 公司类
  domestic: number; // 国内
  foreign: number;  // 国外
}

export interface StatsResult {
  boardStats: BoardStat[];
  eventStructure: EventStructure;
}

// ============== 政策关键词（判断 policy vs company） ==============
const POLICY_KEYWORDS = [
  "国常会", "国务院", "央行", "中国人民银行", "证监会", "银保监",
  "发改委", "财政部", "工信部", "商务部", "科技部",
  "降准", "降息", "加息", "政策", "监管", "新规", "意见",
];

// ============== 核心统计 ==============

export function computeStats(news: NewsItem[], ann: AnnItem[]): StatsResult {
  // 板块分组
  const boardMap = new Map<string, {
    positive: number; negative: number; neutral: number;
    netScore: number; starCount: number;
    topItems: BoardStat["topItems"];
  }>();

  for (const n of news) {
    const boards = n.boards && n.boards.length > 0 ? n.boards : ["未分类"];
    const weight = n.stars >= 3 ? 3 : n.stars >= 2 ? 2 : 1;

    for (const board of boards) {
      const entry = boardMap.get(board) ?? {
        positive: 0, negative: 0, neutral: 0,
        netScore: 0, starCount: 0, topItems: [],
      };

      if (n.sentiment === "positive") { entry.positive++; entry.netScore += weight; }
      else if (n.sentiment === "negative") { entry.negative++; entry.netScore -= weight; }
      else { entry.neutral++; }

      if (n.stars >= 2) entry.starCount++;

      if (entry.topItems.length < 5) {
        entry.topItems.push({
          title: n.title,
          source: n.title,
          url: n.url,
          sentiment: n.sentiment,
        });
      }

      boardMap.set(board, entry);
    }
  }

  // 公告按真实板块归类（boards字段由boardMap精确匹配）
  for (const a of ann) {
    const boards = a.boards && a.boards.length > 0 ? a.boards : ["公告动态"];
    for (const board of boards) {
      const entry = boardMap.get(board) ?? { positive: 0, negative: 0, neutral: 0, netScore: 0, starCount: 0, topItems: [] };
      if (a.score && a.score >= 4) { entry.positive++; entry.netScore += 2; }
      else if (a.score && a.score <= 2) { entry.negative++; entry.netScore -= 2; }
      else { entry.neutral++; }
      if (a.score && a.score >= 4) entry.starCount++;
      if (entry.topItems.length < 5) entry.topItems.push({ title: `${a.stockName}：${a.title}`, url: a.url, source: a.title, sentiment: a.score && a.score >= 4 ? "positive" : a.score && a.score <= 2 ? "negative" : "neutral" });
      boardMap.set(board, entry);
    }
  }

  // 排序：|netScore| 降序
  const boardStats: BoardStat[] = [...boardMap.entries()]
    .map(([board, data]) => ({ board, ...data }))
    .sort((a, b) => Math.abs(b.netScore) - Math.abs(a.netScore));

  // 事件结构
  const eventStructure: EventStructure = { policy: 0, company: 0, domestic: 0, foreign: 0 };
  for (const n of news) {
    const text = n.title + (n.summary ?? "");
    if (POLICY_KEYWORDS.some(kw => text.includes(kw))) eventStructure.policy++;
    else eventStructure.company++;
    if (n.isOverseas) eventStructure.foreign++;
    else eventStructure.domestic++;
  }
  // 公告全部算公司类+国内
  eventStructure.company += ann.length;
  eventStructure.domestic += ann.length;

  return { boardStats, eventStructure };
}

// ============== 格式化给模型的文本块 ==============

export function formatStatsForPrompt(stats: StatsResult): string {
  const lines: string[] = [];
  lines.push("=== 板块情绪统计（代码统计，请勿自行计数）===");
  for (const b of stats.boardStats.slice(0, 15)) {
    const starStr = b.starCount > 0 ? ` ★★${b.starCount}` : "";
    lines.push(`${b.board} 利好${b.positive}/利空${b.negative}/中性${b.neutral} 热度${b.netScore >= 0 ? "+" : ""}${b.netScore}${starStr}`);
  }
  lines.push("=== 事件结构 ===");
  lines.push(`政策类${stats.eventStructure.policy} 公司类${stats.eventStructure.company} 国内${stats.eventStructure.domestic} 国外${stats.eventStructure.foreign}`);
  return lines.join("\n");
}

/** 格式化市场行情快照给模型 */
export function formatMarketBlock(
  marketSnapshot: { indices: Array<{ name: string; pct: number }>; mainNet: number; mainNet5d: number; mainNet10d: number } | null,
  limitPool: { limitUpCount: number; blastedRate: number; maxBoard?: number | null } | null,
): string {
  if (!marketSnapshot) return "=== 市场快照 ===\n暂无数据";
  const lines: string[] = ["=== 市场快照 ==="];
  lines.push(marketSnapshot.indices.slice(0, 4).map(i => `${i.name}${i.pct >= 0 ? "+" : ""}${i.pct.toFixed(2)}%`).join(" "));
  lines.push(`主力净额${(marketSnapshot.mainNet / 1e8).toFixed(1)}亿 5日${(marketSnapshot.mainNet5d / 1e8).toFixed(1)}亿 10日${(marketSnapshot.mainNet10d / 1e8).toFixed(1)}亿`);
  if (limitPool) {
    lines.push(`涨停${limitPool.limitUpCount} 炸板率${limitPool.blastedRate.toFixed(1)}%${limitPool.maxBoard != null ? ` 最高${limitPool.maxBoard}板` : ""}`);
  }
  return lines.join("\n");
}

/** 选热度最高的板块各取头部条目作为"支撑原文" */
export function pickTopSourced(stats: StatsResult, n = 5): Array<{ board: string; items: BoardStat["topItems"] }> {
  return stats.boardStats
    .filter(b => b.board !== "未分类" && b.board !== "公告动态")
    .slice(0, n)
    .map(b => ({ board: b.board, items: b.topItems }));
}
