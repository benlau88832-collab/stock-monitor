// ============================================================
// P0-2：拍板联动 —— 拍板后系统四件套自动响应
// ① 入纪律：拍"确认上车" → 自动加仓位记录（discipline.addDecisionToPosition）
// ② 加盯价：拍"确认上车" → POST /api/watch/add 加盯价监控
// ③ 算仓位：复用现有 computePositionAdvice 工具
// ④ 推送：P0-4 pushGateway 推送给手机
// 联动失败不影响拍板落库（拍板台账是激动；联动是可选响应）
// ============================================================
import type { DecisionPost } from "./decisionPost";

export interface PostHookResult {
  addedToDiscipline: boolean;
  addedToWatch: boolean;
  positionAdvice: { suggestedPct: number; tranches: number[]; stopLoss: number } | null;
  pushed: boolean;
  error: string | null;
}

export async function runPostHook(post: DecisionPost): Promise<PostHookResult> {
  const result: PostHookResult = { addedToDiscipline: false, addedToWatch: false, positionAdvice: null, pushed: false, error: null };
  if (post.humanAction !== "confirm") return result;
  if (!post.code && !post.mainline) { result.error = "无代码无主线，跳过联动"; return result; }

  // ① 入纪律（仅当有 code，避免空持仓）
  if (post.code) {
    try {
      const { addDecisionToPosition } = await import("./discipline");
      addDecisionToPosition({
        code: post.code,
        priceAtPost: post.priceAtPost,
        mainline: post.mainline,
      });
      result.addedToDiscipline = true;
    } catch { /* 不影响主链 */ }
  }

  // ③ 算仓位（复用 agentTools.computePositionAdvice，得到仓位% / 分批 / 止损）
  try {
    const { getAgentTools } = await import("./agentTools");
    const tools = getAgentTools();
    const t = tools.find(x => x.name === "computePositionAdvice");
    if (t) {
      const r = await t.execute({
        mainline: post.mainline ?? "—",
        strengthScore: post.confidenceAtPost ?? null,
        stage: "观察中",
        gateMode: "open",
        riskLevel: "low",
      }) as { suggestedPct: number; tranches: number[]; stopLoss: number };
      result.positionAdvice = { suggestedPct: r.suggestedPct, tranches: r.tranches, stopLoss: r.stopLoss };
    }
  } catch { /* 不影响主链 */ }

  // ② 加盯价（仅当有 code 且 priceAtPost>0）
  if (post.code && typeof post.priceAtPost === "number" && post.priceAtPost > 0) {
    try {
      const stopLossPct = result.positionAdvice?.stopLoss ?? 5;
      const buyLow = post.priceAtPost * (1 - stopLossPct / 100);
      const buyHigh = post.priceAtPost * 1.02;
      const stopLoss = post.priceAtPost * (1 - (stopLossPct * 1.5) / 100);
      await fetch("/api/watch/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: post.code,
          name: post.mainline ?? "",
          buy_low: buyLow,
          buy_high: buyHigh,
          stop_loss: stopLoss,
          trigger_pct: stopLossPct,
          status: "active",
        }),
      });
      result.addedToWatch = true;
    } catch { /* 不影响主链 */ }
  }

  // ④ 推送（依赖 P0-4 pushGateway，先 try import；未就绪时静默）
  try {
    const { pushMessage } = await import("./pushGateway");
    const ok = await pushMessage({
      title: `🎬 拍板：${post.mainline ?? post.code} 确认上车`,
      body: result.positionAdvice
        ? `仓位建议 ${result.positionAdvice.suggestedPct}% · 止损 ${result.positionAdvice.stopLoss}%`
        : `拍板已落库；置信 ${post.confidenceAtPost ?? "?"}%`,
      severity: "info",
    });
    result.pushed = ok;
  } catch { /* P0-4 未就绪时静默 */ }

  return result;
}