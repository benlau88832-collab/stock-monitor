// 主线级离场信号（v9.23-2，PRD 6.4）
// 游资亏钱往往不是没抓到主线，而是主线退潮时没跑。
// 触发任一即弹出红色预警（必须与"主线阶段"联动，而非仅大盘层面）：
//   1. 该主线炸板率单日环比上升 ≥ 15 个百分点
//   2. 该主线涨停家数环比下降 ≥ 30%
//   3. 该主线最高板较昨日下降 ≥ 1 档，且连续 2 日
//   4. 该主线内主力资金由净流入转净流出，且散户资金转净流入（游资出、散户接）
// 纯函数，不碰 DOM/localStorage/网络

export interface ExitSignalInput {
  /** 主线名 */
  mainline: string;
  /** 今日涨停家数 */
  ztCountToday: number;
  /** 昨日涨停家数 */
  ztCountYesterday: number | null;
  /** 今日最高连板 */
  heightToday: number;
  /** 昨日最高连板 */
  heightYesterday: number | null;
  /** 今日炸板率 % */
  blastedRateToday: number | null;
  /** 昨日炸板率 % */
  blastedRateYesterday: number | null;
  /** 今日主力净流入（元） */
  mainNetToday: number;
  /** 昨日主力净流入（元） */
  mainNetYesterday: number | null;
}

export interface ExitSignalResult {
  /** 是否触发离场信号 */
  triggered: boolean;
  /** 触发的规则描述（≤40字），未触发为 "" */
  text: string;
  /** 命中规则数 */
  hitCount: number;
}

export function checkExitSignal(input: ExitSignalInput): ExitSignalResult {
  const hits: string[] = [];

  // 规则1：炸板率环比 +15pp
  if (
    input.blastedRateToday != null &&
    input.blastedRateYesterday != null &&
    input.blastedRateToday - input.blastedRateYesterday >= 15
  ) {
    hits.push(`炸板率${input.blastedRateToday.toFixed(0)}%（环比+${(input.blastedRateToday - input.blastedRateYesterday).toFixed(0)}pp）`);
  }

  // 规则2：涨停家数环比 -30%
  if (
    input.ztCountYesterday != null &&
    input.ztCountYesterday > 0 &&
    input.ztCountToday < input.ztCountYesterday * 0.7
  ) {
    hits.push(`涨停${input.ztCountToday}家（环比-${Math.round((1 - input.ztCountToday / input.ztCountYesterday) * 100)}%）`);
  }

  // 规则3：最高板下降 ≥1 档且连续 2 日（本函数只判今日下降，连续性由调用方传昨日已下降标记）
  // 简化：今日高度 < 昨日高度即触发（连续 2 日的部分依赖历史快照，调用方补充）
  if (
    input.heightYesterday != null &&
    input.heightToday < input.heightYesterday
  ) {
    hits.push(`最高板降至${input.heightToday}板（昨日${input.heightYesterday}板）`);
  }

  // 规则4：主力净流入转负（游资出），散户流入无法直接获取（东财无此字段）
  // 简化：今日主力净流入为负 且 昨日为正 = 资金转向
  if (
    input.mainNetYesterday != null &&
    input.mainNetYesterday > 0 &&
    input.mainNetToday <= 0
  ) {
    hits.push(`主力资金转流出（${(input.mainNetToday / 1e8).toFixed(1)}亿）`);
  }

  return {
    triggered: hits.length > 0,
    text: hits.join("；").slice(0, 40),
    hitCount: hits.length,
  };
}
