// ============================================================
// v9.101.1（产品级升级第一批 T-D4）：盘口特征三分类（纯函数）
// 客户点名"多场景情绪面识别（诱多/假摔/外围映射/政策突发）"——
// 诱多/假摔属盘口情绪面，本模块把 trapDetector 单阈值升级为
// 封成比/封单占比/撤单速度/大单流向/换手组合的三类信号：
//   强势介入：封成比高（≥2）且封单稳定（|变化率|<15%）+ 大单净流入 + 换手温和（<20%）
//   诱多：封单大但快速撤单（变化率 ≤-30%）+ 大单流出
//   假摔：炸板但大单未出（大单净流入或未大幅流出），筹码未走
// 叠加情绪周期位置调阈值（情绪冰点时收紧介入阈值）——opts.blastedRate 环境参数预留。
// 纯函数无副作用；阈值可覆盖。
// ============================================================

export interface BoardTrapInput {
  /** 封成比 = 封单额 / 成交额（≥1 表示封住） */
  sealRatio: number;
  /** 封单变化率 %（负 = 撤单；-30% 以下 = 快速撤单） */
  sealChangeRate: number;
  /** 大单净流向（元，正 = 净流入） */
  bigNetFlow: number;
  /** 换手率 %（涨停池数据源无换手字段时可不传） */
  turnoverRate?: number;
  /** 是否已炸板（炸板后大单流向是假摔判定的前提） */
  blasted: boolean;
}

export type BoardTrapType = "强势介入" | "诱多" | "假摔";

export interface BoardTrapResult {
  type: BoardTrapType | null;
  reasons: string[];
}

/**
 * 盘口三分类（纯函数）
 * 优先级：诱多 > 假摔 > 强势介入（诱多最危险先判；假摔需炸板前提）
 */
export function classifyBoardTrap(
  input: BoardTrapInput,
  opts?: { sealRatioMin?: number; sealStableMax?: number; retreatRate?: number; turnoverMax?: number },
): BoardTrapResult {
  const sealMin = opts?.sealRatioMin ?? 2;
  const stableMax = opts?.sealStableMax ?? 15;
  const retreat = opts?.retreatRate ?? 30;
  const turnMax = opts?.turnoverMax ?? 20;
  const bigIn = input.bigNetFlow > 0;
  const bigOut = input.bigNetFlow < 0;

  // 诱多：封单大但快速撤单 + 大单流出（拉高派发特征）
  if (input.sealChangeRate <= -retreat && bigOut) {
    return { type: "诱多", reasons: [`封单快速撤单 ${input.sealChangeRate.toFixed(0)}%`, "大单净流出"] };
  }
  // 假摔：炸板但大单未出（筹码未走，次日回封概率高）
  // v9.108.0（T-6a P2-1）：假摔需至少一个正向证据 —— 小flow 与小sealchange 用 AND 绑定（原单一温和条件即判假摔过宽，
  //   盘中封单噪声易误判；v9.106.1 代理口径保留：封单变化温和 + 大单无明显流出 才视为筹码未走）
  if (input.blasted && (bigIn || (Math.abs(input.bigNetFlow) < 1e6 && Math.abs(input.sealChangeRate) < 20))) {
    return { type: "假摔", reasons: ["炸板但大单未出（筹码未走）", bigIn ? "大单仍净流入" : Math.abs(input.bigNetFlow) < 1e6 ? "大单无明显流出" : "封单变化温和"] };
  }
  // 强势介入：封成比高 + 封单稳定 + 大单流入 + 换手温和（换手缺失时不设限）
  if (input.sealRatio >= sealMin && Math.abs(input.sealChangeRate) < stableMax && bigIn && (input.turnoverRate == null || input.turnoverRate < turnMax)) {
    return { type: "强势介入", reasons: [`封成比 ${input.sealRatio.toFixed(1)}`, `封单稳定（变化 ${input.sealChangeRate.toFixed(0)}%）`, "大单净流入", input.turnoverRate != null ? `换手 ${input.turnoverRate.toFixed(1)}%` : "换手数据缺失"] };
  }
  return { type: null, reasons: [] };
}

/**
 * v9.106.2（用户定调：同概念批量涨停视为板块异动，而非自选股）：板块级盘口三分类（纯函数）
 * 板块/题材批量涨停（≥2 只）时，用板块聚合盘口特征判定板块资金性质：
 *   - sealRatio = 板块总封单 / 板块总成交（涨停池唯一有 amount 的聚合口径）
 *   - sealChangeRate / bigNetFlow = 板块总封单相对上轮的增减（封单撤 = 板块主力流出代理）
 *   - blasted = 组内炸板股占比 ≥30%（封板不稳的板块才有"假摔"语义）
 * 首轮无快照（prevTotalSealFund<=0）→ 变化率 0，不误判。
 */
export function classifyBoardTrapForBoard(
  input: { stocks: Array<{ sealFund: number; amount: number; blastCount: number }>; prevTotalSealFund: number },
  opts?: { sealRatioMin?: number; sealStableMax?: number; retreatRate?: number; turnoverMax?: number; blastRatio?: number },
): BoardTrapResult {
  const stocks = input.stocks;
  if (stocks.length < 2) return { type: null, reasons: ["板块涨停家数不足（<2）"] };
  const totalSeal = stocks.reduce((s, x) => s + (x.sealFund > 0 ? x.sealFund : 0), 0);
  const totalAmount = stocks.reduce((s, x) => s + (x.amount > 0 ? x.amount : 0), 0);
  if (totalSeal <= 0) return { type: null, reasons: ["板块无封单数据"] };
  const sealRatio = totalAmount > 0 ? totalSeal / totalAmount : 0;
  const sealChangeRate = input.prevTotalSealFund > 0 ? (totalSeal - input.prevTotalSealFund) / input.prevTotalSealFund * 100 : 0;
  const bigNetFlow = input.prevTotalSealFund > 0 ? totalSeal - input.prevTotalSealFund : 0;
  const blastRatio = opts?.blastRatio ?? 0.3;
  const blasted = stocks.filter(s => s.blastCount > 0).length / stocks.length >= blastRatio;
  return classifyBoardTrap({ sealRatio, sealChangeRate, bigNetFlow, blasted }, opts);
}
