// 主线作战引擎（v9.16 打破重建）
// 三层：涨停潮检测 → 风格感知 → 主线排序
// 数据源：涨停池(rawPool) + 板块资金流(boards) + 真实新闻(news)
// 设计理念（机构+游资双视角）：
//   - 机构看"资金持续性"（5日净流入、板块阶段）
//   - 游资看"涨停潮爆发力"（涨停家数、连板高度、首封时间）
// 二者融合成"主线强度分"，再经 LLM 精排输出最终作战卡。

import { buildThemeLadder, type ZTPoolItem, type ThemeGroup } from "./themeLadder";

// ============== 数据结构 ==============

/** 主线内龙头（龙一/龙二/龙三） */
export interface MainlineLeader {
  code: string;
  name: string;
  boardCount: number;    // 连板数
  firstBoardTime: string; // 首封时间 HH:MM:SS
  sealFund: number;      // 封单资金(元)
  amount: number;        // 成交额(元)
  pct: number;           // 涨幅%
  role: "龙一" | "龙二" | "龙三";
  reason: string;        // 判定理由（如"最高板+最早封板"）
}

/** 单个主线候选（涨停潮板块） */
export interface MainlineCandidate {
  board: string;         // 板块名（hybk 行业名）
  ztCount: number;       // 涨停家数
  height: number;        // 最高连板
  tiers: { first: number; second: number; thirdPlus: number };
  mainNet: number;       // 板块主力净流入(元)
  mainNet5d: number;     // 5日主力净流入
  boardPct: number;      // 板块涨幅%
  stage: string;         // 阶段
  leaders: MainlineLeader[]; // 龙一龙二龙三
  newsTitles: string[];  // 相关新闻标题（≤6条）
  /** 规则机强度分 0-100（资金+涨停潮+梯队 融合） */
  score: number;
}

/** 市场风格 */
export type MarketStyle = "attack" | "rotation" | "defense";

export interface MarketStyleInfo {
  style: MarketStyle;
  riskAppetite: number;  // 0-100 风险偏好（越高越激进）
  label: string;
}

/** 新闻输入（复用 themeScore 的 NewsItem 形状） */
export interface NewsInput { title: string; stars: number; }

/** 板块资金流输入（与 App.tsx mainlineBoards 对齐；mainNet 可选——行业候选来自指数行情无主力净额时记0） */
export interface BoardFlowLike {
  name: string;
  pct: number;
  mainNet?: number;
  mainNet5d?: number;
  mainNet5dPct?: number;
  mainNet10dPct?: number;
  stage?: string;
  kind?: "industry" | "theme";
}

// ============== 工具 ==============
function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v));
}

// ============== 涨停潮检测 + 龙头判定 ==============

/**
 * 从涨停池构建主线候选
 * 涨停数 ≥2 或 高度 ≥2 的行业组进入候选；龙一龙二龙三按游资规则判定
 */
