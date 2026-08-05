// 持仓-主线匹配（P3 v9.10 + v9.12-fix）
// 十年机构视角：交易员每天第一问是"我的票还在主线上吗？"
// v9.12 修复：增加"概念异动"维度（涨幅>5% 但不在主线上 → 标 🔥概念异动 而非孤立）
//             因为涨停票常因"光通信/AI算力"等小众概念发力，不在行业 top10 内

import { getIndustryByCode } from "./boardMap";

export type MatchStatus = "tailwind" | "isolated" | "headwind" | "concept_breakout" | "isolated_bear" | "unknown";

export interface PositionMatch {
  code: string;
  name: string;
  /** 当前涨幅%（用于概念异动判断） */
  pct: number;
  /** 股票所属行业（申万一级） */
  industry: string | null;
  /** 在主线中匹配到的板块（行业 OR 概念 任意一个） */
  matchedBoard: { name: string; pct: number; stage?: string } | null;
  /** 匹配来源：industry | concept | null */
  matchFrom: "industry" | "concept" | null;
  /** 状态 */
  status: MatchStatus;
  /** 一句话提示 */
  hint: string;
  /** 调试字段：股票名命中的所有主线概念（按涨幅排序） */
  relatedConcepts: Array<{ name: string; pct: number; stage?: string }>;
}

interface BoardLike {
  name: string;
  pct: number;
  stage?: string;
  weight?: string;
  kind?: "industry" | "concept" | "region";
}

/**
 * 匹配单只股票到主线（v9.12 升级版）
 * 1) 行业匹配：股票所属行业名 == 主线 board.name → 顺风
 * 2) 概念匹配：股票名包含主线 board.name 中的概念关键词 → 顺风（如"太极实业"含"实"命中"光电子"）
 * 3) 涨幅>5% 且不匹配 → 概念异动（强势但偏离主线，谨慎追高）
 * 4) 跌幅<-3% 且不匹配 → 弱势孤立（回避）
 * 5) 都没命中 → 孤立
 */
export function matchStockToMainline(
  code: string,
  name: string,
  pct: number,
  boards: BoardLike[],
): PositionMatch {
  const ind = getIndustryByCode(code) ?? null;

  // 把 boards 转换为 (name → board) 索引，去重（同名按涨幅最高）
  const boardMap = new Map<string, BoardLike>();
  for (const b of boards) {
    if (!b.name) continue;
    const exist = boardMap.get(b.name);
    if (!exist || b.pct > exist.pct) boardMap.set(b.name, b);
  }

  // 1) 行业匹配
  let matched: BoardLike | null = null;
  let matchFrom: "industry" | "concept" | null = null;
  if (ind && boardMap.has(ind)) {
    matched = boardMap.get(ind)!;
    matchFrom = "industry";
  }

  // 2) 概念匹配：用股票名"关键词"在主线 board.name 里找
  // 股票名通常 4 个字，概念名是"光电子/光通信/低空经济"等关键词
  // 策略：拿主线所有 board.name，做股票名"包含"或"被包含"检查
  const relatedConcepts: BoardLike[] = [];
  if (name) {
    for (const [bname, b] of boardMap) {
      if (bname === ind) continue; // 已匹配过
      // 双向包含（短词被长词包含）：如"光电子"包含"光"
      if (name.includes(bname) || bname.includes(name) || name.includes(bname.slice(0, 2))) {
        relatedConcepts.push(b);
      }
    }
    relatedConcepts.sort((a, b) => b.pct - a.pct);
    if (!matched && relatedConcepts.length > 0) {
      matched = relatedConcepts[0];
      matchFrom = "concept";
    }
  }

  // 3/4/5) 状态判断
  let status: MatchStatus;
  let hint: string;
  if (matched) {
    if (matchFrom === "industry") {
      // 行业匹配
      const stage = matched.stage ?? "观察中";
      if (stage === "退潮期") {
        status = "headwind";
        hint = `逆风：所在行业「${matched.name}」退潮期，考虑减仓`;
      } else if (stage === "高潮期") {
        status = "tailwind";
        hint = `顺风（高潮）：行业「${matched.name}」高潮期，注意高位分歧`;
      } else {
        status = "tailwind";
        hint = `顺风：行业「${matched.name}」${stage}，主力资金关注`;
      }
    } else {
      // 概念匹配
      status = "tailwind";
      hint = `顺风（概念）：涉及「${matched.name}」概念（+${matched.pct.toFixed(2)}%），强势概念共振`;
    }
  } else if (pct >= 5) {
    status = "concept_breakout";
    hint = `🔥 概念异动：+${pct.toFixed(2)}% 强势但未匹配到主线行业/概念，谨慎追高（可能是新概念/妖股）`;
  } else if (pct <= -3) {
    status = "isolated_bear";
    hint = `⚠ 弱势孤立：${pct.toFixed(2)}% 下跌且无主线共振，回避`;
  } else {
    status = "isolated";
    if (ind) hint = `所属行业「${ind}」不在今日主线中（${relatedConcepts.length}个相关概念）`;
    else hint = `暂无行业映射，无法匹配主线`;
  }

  return {
    code, name, pct,
    industry: ind,
    matchedBoard: matched ? { name: matched.name, pct: matched.pct, stage: matched.stage } : null,
    matchFrom,
    status,
    hint,
    relatedConcepts: relatedConcepts.slice(0, 5).map(c => ({ name: c.name, pct: c.pct, stage: c.stage })),
  };
}

/** 批量匹配 */
export function matchStocksToMainline(
  stocks: Array<{ code: string; name: string; pct: number }>,
  boards: BoardLike[],
): PositionMatch[] {
  return stocks.map(s => matchStockToMainline(s.code, s.name, s.pct, boards));
}

/** 汇总统计 */
export interface MatchSummary {
  tailwind: number;
  isolated: number;
  headwind: number;
  concept_breakout: number;
  isolated_bear: number;
  unknown: number;
}

export function summarizeMatches(matches: PositionMatch[]): MatchSummary {
  const r: MatchSummary = { tailwind: 0, isolated: 0, headwind: 0, concept_breakout: 0, isolated_bear: 0, unknown: 0 };
  for (const m of matches) r[m.status]++;
  return r;
}
