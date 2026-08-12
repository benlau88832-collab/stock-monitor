// ============================================================
// src/lib/scenarios/intradayAction.ts —— 盘中异动处置（v9.118.0，S4-1）
// 异动 → 处置闭环（持有/加仓/减仓/回避）—— 异动直接推决策卡而非仅告警。
// 纯函数，0 token；服务端等价：server/lib/scenarios.js。
// ============================================================

export interface Holding {
  code: string;
  name: string;
  cost?: number | null;
  price?: number | null;
  pct?: number | null;      // 当日涨跌 %
  mainNet?: number | null;  // 主力净额（元）
}

export interface IntradayActionVerdict {
  code: string;
  name: string;
  action: "持有" | "加仓" | "减仓" | "回避";
  reason: string;
}

/**
 * 盘中异动处置（规则近似）：
 * 主力净流出 > 10% 当日涨幅且非涨停 → 减仓；主力净流入 + 涨幅 3-8% 未过热 → 加仓；
 * 涨幅 > 9%（涨停附近）→ 持有（不追）；认知资金信号出货 → 回避。
 */
export function composeIntradayAction(
  stock: Holding,
  cog: { capital?: { value?: { signal?: string } }; sentiment?: { value?: { stage?: string } } },
): IntradayActionVerdict {
  const signal = cog?.capital?.value?.signal;
  const stage = cog?.sentiment?.value?.stage;
  const pct = stock.pct ?? 0;
  const net = stock.mainNet ?? 0;
  const loss = stock.cost != null && stock.price != null ? (stock.price - stock.cost) / stock.cost : null;

  if (signal === "出货" || stage === "退潮" || stage === "分歧") {
    return { code: stock.code, name: stock.name, action: "回避", reason: `认知资金${signal ?? "?"}/${stage ?? "?"}，减仓回避` };
  }
  if (net < 0 && pct > 3 && pct < 9.5) {
    return { code: stock.code, name: stock.name, action: "减仓", reason: `主力净流出 ${(net / 1e8).toFixed(2)}亿 而涨幅 ${pct.toFixed(1)}%，量价背离减仓` };
  }
  if (net > 0 && pct >= 3 && pct <= 8) {
    return { code: stock.code, name: stock.name, action: "加仓", reason: `主力净流入 ${(net / 1e8).toFixed(2)}亿 + 涨幅 ${pct.toFixed(1)}%，资金确认可加仓` };
  }
  if (pct >= 9.5) {
    return { code: stock.code, name: stock.name, action: "持有", reason: `涨幅 ${pct.toFixed(1)}% 涨停附近，持有不追` };
  }
  if (loss != null && loss < -0.05) {
    return { code: stock.code, name: stock.name, action: "减仓", reason: `浮亏 ${(loss * 100).toFixed(1)}% 破 5% 止损线，减仓` };
  }
  return { code: stock.code, name: stock.name, action: "持有", reason: "无异动信号，持有观察" };
}
