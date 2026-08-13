// ============================================================
// src/lib/cognitionMainline.ts —— 主线单源锚定（v9.136.0）
// 架构：全站"第一主线"单一事实源 = 认知层 primaryTheme（服务端 theme_analysis 30min 快照，
//   排序键已与服务端 calcMainlineStrength 强度分统一）。前端实战引擎（涨停池 60s 实时归类）
//   降级为实时增量：渲染锚定 = 认知主线同名组置顶；无同名组时用 theme_analysis 数据构造补位组。
// 验收：同屏 五问条/作战卡/认知横幅 主线名完全一致（锚定后恒等）。
// 纯函数：无 I/O，可单测（cognitionMainline.test.ts）。
// ============================================================
import type { MainlineGroup, MainlineLeader } from "./stockToMainline";

/** 服务端 theme_analysis themes 项 → 前端 MainlineGroup（补位组：认知层数据，实时增量不覆盖） */
export function buildCognitionGroup(t: Record<string, unknown>): MainlineGroup {
  const picks = Array.isArray(t.picks) ? t.picks : [];
  const leaders: MainlineLeader[] = picks.slice(0, 3).map((p: Record<string, unknown>, i: number) => ({
    code: String(p.code ?? ""),
    name: String(p.name ?? ""),
    role: (["龙一", "龙二", "龙三"] as const)[Math.min(i, 2)],
    boardCount: 0,
    firstBoardTime: "",
    sealFund: 0,
    amount: 0,
    pct: 0,
    reason: p.aiVerdict ? `认知层判定${p.aiVerdict} · ${String(p.buyTrigger ?? "")}`.trim() : String(p.buyTrigger ?? "认知层选股"),
    popularRank: -1,
  }));
  const evidence = Array.isArray(t.evidence) ? t.evidence : [];
  const strength = typeof t.strength === "number" ? t.strength : 0;
  return {
    mainline: String(t.theme ?? ""),
    ztCount: typeof t.ztCount === "number" ? t.ztCount : 0,
    height: typeof t.height === "number" ? t.height : 0,
    mainNet: 0,
    mainNet5d: 0,
    boardPct: 0,
    newsTitles: evidence.map((e: Record<string, unknown>) => String(e.title ?? "")),
    isPulse: false,
    logic: "认知层主线（服务端 theme_analysis 快照）",
    caution: t.verdict === "风险警示" ? "风险警示" : "",
    score: strength,
    strengthScore: strength,
    fromLLM: false,
    leaders,
  };
}

export interface AnchorResult {
  list: MainlineGroup[];
  /** 锚定是否生效（认知主线已置顶/补位） */
  anchored: boolean;
  /** 是否由服务端 theme_analysis 补位（非前端实时候选） */
  fromServer: boolean;
}

/**
 * 实战候选列表锚定认知主线（App.tsx renderBattlePlan 用）
 * @param candidates 前端实时归类候选（已按强度分排序）
 * @param cognMainline 认知层 primaryTheme（/api/cognition）
 * @param themeAnalysis kv theme_analysis:latest（补位数据源，可 null）
 */
export function anchorCognitionMainline(
  candidates: MainlineGroup[],
  cognMainline: string | undefined,
  themeAnalysis: { themes?: Array<Record<string, unknown>> } | null,
): AnchorResult {
  if (!cognMainline || cognMainline === "数据不足" || candidates.length === 0) {
    return { list: candidates, anchored: false, fromServer: false };
  }
  const list = [...candidates];
  const idx = list.findIndex(c => c.mainline === cognMainline);
  if (idx === 0) return { list, anchored: true, fromServer: false };
  if (idx > 0) {
    const [hit] = list.splice(idx, 1);
    list.unshift(hit);
    return { list, anchored: true, fromServer: false };
  }
  // 无同名组（前端实时池未归出认知主线）→ 服务端 theme_analysis 补位
  const themes = Array.isArray(themeAnalysis?.themes) ? themeAnalysis.themes : [];
  const top = themes.find(t => String(t.theme ?? "") === cognMainline) ?? themes[0];
  if (top) {
    list.unshift(buildCognitionGroup(top));
    return { list, anchored: true, fromServer: true };
  }
  return { list, anchored: false, fromServer: false };
}

/** BattlePlan 渲染层锚定（llmRanked 显示时用）：扁平 display 项置顶；candidates 兜底补同名组 */
export function anchorDisplay<T extends { board: string }>(
  display: T[],
  cognMainline: string | undefined,
  candidates: MainlineGroup[],
): T[] {
  if (!cognMainline || cognMainline === "数据不足" || display.length === 0) return display;
  const list = [...display];
  const idx = list.findIndex(d => d.board === cognMainline);
  if (idx === 0) return list;
  if (idx > 0) {
    const [hit] = list.splice(idx, 1);
    list.unshift(hit);
    return list;
  }
  // llmRanked 未含认知主线 → 从 candidates 补同名组（App 锚定后 candidates[0] 必为认知主线）
  const cand = candidates.find(c => c.mainline === cognMainline);
  if (cand) {
    list.unshift({
      board: cand.mainline, ztCount: cand.ztCount, height: cand.height, mainNet: cand.mainNet,
      leaders: cand.leaders, logic: cand.logic, isPulse: cand.isPulse, caution: cand.caution,
      strengthScore: cand.strengthScore, exitSignal: cand.exitSignal, exitSignalText: cand.exitSignalText,
    } as unknown as T);
  }
  return list;
}
