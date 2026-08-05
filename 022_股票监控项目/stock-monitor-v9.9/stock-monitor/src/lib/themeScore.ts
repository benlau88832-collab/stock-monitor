// 板块评分：四维权重 fund/ladder/stage/news
// news 权重随阶段动态浮动（可调）：启动期30%/发酵期20%/高潮期10%
// LLM catalyst 可异步覆盖 news 维度
// 纯函数，不碰 DOM/localStorage/网络

import { buildThemeLadder, type ZTPoolItem, type ThemeGroup } from "./themeLadder";
// v9.27：阶段权重与分数映射收敛到 stageModel（单一权威，防止词表再次漂移）
import { NEWS_WEIGHT_BY_STAGE, STAGE_SCORE_MAP } from "./stageModel";

// ============== 梯队归并别名表（可维护：常见板块名↔hybk行业名映射） ==============
const LADDER_ALIASES: Array<[string, string]> = [
  ["半导体", "电子"],
  ["白酒", "食品饮料"],
  ["光伏", "电力设备"],
  ["锂电池", "电力设备"],
  ["新能源车", "汽车"],
  ["军工", "国防军工"],
  ["证券", "非银金融"],
  ["AI概念", "计算机"],
  ["芯片", "半导体"],
];

/** 双向模糊匹配：板块名与 hybk 任一方向包含即命中，或命中别名表 */
function fuzzyMatchLadder(boardName: string, ladderMap: Map<string, ThemeGroup>): ThemeGroup | null {
  // 精确匹配
  if (ladderMap.has(boardName)) return ladderMap.get(boardName)!;
  // 双向包含
  for (const [hybk, g] of ladderMap) {
    if (boardName.includes(hybk) || hybk.includes(boardName)) return g;
  }
  // 别名表
  for (const [a, b] of LADDER_ALIASES) {
    if (boardName.includes(a) && ladderMap.has(b)) return ladderMap.get(b)!;
    if (boardName.includes(b) && ladderMap.has(a)) return ladderMap.get(a)!;
    // 反向
    for (const [hybk, g] of ladderMap) {
      if ((a === boardName || boardName.includes(a)) && hybk.includes(b)) return g;
      if ((b === boardName || boardName.includes(b)) && hybk.includes(a)) return g;
    }
  }
  return null;
}

// ============== 基础权重（可调） ==============
const W_FUND_BASE = 0.35;
const W_LADDER_BASE = 0.25;
const W_STAGE_BASE = 0.20;
const W_NEWS_BASE = 0.20;

// 消息维度按阶段浮动权重（v9.27：来自 stageModel.NEWS_WEIGHT_BY_STAGE）

/** 浮动时梯队权重被压缩到的值（可调） */
const LADDER_COMPRESSED = 0.15;

function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v));
}

// ============== 板块关键词：改用数据驱动的 boardMap ==============
// 导入动态板块词表匹配函数，替代旧的硬编码关键词
import { matchBoardsByText } from "./boardMap";

// ============== 输入类型 ==============
import type { BoardKind } from "./boardTaxonomy";

export interface BoardFlowBrief {
  code: string; name: string; pct: number;
  mainNetPct: number; mainNet5dPct: number; mainNet10dPct: number;
  stage: string;
  kind?: BoardKind; // 板块类型（行业/题材）
}

export interface ThemeScoreResult {
  board: string;
  total: number;
  factors: { fund: number; ladder: number; stage: number; news: number };
  role: string;
  newsSource: "LLM" | "规则版";
  tier: "A" | "B" | "C";
  kind: BoardKind; // 板块类型（行业/题材）
}

export interface NewsItem { title: string; stars: number; }

/** LLM 催化覆盖项（从 llmSignals 异步获取后传入） */
export interface LLMCatalystOverride {
  board: string;
  catalyst: number; // 0-100
  fromLLM: boolean;
}

