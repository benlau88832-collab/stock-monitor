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

export interface PostHookCtx {
  /** v9.77（P0-15）：真实主线阶段（stageModel 权威词表）—— 原硬编码"观察中"导致仓位恒 0%/观望 */
  stage?: string;
  /** v9.77（P0-15）：真实闸门系数/上限 */
  gate?: { mode?: string; factor?: number | null; positionLimit?: number; riskLevel?: string };
  /** v9.77（P0-15）：真实强度分（AI 置信仅作兜底） */
  strengthScore?: number | null;
}

export async function runPostHook(post: DecisionPost, ctx?: PostHookCtx): Promise<PostHookResult> {
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
      // v9.77（P0-15 修复）：真实 stage/gate 替代硬编码"观察中/low/open"（原恒判非介入窗口→0%/观望）
      const { stageOfStrength } = await import("./stageModel");
      const stage = ctx?.stage ?? stageOfStrength({ strengthScore: ctx?.strengthScore ?? post.confidenceAtPost ?? 0 });
      const r = await t.execute({
        mainline: post.mainline ?? "—",
        strengthScore: ctx?.strengthScore ?? post.confidenceAtPost ?? null,
        stage,
        gateMode: ctx?.gate?.mode ?? "full",
        marketFactor: ctx?.gate?.factor ?? 0.5,
      }) as { action?: string; suggestedPct: number; tranches: number[]; stopLoss: number };
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
    // v9.77（P0-15）：0% 仓（非介入窗口）不推送"仓位建议 0%"这种误导性数字
    const advTxt = result.positionAdvice && result.positionAdvice.suggestedPct > 0
      ? `仓位建议 ${result.positionAdvice.suggestedPct}% · 止损 ${result.positionAdvice.stopLoss}%`
      : result.positionAdvice
        ? "当前非最佳介入窗口（观望）"
        : null;
    const ok = await pushMessage({
      title: `🎬 拍板：${post.mainline ?? post.code} 确认上车`,
      body: advTxt ? `${advTxt}\n置信 ${post.confidenceAtPost ?? "?"}%` : `拍板已落库；置信 ${post.confidenceAtPost ?? "?"}%`,
      severity: "warning", // v9.77（A3-P2-9）：原 info 低于默认 minSeverity=warning → 拍板推送默认静默；提为 warning 默认可达
    });
    result.pushed = ok;
  } catch { /* P0-4 未就绪时静默 */ }

  return result;
}