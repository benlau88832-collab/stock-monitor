// ============================================================
// src/lib/scenarios/closeList.ts —— 尾盘减仓清单（v9.118.0，S4-1）
// 14:30+ 持仓盈亏快照 → 自动减仓清单（高位跟风/浮盈兑现/破位止损）。
// 纯函数，0 token；服务端等价：server/lib/scenarios.js。
// ============================================================

export interface CloseCandidate {
  code: string;
  name: string;
  profitPct: number | null; // 浮盈 %（null=无成本）
  pct: number | null;       // 当日涨跌 %
  isHighFollow: boolean;    // 高位跟风（涨停潮退潮风险）
  reason: string;
  action?: "减仓" | "锁定" | "持有"; // 输入可省略，buildCloseList 输出必有
}

/**
 * 尾盘减仓体检（14:30 后执行）：
 * 高潮/分歧阶段高位跟风 → 减仓锁定；浮盈 ≥10% → 锁定部分；破 5% 止损 → 减仓
 */
export function buildCloseList(
  holdings: CloseCandidate[],
  cog: { sentiment?: { value?: { stage?: string } } },
): CloseCandidate[] {
  const stage = cog?.sentiment?.value?.stage ?? "";
  const riskyStage = stage === "高潮" || stage === "分歧" || stage === "退潮";
  return holdings.map((h) => {
    if (h.isHighFollow && riskyStage) {
      return { ...h, action: "减仓", reason: `${stage} 阶段高位跟风，14:30 前减仓锁定` };
    }
    if (h.profitPct != null && h.profitPct >= 10) {
      return { ...h, action: "锁定", reason: `浮盈 ${h.profitPct.toFixed(1)}% ≥10%，锁定部分利润` };
    }
    if (h.profitPct != null && h.profitPct <= -5) {
      return { ...h, action: "减仓", reason: `浮亏 ${h.profitPct.toFixed(1)}% 破 5% 止损，减仓` };
    }
    return { ...h, action: "持有", reason: "未触发减仓条件，持有" };
  });
}
