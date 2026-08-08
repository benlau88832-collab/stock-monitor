// ============================================================
// P1-2：决策鉴别力偏差解释 —— "AI 为何改判"的可信度提示
// 对比上次同一主线的裁决（近3天），输出动作变化 + 置信差 + 理由关键词差异
// 让"改判"从黑箱变为可理解：变化是数据驱动而非随机
// ============================================================
import { loadDecisionLogs } from "./decisionAttribution";

export interface DiffResult {
  changed: boolean;
  prevAction: string | null;
  currAction: string;
  confidenceDelta: number | null;
  /** 理由中新增/变化的关键证据短语（从 prev vs curr reason 中提取数字型证据） */
  reasonsChanged: string[];
}

/** 提取理由中的数字证据短语（如"封单1.2亿"、"8000万"），用于对比新旧理由的差异 */
export function extractEvidencePhrases(reason: string | undefined | null): string[] {
  if (!reason) return [];
  // 匹配 "数字+单位" 或 "数字%" 短语
  const m = reason.match(/[+-]?\d+(?:\.\d+)?\s*(?:亿|万|%|板|元|只|家)/g);
  return (m ?? []).slice(0, 6);
}

/**
 * 对比当前裁决与上次（近3天内同一主线、动作不同的）裁决
 * 返回差异摘要；无历史/无变化返回 changed:false
 */
export function diffLastDecision(curr: { action: string; confidence: number; reason: string; mainline: string }): DiffResult {
  const logs = loadDecisionLogs(3);
  // 取最近一条"同主线且动作不同"的裁决（不含本条——loadDecisionLogs 返回的是历史日志）
  const prev = logs.find(l => l.mainline === curr.mainline && l.action !== curr.action);
  if (!prev) {
    return { changed: false, prevAction: null, currAction: curr.action, confidenceDelta: null, reasonsChanged: [] };
  }
  const prevPhrases = new Set(extractEvidencePhrases(prev.agentReason ?? prev.gatedDowngrade ?? ""));
  const currPhrases = extractEvidencePhrases(curr.reason);
  // 新增的证据短语 = 当前有而上次没有的
  const reasonsChanged = currPhrases.filter(p => !prevPhrases.has(p)).slice(0, 4);
  return {
    changed: true,
    prevAction: prev.action,
    currAction: curr.action,
    confidenceDelta: curr.confidence - (prev.confidence ?? 0),
    reasonsChanged,
  };
}

/** 生成一句话解释（供卡片展示） */
export function diffToText(diff: DiffResult): string {
  if (!diff.changed) return "";
  const dir = diff.confidenceDelta != null && diff.confidenceDelta >= 0 ? "+" : "";
  let txt = `⚠ 相比上次裁决（${diff.prevAction} → ${diff.currAction}），置信 ${dir}${diff.confidenceDelta ?? 0}`;
  if (diff.reasonsChanged.length > 0) {
    txt += `，新增关键证据：${diff.reasonsChanged.join("、")}`;
  }
  return txt;
}