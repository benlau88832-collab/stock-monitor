// ============================================================
// v11-11（P0）：全站唯一权威分类器
// v9.91.2（概念机制根治）：双轨制 ——
//   concept（新增）= 东财权威核心题材名（IS_PRECISE=1 且 rank 最小，数据驱动不猜），
//     显示层优先用它（上海电力→"绿色电力"、创新医疗→"脑机接口"）；
//   mainline = 折叠大类（24 组词根），供主线聚合/资金匹配/呼应比对（兼容 8 个既有调用点）。
// 数据源优先级：core_concept(东财权威) → F10概念(词根投票) → hybk(涨停池行业，折叠) → 申万(boardMap，兜底)
// 目标：全站不再"五套分类打架"（hybk/F10概念/申万/conceptGroups/LLM自由命名），
//       任何模块要"这只股属于什么主线"只调 classifyStock(code, ...)
// ============================================================
import { conceptGroupOf } from "./conceptGroups";
import { getIndustryByCode } from "./boardMap";
import { isThemeBoardName } from "../shared/conceptFilter";

/**
 * v9.91.2：主属性归一映射（东财概念名 → 市场通用名）
 * 东财 F10 用"人脑工程"称呼脑机接口概念 —— 映射后显示层直接出市场共识名。
 * 命中即作为 concept 输出；mainline 仍按词根折叠（人脑工程→前沿科技组），资金匹配兼容。
 */
const CONCEPT_ALIAS: Record<string, string> = {
  "人脑工程": "脑机接口",
};

export interface StockClassification {
  code: string;
  /** 权威主线大类名（conceptGroups 24 大类之一，或 hybk 原值）—— 聚合/资金匹配/呼应比对用 */
  mainline: string;
  /** v9.91.2：东财权威核心题材名（如"绿色电力""脑机接口"），显示层优先；无则 null */
  concept: string | null;
  /** 全部候选大类 + 票数（透明可审计） */
  candidates: Array<{ group: string; votes: number }>;
  /** 数据源 */
  source: "f10_concepts" | "hybk" | "sw_industry" | "ths_whitelist";
  /** 置信度（票数集中度） */
  confidence: number;
}

/**
 * 全站唯一分类入口。
 * @param code 股票代码
 * @param f10Concepts 该股的 F10 概念列表（来自 stockBoards，可为空）
 * @param hybk 涨停池 hybk 字段（可为空）
 * @param coreConcept v9.91.2 东财权威核心题材（IS_PRECISE=1 且 rank 最小，可为空）
 * @returns 唯一分类结果（mainline=折叠大类，concept=权威概念名）
 */
export function classifyStock(
  code: string,
  f10Concepts: string[] = [],
  hybk?: string,
  coreConcept?: string | null,
): StockClassification {
  // ① F10 概念权重投票（首选）—— v9.91.0：入口防御过滤（白名单外/宽泛概念不参与投票）
  const cleanConcepts = f10Concepts.filter(c => isThemeBoardName(c, null));

  // v9.91.2：主概念 = 东财权威核心题材（数据驱动，不再靠词根投票猜）→ 同义映射
  let concept: string | null = null;
  if (coreConcept && isThemeBoardName(coreConcept, null)) {
    concept = CONCEPT_ALIAS[coreConcept] ?? coreConcept;
  }

  if (cleanConcepts.length > 0) {
    const tally = new Map<string, number>();
    for (const conceptName of cleanConcepts) {
      const group = conceptGroupOf(conceptName);
      if (group) tally.set(group, (tally.get(group) ?? 0) + 1);
    }
    if (tally.size > 0) {
      const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1]);
      const winner = sorted[0][0];
      const totalVotes = sorted.reduce((s, [, v]) => s + v, 0);
      return {
        code,
        mainline: winner,
        concept,
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
      concept,
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
      concept,
      candidates: [{ group: folded, votes: 1 }],
      source: "sw_industry",
      confidence: 0.4,
    };
  }

  return { code, mainline: "其他", concept, candidates: [], source: "hybk", confidence: 0 };
}
