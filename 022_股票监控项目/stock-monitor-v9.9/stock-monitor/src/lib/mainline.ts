// 主线作战引擎（v9.16 打破重建）
// v9.61（V9-S1）：删除死代码 buildMainlineCandidates/determineLeaders/computeMainlineScore
// v14-4（P1 复查确认）：5 个死函数（+detectExtremeBoard/detectExtremeBatch）全库 0 引用 0 定义 —— 已彻底清理，无残留
//   （实际走 stockToMainline + themeLadder，此文件仅保留市场风格感知 detectMarketStyle + ETF 偏好）
// 数据源：涨停池(rawPool) + 板块资金流(boards) + 真实新闻(news)
import { RISK_APPETITE_ATTACK, RISK_APPETITE_DEFENSE, ZT_COUNT_BOOM, BLAST_RATE_DEFENSE } from "./thresholds";

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
  if (finalRisk >= RISK_APPETITE_ATTACK && ztCount >= ZT_COUNT_BOOM && maxBoardHeight >= 2) {
    style = "attack";
    label = "进攻日 · 情绪亢奋 · 涨停潮明确";
  } else if (finalRisk <= RISK_APPETITE_DEFENSE || blastedRate != null && blastedRate > BLAST_RATE_DEFENSE) {
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
