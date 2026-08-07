// ============================================================
// v11-11（P0）：全站唯一权威分类器
// 数据源优先级：F10概念(最全，权重投票) → hybk(涨停池行业，折叠) → 申万(boardMap，兜底)
// 折叠策略：一股 N 个概念各自折叠到大类，票数最多者胜出（透明可审计）
// 目标：全站不再"五套分类打架"（hybk/F10概念/申万/conceptGroups/LLM自由命名），
//       任何模块要"这只股属于什么主线"只调 classifyStock(code, ...)
// ============================================================
import { conceptGroupOf } from "./conceptGroups";
import { getIndustryByCode } from "./boardMap";

export interface StockClassification {
  code: string;
  /** 权威主线大类名（conceptGroups 24 大类之一，或 hybk 原值） */
  mainline: string;
  /** 全部候选大类 + 票数（透明可审计） */
  candidates: Array<{ group: string; votes: number }>;
  /** 数据源 */
  source: "f10_concepts" | "hybk" | "sw_industry";
  /** 置信度（票数集中度） */
  confidence: number;
}

/**
 * 全站唯一分类入口。
 * @param code 股票代码
 * @param f10Concepts 该股的 F10 概念列表（来自 stockBoards，可为空）
 * @param hybk 涨停池 hybk 字段（可为空）
 * @returns 唯一分类结果
 */
export function classifyStock(
  code: string,
  f10Concepts: string[] = [],
  hybk?: string,
): StockClassification {
  // ① F10 概念权重投票（首选）
  if (f10Concepts.length > 0) {
    const tally = new Map<string, number>();
    for (const concept of f10Concepts) {
      const group = conceptGroupOf(concept);
      if (group) tally.set(group, (tally.get(group) ?? 0) + 1);
    }
    if (tally.size > 0) {
      const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1]);
      const winner = sorted[0][0];
      const totalVotes = sorted.reduce((s, [, v]) => s + v, 0);
      return {
        code,
        mainline: winner,
        candidates: sorted.map(([group, votes]) => ({ group, votes })),
        source: "f10_concepts",
        confidence: sorted[0][1] / totalVotes,
      };
    }
  }

  // ② hybk 折叠（次选）
  if (hybk) {
    const folded = conceptGroupOf(hybk) ?? hybk;
    return {
      code,
      mainline: folded,
      candidates: [{ group: folded, votes: 1 }],
      source: "hybk",
      confidence: 0.6,
    };
  }

  // ③ 申万行业（兜底）
  const sw = getIndustryByCode(code);
  if (sw) {
    const folded = conceptGroupOf(sw) ?? sw;
    return {
      code,
      mainline: folded,
      candidates: [{ group: folded, votes: 1 }],
      source: "sw_industry",
      confidence: 0.4,
    };
  }

  return { code, mainline: "其他", candidates: [], source: "hybk", confidence: 0 };
}
