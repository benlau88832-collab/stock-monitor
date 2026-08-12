// ============================================================
// src/lib/decisionDirect.ts —— 决策直达（v9.113.0，T4-1）
// 终审 D-05：强内核（agentTools 准入/仓位/离场/风控）只能靠 LLM 对话触达 → 降级时不可用。
// 本模块直接组合决策工具的纯逻辑 execute，**不经过 LLM/relay** → 秒级、永不降级。
// 数据源：PG 快照（fetchMarketSnapshot）+ 个股实时（fetchStockOne）。
// ============================================================
import { getAgentTools, type ToolContext } from "./agentTools";
import { fetchMarketSnapshot } from "./dataLayer";

export interface DecisionResult {
  verdict: string;           // 可上车 / 观望 / 禁止
  confidence: number;
  positionPct: number | null; // 建议仓位 %
  tranches?: Array<{ pct: number; note?: string }>;
  stopLoss: number | null;    // 止损 %
  exitLevel: string | null;   // red / yellow / none
  risks: string[];
  evidence: { source: string; asOf: number; gateLabel: string; mainline: string; strength: number | null };
  meta: { source: string; asOf: number; stale: boolean };
}

/**
 * 决策直达入口：输入 {code?, mainline?} → 准入裁决 + 仓位 + 止损 + 离场 + 风险（纯函数直调，无 LLM）。
 * 数据缺失时工具自带 dataMissing 标记（不喂假数据，v9.75 约定）。
 */
export async function decisionDirect(input: { code?: string; mainline?: string }): Promise<DecisionResult> {
  // 1) PG 快照（情绪/涨停/炸板/溢价/闸门/主线Top1/梯队）
  const snap = await fetchMarketSnapshot();
  const data = snap?.data ?? {};
  const m = data.market ?? {};
  const gate = data.gate ?? {};
  const topMainline = data.mainlines?.top?.[0] ?? {};
  // 2) 个股实时（若传 code）
  let stock: { price?: number; pct?: number; mainNet?: number; mainNetPct?: number } | null = null;
  if (input.code) {
    try {
      const { fetchStockOne } = await import("./api");
      const d = await fetchStockOne(input.code);
      if (d) stock = { price: d.price, pct: d.pct, mainNet: d.mainNet, mainNetPct: d.mainNetPct };
    } catch { /* 个股行情失败 → 工具按缺数据标记 */ }
  }
  // 3) 组装 ToolContext（真实 PG + 实时；缺字段 → 工具 dataMissing 标记，不喂假数字）
  const mainlineName = input.mainline ?? topMainline.theme ?? "—";
  const ctx: ToolContext = {
    mainline: mainlineName,
    strengthScore: topMainline.heat ?? null,
    stage: topMainline.trend ?? "观察中",
    gateMode: gate.mode ?? "empty",
    marketFactor: gate.factor ?? 0.5,
    ztCount: m.ztCount ?? 0,
    height: m.maxBoardHeight ?? 0,
    sentiment: m.sentiment ?? null,
    blastedRate: m.blastedRate ?? null,
    premiumAvg: m.premiumAvg ?? null,
    trapFlagged: false,
    ...(stock ? { price: stock.price, pct: stock.pct, mainNet: stock.mainNet, mainNetPct: stock.mainNetPct } : {}),
  };
  // 4) 直调三个决策工具 execute（并行，纯函数，无 LLM）
  const tools = new Map(getAgentTools().map(t => [t.name, t]));
  const [admission, position, exit] = await Promise.all([
    tools.get("getAdmissionVerdict")!.execute(ctx),
    tools.get("computePositionAdvice")!.execute(ctx),
    tools.get("checkExitSignal")!.execute({ ...ctx, code: input.code ?? null } as ToolContext),
  ]);
  const exitResult = (exit as { level?: string; reasons?: string[]; dataMissing?: boolean }) ?? {};
  return {
    verdict: (admission as any)?.action ?? "观望",
    confidence: (admission as any)?.confidence ?? 50,
    positionPct: (position as any)?.suggestedPct ?? null,
    tranches: (position as any)?.tranches,
    stopLoss: (position as any)?.stopLoss ?? null,
    exitLevel: exitResult.level ?? null,
    risks: exitResult.dataMissing ? ["离场数据缺失（不喂假数据）"] : (exitResult.reasons ?? []),
    evidence: {
      source: snap?.meta?.source ?? "none",
      asOf: snap?.meta?.asOf ?? 0,
      gateLabel: gate.label ?? "数据未就绪",
      mainline: mainlineName,
      strength: ctx.strengthScore ?? null,
    },
    meta: snap?.meta ?? { source: "none", asOf: 0, stale: true },
  };
}
