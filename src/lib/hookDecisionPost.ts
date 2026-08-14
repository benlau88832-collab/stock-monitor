import type { DecisionPost } from "./decisionPost";
import { apiFetch } from "./cloudStore";

export interface PostHookResult {
  addedToDiscipline: boolean;
  addedToWatch: boolean;
  positionAdvice: { suggestedPct: number; tranches: number[]; stopLoss: number } | null;
  pushed: boolean;
  addedToTrade: boolean;
  error: string | null;
}

export interface PostHookCtx {
  stage?: string;
  gate?: { mode?: string; factor?: number | null; positionLimit?: number; riskLevel?: string };
  strengthScore?: number | null;
}

export async function runPostHook(post: DecisionPost, ctx?: PostHookCtx): Promise<PostHookResult> {
  const result: PostHookResult = { addedToDiscipline: false, addedToWatch: false, positionAdvice: null, pushed: false, addedToTrade: false, error: null };
  if (post.humanAction !== "confirm") return result;
  if (!post.code && !post.mainline) { result.error = "无代码无主线，跳过联动"; return result; }

  try {
    const { getAgentTools } = await import("./agentTools");
    const tools = getAgentTools();
    const t = tools.find((x) => x.name === "computePositionAdvice");
    if (t) {
      const { stageOfStrength } = await import("./stageModel");
      const stage = ctx?.stage ?? stageOfStrength({ strengthScore: ctx?.strengthScore ?? post.confidenceAtPost ?? 0 });
      const r = await t.execute({
        mainline: post.mainline ?? "-",
        strengthScore: ctx?.strengthScore ?? post.confidenceAtPost ?? null,
        stage,
        gateMode: ctx?.gate?.mode ?? "full",
        marketFactor: ctx?.gate?.factor ?? 0.5,
      }) as { action?: string; suggestedPct: number; tranches: number[]; stopLoss: number };
      result.positionAdvice = { suggestedPct: r.suggestedPct, tranches: r.tranches, stopLoss: r.stopLoss };
    }
  } catch { /* advice failure does not block */ }

  if (post.code && typeof post.priceAtPost === "number" && post.priceAtPost > 0) {
    const name = post.mainline ?? post.code;
    try {
      const stopLossPct = result.positionAdvice?.stopLoss ?? 5;
      await apiFetch("/api/watch/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: post.code,
          name,
          buy_low: Math.round(post.priceAtPost * (1 - stopLossPct / 100) * 100) / 100,
          buy_high: Math.round(post.priceAtPost * 1.02 * 100) / 100,
          stop_loss: Math.round(post.priceAtPost * (1 - (stopLossPct * 1.5) / 100) * 100) / 100,
          trigger_pct: stopLossPct,
          status: "active",
          note: `拍板确认 ${post.mainline ?? ""}`.trim(),
        }),
      });
      result.addedToWatch = true;
    } catch { /* watch failure */ }

    try {
      await apiFetch("/api/portfolio/trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: post.date,
          decisionPostRef: post.ticketId,
          code: post.code,
          name,
          action: "buy",
          price: post.priceAtPost,
          quantity: 100,
          cost: post.priceAtPost,
          simulated: Boolean((post as DecisionPost & { simulated?: boolean }).simulated),
          notes: `拍板确认 ${post.mainline ?? ""}`.trim(),
        }),
      });
      result.addedToTrade = true;
      result.addedToDiscipline = true;
    } catch { /* trade failure */ }

    try {
      await apiFetch("/api/portfolio/logic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: post.code,
          name,
          thesis: `拍板确认：${post.mainline ?? ""}，置信 ${post.confidenceAtPost ?? "?"}%`,
          breakLine: result.positionAdvice?.stopLoss != null ? Math.round(post.priceAtPost * (1 - result.positionAdvice.stopLoss / 100) * 100) / 100 : null,
          board: null,
          status: "验证中",
          decisionRef: post.ticketId,
          simulated: Boolean((post as DecisionPost & { simulated?: boolean }).simulated),
        }),
      });
    } catch { /* logic failure */ }
  }

  try {
    const { pushMessage } = await import("./pushGateway");
    const advTxt = result.positionAdvice && result.positionAdvice.suggestedPct > 0
      ? `仓位建议 ${result.positionAdvice.suggestedPct}% · 止损 ${result.positionAdvice.stopLoss}%`
      : null;
    result.pushed = await pushMessage({
      title: `拍板：${post.mainline ?? post.code} 确认上车`,
      body: advTxt ? `${advTxt}\n置信 ${post.confidenceAtPost ?? "?"}%` : `拍板已落库；置信 ${post.confidenceAtPost ?? "?"}%`,
      severity: "warning",
    });
  } catch { /* push failure */ }

  return result;
}
