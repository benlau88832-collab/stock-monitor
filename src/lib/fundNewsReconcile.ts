// ============================================================
// v9.38（V3-13）：资金-消息对账引擎
// 核心：把"AI 判定利好的板块"与实时资金流对账——
//   利好 + 资金连日流出 → "⚠ 政策未兑现/疑似诱多"
//   利好 + 资金进场 → 升级可信度
// 这把"消息面"和"资金面"真正咬合（用户明确要的"结合资金流向"）
// ============================================================

export interface NewsBoardCheck {
  board: string;              // 板块名
  /** 消息面强度 0-100（来自 LLM 事件分级或规则评分） */
  newsScore: number;
  /** 今日主力净额（元，负=流出） */
  todayMainNet: number;
  /** 连续流入天数（正=流入 N 天，负=流出 N 天） */
  streakDays: number;
}

export type ReconcileStatus = "兑现" | "未兑现" | "待观察" | "资金背离";

export interface ReconcileResult {
  board: string;
  status: ReconcileStatus;
  /** 对账结论一句话 */
  conclusion: string;
  /** 对账建议：可上车 / 观望 / 禁止 */
  action: "可上车" | "观望" | "禁止";
  /** 证据 */
  evidence: string[];
}

/**
 * 资金-消息对账：
 * - 利好(score≥60) + 今日净流入 + 连续流入 → "兑现"，可上车
 * - 利好(score≥60) + 今日/连续流出 → "资金背离"（政策未兑现/诱多），观望或禁止
 * - 消息中性 + 资金流入 → "待观察"
 * - 消息中性 + 资金流出 → "未兑现/背离"，观望
 */
export function reconcileFundNews(check: NewsBoardCheck): ReconcileResult {
  const { board, newsScore, todayMainNet, streakDays } = check;
  const evidence: string[] = [
    `消息面强度 ${newsScore}`,
    `今日主力${todayMainNet >= 0 ? "+" : ""}${(todayMainNet / 1e8).toFixed(2)}亿`,
    streakDays >= 1 ? `连续${streakDays}日流入` : streakDays <= -1 ? `连续${-streakDays}日流出` : "资金无明显趋势",
  ];
  const strongNews = newsScore >= 60;
  const inflow = todayMainNet > 0;
  const streakInflow = streakDays >= 2;

  if (strongNews && inflow && streakInflow) {
    return { board, status: "兑现", conclusion: `政策/消息利好已被资金确认（连续${streakDays}日流入），可信度高`, action: "可上车", evidence };
  }
  if (strongNews && inflow) {
    return { board, status: "兑现", conclusion: "消息利好且今日资金进场，初步确认", action: "可上车", evidence };
  }
  if (strongNews && !inflow) {
    return { board, status: "资金背离", conclusion: `消息利好但主力${todayMainNet >= 0 ? "流入弱" : "净流出"}，政策可能未兑现或为诱多，谨慎`, action: streakDays <= -1 ? "禁止" : "观望", evidence };
  }
  if (!strongNews && inflow) {
    return { board, status: "待观察", conclusion: "消息面中性但资金流入，可能有未公开利好，保持观察", action: "观望", evidence };
  }
  return { board, status: "未兑现", conclusion: "消息面无亮点且资金未进，无交易价值", action: "观望", evidence };
}

/** 批量对账（供决策总线/展示用） */
export function reconcileBatch(checks: NewsBoardCheck[]): ReconcileResult[] {
  return checks.map(reconcileFundNews);
}
