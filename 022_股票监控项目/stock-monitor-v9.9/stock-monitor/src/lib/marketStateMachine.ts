// ============================================================
// v9.34（S2）：市场状态机 —— 幻方"状态自适应"思想落地
// 幻方中层策略工厂：按市场状态动态调整策略参数（趋势市加仓/震荡市降频）。
// 游资版翻译：同样一个信号在不同市场状态下结果天差地别，
// 必须先回答"今天是什么市"，再决定仓位与打法。
// 输入：情绪/涨停/跌停/炸板/溢价分布/最高板 → 输出市场状态 + 证据 + 仓位系数
// v9.62（V9-L1）：阈值统一引用 thresholds.ts（同一概念口径一致）
// ============================================================
import {
  SENTI_ICEBERG_STATE, DT_COUNT_ICEBERG, SENTI_WEAK, BLAST_RATE_HIGH,
  SENTI_EXTREME, ZT_COUNT_EUPHORIA, BLAST_RATE_LOW, BLAST_RATE_WARN,
  ZT_COUNT_BOOM,
} from "./thresholds";

export type MarketState = "亢奋普涨" | "局部主线" | "分歧震荡" | "亏钱效应" | "冰点恐慌";

export interface MarketStateInput {
  sentiment: number;        // 情绪分 0-100
  ztCount: number;          // 涨停数
  dtCount: number;          // 跌停数
  blastedRate: number;      // 炸板率 %（0-100）
  premiumAvg: number | null; // 昨日涨停今日平均溢价 %
  maxBoardHeight: number | null; // 今日最高连板
}

export interface MarketStateResult {
  state: MarketState;
  confidence: number;       // 0-100
  evidence: string[];
  /** 仓位系数：该状态下总仓位建议乘数（0.2~1.0），供 positionSizing/纪律面板联动 */
  positionFactor: number;
  /** 打法建议（一句话） */
  playbook: string;
}

export function classifyMarketState(input: MarketStateInput): MarketStateResult {
  const { sentiment, ztCount, dtCount, blastedRate, premiumAvg, maxBoardHeight } = input;
  const ev: string[] = [];
  const push = (s: string) => ev.push(s);

  push(`情绪${sentiment}分`);
  push(`涨停${ztCount}只`);
  if (dtCount > 0) push(`跌停${dtCount}只`);
  push(`炸板率${blastedRate.toFixed(0)}%`);
  if (premiumAvg != null) push(`溢价${premiumAvg >= 0 ? "+" : ""}${premiumAvg.toFixed(1)}%`);
  if (maxBoardHeight != null) push(`最高${maxBoardHeight}板`);

  // ---- 判态规则（优先级从极端到温和）----
  // 1) 冰点恐慌：情绪极低 + 大面积跌停
  if (sentiment <= SENTI_ICEBERG_STATE && dtCount >= DT_COUNT_ICEBERG) {
    return { state: "冰点恐慌", confidence: 90, evidence: ev, positionFactor: 0.2, playbook: "空仓等待，只做超跌反包试错，仓位≤2成" };
  }
  // 2) 亏钱效应：情绪低 + 炸板率高（封不住 = 没人愿意接力）
  if (sentiment <= SENTI_WEAK && blastedRate >= BLAST_RATE_HIGH) {
    return { state: "亏钱效应", confidence: 85, evidence: ev, positionFactor: 0.4, playbook: "只做最强主线龙头，禁止追跟风板，仓位≤4成" };
  }
  // 3) 亢奋普涨：情绪高 + 涨停多 + 炸板低 + 溢价正
  if (sentiment >= SENTI_EXTREME && ztCount >= ZT_COUNT_EUPHORIA && blastedRate <= BLAST_RATE_LOW && (premiumAvg == null || premiumAvg >= 0)) {
    return { state: "亢奋普涨", confidence: 80, evidence: ev, positionFactor: 1.0, playbook: "重仓主线核心，可打板可低吸，仓位可满" };
  }
  // 4) 分歧震荡：炸板率上升 + 溢价转弱（多空换手加剧）
  if (blastedRate >= BLAST_RATE_WARN || (premiumAvg != null && premiumAvg < -2)) {
    return { state: "分歧震荡", confidence: 75, evidence: ev, positionFactor: 0.6, playbook: "只打确定性龙头，高位股快进快出，仓位≤6成" };
  }
  // 5) 局部主线：情绪中性 + 有主线高度（结构性行情）
  if (ztCount >= ZT_COUNT_BOOM && (maxBoardHeight ?? 0) >= 3) {
    return { state: "局部主线", confidence: 70, evidence: ev, positionFactor: 0.8, playbook: "聚焦单一最强主线，放弃分支，仓位7-8成" };
  }
  // 6) 兜底
  return { state: "分歧震荡", confidence: 50, evidence: ev, positionFactor: 0.5, playbook: "市场信号混杂，降低频率，等待明确主线" };
}

// ---------- 状态展示元信息 ----------
export const MARKET_STATE_META: Record<MarketState, { color: string; icon: string }> = {
  亢奋普涨: { color: "bg-rose-500/20 text-rose-300 border-rose-500/40", icon: "🔥" },
  局部主线: { color: "bg-amber-500/20 text-amber-300 border-amber-500/40", icon: "🎯" },
  分歧震荡: { color: "bg-violet-500/20 text-violet-300 border-violet-500/40", icon: "⚖️" },
  亏钱效应: { color: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40", icon: "🩸" },
  冰点恐慌: { color: "bg-sky-500/20 text-sky-300 border-sky-500/40", icon: "🧊" },
};
