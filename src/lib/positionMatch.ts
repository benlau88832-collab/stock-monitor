// 持仓-主线匹配（P3）：自选股 vs 当日主线板块的对应关系
// 十年机构视角：交易员每天第一问是"我的票还在主线上吗？"
// 纯函数，不碰 DOM/网络。输入自选股代码 + 主线板块列表 + 行业映射，输出匹配状态。

import { getIndustryByCode } from "./boardMap";

export type MatchStatus = "tailwind" | "isolated" | "headwind" | "unknown";

export interface PositionMatch {
  code: string;
  name: string;
  /** 匹配到的主线板块名（可能为空=孤立） */
  board: string | null;
  /** 板块阶段（启动期/发酵期/高潮期/退潮期/观察中） */
  stage: string | null;
  /** 板块当日涨幅% */
  boardPct: number | null;
  /** 匹配状态 */
  status: MatchStatus;
  /** 一句话提示 */
  hint: string;
}

interface BoardLike {
  name: string;
  pct: number;
  stage?: string;
  weight?: string;
}

/**
 * 匹配单只股票：用行业映射 → 行业名 → 在主线 boards 中找同名板块
 * @param code       股票代码
 * @param name       股票名（无行业映射时展示用）
 * @param boards     主线板块列表（mainline.boards，含 stage）
 */
export function matchStockToMainline(code: string, name: string, boards: BoardLike[]): PositionMatch {
  const ind = getIndustryByCode(code);
  const board = ind ? boards.find(b => b.name === ind) ?? null : null;

  if (!board) {
    // 无行业映射或不在主线 → 孤立（前提是主线有数据）
    return {
      code, name,
      board: ind ?? null,
      stage: null,
      boardPct: null,
      status: boards.length > 0 ? "isolated" : "unknown",
      hint: boards.length > 0
        ? (ind ? `所属行业「${ind}」不在今日主线中` : "暂无行业映射，无法匹配")
        : "主线数据不足",
    };
  }

  const stage = board.stage ?? "观察中";
  let status: MatchStatus;
  let hint: string;
  switch (stage) {
    case "启动期":
      status = "tailwind"; hint = `顺风：所在板块「${board.name}」启动期，主线刚起步`;
      break;
    case "发酵期":
      status = "tailwind"; hint = `顺风：所在板块「${board.name}」发酵期，资金持续流入`;
      break;
    case "高潮期":
      status = "tailwind"; hint = `顺风但注意：板块「${board.name}」高潮期，谨防高位分歧`;
      break;
    case "退潮期":
      status = "headwind"; hint = `逆风：所在板块「${board.name}」退潮期，考虑减仓`;
      break;
    default:
      status = "isolated"; hint = `板块「${board.name}」处于观察中，主线地位不明确`;
  }
  return { code, name, board: board.name, stage, boardPct: board.pct, status, hint };
}

/** 批量匹配（自选股列表） */
export function matchStocksToMainline(
  stocks: Array<{ code: string; name: string }>,
  boards: BoardLike[],
): PositionMatch[] {
  return stocks.map(s => matchStockToMainline(s.code, s.name, boards));
}

/** 汇总统计：顺风/孤立/逆风 各几只 */
export function summarizeMatches(matches: PositionMatch[]): { tailwind: number; isolated: number; headwind: number; unknown: number } {
  const r = { tailwind: 0, isolated: 0, headwind: 0, unknown: 0 };
  for (const m of matches) r[m.status]++;
  return r;
}