export function computeThemeScores(
  boards: BoardFlowBrief[],
  rawZTPool: ZTPoolItem[],
  newsItems: NewsItem[],
  hlSwitchPulseNew?: string[],
  llmOverrides?: LLMCatalystOverride[], // 异步补位
): ThemeScoreResult[] {
  const ladder = buildThemeLadder(rawZTPool);
  const ladderMap = new Map<string, ThemeGroup>();
  for (const g of ladder) ladderMap.set(g.theme, g);

  // LLM 覆盖映射
  const llmMap = new Map<string, LLMCatalystOverride>();
  if (llmOverrides) {
    for (const o of llmOverrides) llmMap.set(o.board, o);
  }

  // 新闻按板块归组（规则版基线）：使用数据驱动的 boardMap
  const newsMap = new Map<string, number>();
  for (const item of newsItems) {
    const matchedBoards = matchBoardsByText(item.title);
    if (matchedBoards.length > 0) {
      const add = item.stars >= 3 ? 25 : item.stars >= 2 ? 12 : 5;
      for (const board of matchedBoards) {
        const prev = newsMap.get(board) ?? 0;
        newsMap.set(board, prev + add);
      }
    }
  }

  const results: ThemeScoreResult[] = [];

  for (const b of boards) {
    // 动态权重：根据阶段调整 news 与 ladder 的权重
    const newsWeight = NEWS_WEIGHT_BY_STAGE[b.stage] ?? W_NEWS_BASE;
    const newsWeightDelta = newsWeight - W_NEWS_BASE;
    // 浮动的权重从 ladder 让渡
    const ladderWeight = newsWeightDelta > 0 ? LADDER_COMPRESSED : W_LADDER_BASE;
    const fundWeight = W_FUND_BASE;
    const stageWeight = W_STAGE_BASE;
    // 归一化（确保总和=1）
    const wTotal = fundWeight + ladderWeight + stageWeight + newsWeight;
    const wf = fundWeight / wTotal;
    const wl = ladderWeight / wTotal;
    const ws = stageWeight / wTotal;
    const wn = newsWeight / wTotal;

    // -- fund --
    const fundToday = clamp(50 + b.mainNetPct * 8);
    const fund5d = clamp(50 + b.mainNet5dPct * 5);
    const fund10d = clamp(50 + b.mainNet10dPct * 3);
    const fund = 0.4 * fundToday + 0.3 * fund5d + 0.2 * fund10d + 0.1 * 50;

    // -- ladder: 行业名与hybk同源直配，题材走模糊匹配+别名表 --
    const lg = b.kind === "industry"
      ? (ladderMap.get(b.name) ?? null) // 行业与hybk同源，直接相等匹配
      : fuzzyMatchLadder(b.name, ladderMap);
    let ladderScore = 50;
    if (lg) {
      const heightPart = lg.height * 18;
      const gapPenalty = lg.gapTiers.length * 15;
      const firstBonus = Math.min(lg.tiers.first * 5, 30);
      const earlyPioneer = lg.pioneer && lg.pioneer.firstBoardTime && String(lg.pioneer.firstBoardTime) < "10:00:00" ? 10 : 0;
      const bigBellwether = lg.bellwether && lg.bellwether.amount > 2e9 ? 10 : 0;
      ladderScore = clamp(heightPart - gapPenalty + firstBonus + earlyPioneer + bigBellwether);
    }

    // -- stage（v9.27：stageMap 收敛到 stageModel.STAGE_SCORE_MAP，含"分歧期"） --
    const stageMap = STAGE_SCORE_MAP;
    let stageScore = stageMap[b.stage] ?? 50;
    if (hlSwitchPulseNew?.includes(b.name)) stageScore = clamp(stageScore + 10);

    // -- news (LLM覆盖 or 规则版) --
    const llmOverride = llmMap.get(b.name);
    let newsScore: number;
    let newsSource: "LLM" | "规则版";
    if (llmOverride && llmOverride.fromLLM) {
      newsScore = llmOverride.catalyst;
      newsSource = "LLM";
    } else {
      newsScore = clamp(newsMap.get(b.name) ?? 0);
      newsSource = "规则版";
    }

    const total = Math.round(wf * fund + wl * ladderScore + ws * stageScore + wn * newsScore);

    const finalTotal = clamp(total);
    results.push({
      board: b.name,
      total: finalTotal,
      factors: { fund: Math.round(fund), ladder: Math.round(ladderScore), stage: Math.round(stageScore), news: Math.round(newsScore) },
      role: b.stage,
      newsSource,
      tier: finalTotal >= 70 ? "A" : finalTotal >= 55 ? "B" : "C",
      kind: b.kind ?? "theme",
    });
  }

  results.sort((a, b) => b.total - a.total);
  return results;
}