export function buildMainlineCandidates(
  rawPool: ZTPoolItem[],
  boards: BoardFlowLike[],
  newsItems: NewsInput[],
): MainlineCandidate[] {
  if (!rawPool || rawPool.length === 0) return [];

  const ladder = buildThemeLadder(rawPool);  // 按 hybk 分组，含梯队/先锋/中军
  const boardMap = new Map<string, BoardFlowLike>();
  for (const b of boards) boardMap.set(b.name, b);

  const candidates: MainlineCandidate[] = [];

  for (const g of ladder) {
    // v9.17 修复：要求 ztCount ≥ 2 才能进主线（防单只孤峰如 9板独苗进第一主线）
    // 即使 height≥9，1只涨停也不算"板块效应"，只能是孤峰/脉冲
    if (g.count < 2) continue;

    // 板块资金（hybk 行业名 → boardMap 匹配；概念板块用模糊匹配）
    // v9.26.13：三级匹配（精确 → 包含 → 2字 token）—— 修复"机器人(行业) vs 机器人概念(概念)"对不上
    // 同时聚合多个相关板块资金（更真实反映"该主题资金流入强度"）
    const matchedFlows: BoardFlowLike[] = [];
    // 精确
    if (boardMap.has(g.theme)) matchedFlows.push(boardMap.get(g.theme)!);
    // 包含
    for (const [name, b] of boardMap) {
      if (matchedFlows.includes(b)) continue;
      if (name.includes(g.theme) || g.theme.includes(name)) matchedFlows.push(b);
    }
    // token 级（拆 2 字以上片段）
    const tokens = g.theme.split(/[·、,，\s]+/).filter(t => t.length >= 2);
    for (const tok of tokens) {
      for (const [name, b] of boardMap) {
        if (matchedFlows.includes(b)) continue;
        if (name.includes(tok)) matchedFlows.push(b);
      }
    }
    // 聚合：取 mainNet 绝对值最大的作为代表，mainNet5d/mainNet10d 累加
    let boardFlow: BoardFlowLike | null = matchedFlows[0] ?? null;
    if (matchedFlows.length > 0) {
      const best = matchedFlows.reduce((a, b) => Math.abs(b.mainNet ?? 0) > Math.abs(a.mainNet ?? 0) ? b : a);
      boardFlow = {
        ...best,
        // 累加 5d/10d 资金：反映该主题的持续性
        mainNet5d: matchedFlows.reduce((s, b) => s + (b.mainNet5d ?? 0), 0),
        mainNet5dPct: matchedFlows.reduce<number>((s, b) => s + (b.mainNet5dPct ?? 0), 0) / matchedFlows.length,
      };
    }

    // 新闻催化：标题含板块名
    const newsTitles: string[] = [];
    for (const n of newsItems) {
      if (n.title.includes(g.theme)) {
        newsTitles.push(n.title);
        if (newsTitles.length >= 6) break;
      }
    }

    // 龙头判定（游资规则：高度优先 → 封板时间 → 封单资金）
    const leaders = determineLeaders(g);

    candidates.push({
      board: g.theme,
      ztCount: g.count,
      height: g.height,
      tiers: g.tiers,
      mainNet: boardFlow?.mainNet ?? 0,
      mainNet5d: boardFlow?.mainNet5d ?? 0,
      boardPct: boardFlow?.pct ?? 0,
      stage: boardFlow?.stage ?? g.height >= 3 ? "高潮期" : g.height === 2 ? "发酵期" : "启动期",
      leaders,
      newsTitles,
      score: 0, // 下面算
    });
  }

  // 计算规则机强度分（0-100）
  for (const c of candidates) {
    c.score = computeMainlineScore(c);
  }

  // 排序：分数降序
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

/** 龙一龙二龙三判定（游资视角） */
function determineLeaders(g: ThemeGroup): MainlineLeader[] {
  const leaders: MainlineLeader[] = [];
  if (!g.stocks || g.stocks.length === 0) return leaders;

  // stocks 已按 连板数降序 + 成交额降序 排序
  const byBoard = [...g.stocks].sort((a, b) => b.boardCount - a.boardCount || a.firstBoardTime.localeCompare(b.firstBoardTime));

  // 龙一：最高板 + 最早封板
  const top = byBoard[0];
  const sameHeight = byBoard.filter(s => s.boardCount === top.boardCount);
  const dragon1 = sameHeight.sort((a, b) => a.firstBoardTime.localeCompare(b.firstBoardTime) || b.sealFund - a.sealFund)[0];
  leaders.push({
    code: dragon1.code, name: dragon1.name,
    boardCount: dragon1.boardCount, firstBoardTime: dragon1.firstBoardTime,
    sealFund: dragon1.sealFund, amount: dragon1.amount, pct: dragon1.pct,
    role: "龙一",
    reason: `${dragon1.boardCount}板·最早封板${dragon1.firstBoardTime}·封单${(dragon1.sealFund / 1e8).toFixed(1)}亿`,
  });

  // 龙二：次高板（不同股票）中封单最大 或 同板但封单次大
  const rest = byBoard.filter(s => s.code !== dragon1.code);
  if (rest.length > 0) {
    const dragon2 = [...rest].sort((a, b) => b.boardCount - a.boardCount || b.sealFund - a.sealFund)[0];
    leaders.push({
      code: dragon2.code, name: dragon2.name,
      boardCount: dragon2.boardCount, firstBoardTime: dragon2.firstBoardTime,
      sealFund: dragon2.sealFund, amount: dragon2.amount, pct: dragon2.pct,
      role: "龙二",
      reason: `${dragon2.boardCount}板·封单${(dragon2.sealFund / 1e8).toFixed(1)}亿`,
    });
  }

  // 龙三：成交额最大（中军）≠ 龙一龙二
  const rest2 = byBoard.filter(s => s.code !== dragon1.code && (leaders.length < 2 || s.code !== leaders[1].code));
  const dragon3 = rest2.length > 0 ? [...rest2].sort((a, b) => b.amount - a.amount)[0] : null;
  if (dragon3) {
    leaders.push({
      code: dragon3.code, name: dragon3.name,
      boardCount: dragon3.boardCount, firstBoardTime: dragon3.firstBoardTime,
      sealFund: dragon3.sealFund, amount: dragon3.amount, pct: dragon3.pct,
      role: "龙三",
      reason: `成交额${(dragon3.amount / 1e8).toFixed(1)}亿·中军`,
    });
  }

  return leaders;
}

/** 主线强度分（资金 + 涨停潮 + 梯队 融合，0-100） */
function computeMainlineScore(c: MainlineCandidate): number {
  // 资金维度 35%：当日主力净流入 + 5日净流入
  const fundToday = clamp(50 + c.mainNet / 2e8);      // 每 2亿 加 1 分（正流入）
  const fund5d = clamp(50 + c.mainNet5d / 5e8);
  const fundScore = 0.5 * fundToday + 0.5 * fund5d;

  // 涨停潮维度 35%：涨停家数 + 高度
  const ztScore = clamp(Math.min(c.ztCount / 8, 1) * 80 + c.height * 10);  // 8只涨停=80分封顶，高度每板+10

  // 梯队维度 20%：梯队完整性（首板+二板+三板全 = 100）
  const hasFirst = c.tiers.first > 0 ? 1 : 0;
  const hasSecond = c.tiers.second > 0 ? 1 : 0;
  const hasThird = c.tiers.thirdPlus > 0 ? 1 : 0;
  const ladderScore = (hasFirst + hasSecond + hasThird) / 3 * 100;

  // 板块涨幅 10%
  const pctScore = clamp(50 + c.boardPct * 5);

  return Math.round(
    0.35 * fundScore + 0.35 * ztScore + 0.20 * ladderScore + 0.10 * pctScore,
  );
}

// ============== 市场风格感知（进攻/轮动/防守） ==============

/**
 * 判定市场风格 + 风险偏好
 * 输入：情绪分 / 闸门系数 / 涨停家数 / 炸板率 / 最高板 / 上涨家数占比
 */
export function detectMarketStyle(args: {
  sentiment: number | null;
  gateFactor: number | null;
  ztCount: number;
  blastedRate: number | null;
  maxBoardHeight: number;
  upRatio: number | null;   // 上涨家数占比 0-1
}): MarketStyleInfo {
  const { sentiment, ztCount, blastedRate, maxBoardHeight, upRatio, gateFactor } = args;

  // 风险偏好：0-100（情绪 40% + 涨停潮 30% + 上涨家数 30%）
  const s = sentiment ?? 50;
  const emoPart = clamp(s);                                   // 情绪直接映射 0-100
  const ztPart = clamp(Math.min(ztCount / 50, 1) * 100);      // 50只涨停=100
  const upPart = upRatio != null ? clamp(upRatio * 100) : 50;
  const riskAppetite = Math.round(0.4 * emoPart + 0.3 * ztPart + 0.3 * upPart);

  // 炸板率惩罚：>40% 大幅降风险偏好
  const blastedPenalty = blastedRate != null && blastedRate > 40 ? (blastedRate - 40) * 1.5 : 0;

  // 闸门硬约束：极度贪婪/恐慌都降
  const gatePenalty = gateFactor != null && gateFactor <= 0.3 ? 15 : 0;

  const finalRisk = clamp(riskAppetite - blastedPenalty - gatePenalty);

  // 风格判定
  let style: MarketStyle;
  let label: string;
  if (finalRisk >= 65 && ztCount >= 20 && maxBoardHeight >= 2) {
    style = "attack";
    label = "进攻日 · 情绪亢奋 · 涨停潮明确";
  } else if (finalRisk <= 35 || blastedRate != null && blastedRate > 45) {
    style = "defense";
    label = "防守日 · 情绪低迷 · 涨停潮熄火";
  } else {
    style = "rotation";
    label = "轮动日 · 结构性机会 · 快进快出";
  }

  return { style, riskAppetite: finalRisk, label };
}

// ============== ETF 风格偏好（给 etfScore 用） ==============

/** 返回各 ETF 在当日风格下的风格加成（-20 ~ +20） */
export function getStyleFit(stockStyle: MarketStyle): Map<string, number> {
  const fit = new Map<string, number>();
  if (stockStyle === "attack") {
    // 进攻日：科技/成长/主线 ETF 加分，红利/银行/黄金 减分
    fit.set("科创", 15); fit.set("半导体", 15); fit.set("芯片", 15); fit.set("创业板", 10);
    fit.set("中证1000", 10); fit.set("计算机", 15); fit.set("AI", 15); fit.set("通信", 12); fit.set("军工", 8);
    fit.set("红利", -15); fit.set("银行", -12); fit.set("黄金", -8); fit.set("沪深300", 0);
  } else if (stockStyle === "defense") {
    // 防守日：红利/黄金/银行 加分，成长减分
    fit.set("红利", 15); fit.set("银行", 10); fit.set("黄金", 12); fit.set("沪深300", 8);
    fit.set("科创", -15); fit.set("半导体", -15); fit.set("芯片", -15); fit.set("创业板", -10);
    fit.set("中证1000", -10); fit.set("计算机", -15); fit.set("AI", -15); fit.set("军工", -5);
  } else {
    // 轮动日：中性偏好，小幅偏向主线
    fit.set("科创", 5); fit.set("半导体", 5); fit.set("芯片", 5); fit.set("中证1000", 5);
  }
  return fit;
}

// ============== 主线 → ETF 映射（供 etfScore 直出主线 ETF） ==============

/** 从主线名反查最匹配的 ETF 池品种（返回 ETF code 列表，按匹配度降序） */
export function matchMainlineETF(
  mainlineBoard: string,
  etfPool: Array<{ code: string; name: string; boardKeywords: string[] }>,
): Array<{ code: string; name: string; score: number }> {
  const results: Array<{ code: string; name: string; score: number }> = [];
  for (const spec of etfPool) {
    let best = 0;
    for (const kw of spec.boardKeywords) {
      if (mainlineBoard.includes(kw) || kw.includes(mainlineBoard)) best = Math.max(best, 100);
      else if (mainlineBoard.includes(kw.slice(0, 2))) best = Math.max(best, 60);
    }
    if (best > 0) results.push({ code: spec.code, name: spec.name, score: best });
  }
  results.sort((a, b) => b.score - a.score);
  return results;
}
