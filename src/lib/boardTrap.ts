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
  // v9.106.1（验收遗留 #2）：大单流向为"封单变化"代理值时（涨停池数据源无真实大单字段），
  //   以封单变化率 |Δ|<20% 视作筹码未走（炸板但封单仍稳/回封）
  if (input.blasted && (bigIn || Math.abs(input.bigNetFlow) < 1e6 || Math.abs(input.sealChangeRate) < 20)) {
    return { type: "假摔", reasons: ["炸板但大单未出（筹码未走）", bigIn ? "大单仍净流入" : Math.abs(input.bigNetFlow) < 1e6 ? "大单无明显流出" : "封单变化温和"] };
  }
  // 强势介入：封成比高 + 封单稳定 + 大单流入 + 换手温和（换手缺失时不设限）
  if (input.sealRatio >= sealMin && Math.abs(input.sealChangeRate) < stableMax && bigIn && (input.turnoverRate == null || input.turnoverRate < turnMax)) {
    return { type: "强势介入", reasons: [`封成比 ${input.sealRatio.toFixed(1)}`, `封单稳定（变化 ${input.sealChangeRate.toFixed(0)}%）`, "大单净流入", input.turnoverRate != null ? `换手 ${input.turnoverRate.toFixed(1)}%` : "换手数据缺失"] };
  }
  return { type: null, reasons: [] };
}

/**
 * v9.106.1（验收遗留 #2 接线）：涨停池数据 → BoardTrapInput 适配（纯函数）
 * 涨停池（push2ex getTopicZTPool）可得的盘口字段：fund 封单额 / amount 成交额 / zbc 炸板次数。
 * 大单流向缺失 → 用"封单增减"代理（封单撤 = 主力流出、增封 = 主力流入），仅当 prevSealFund 有效时可用；
 * 换手缺失 → 不传（强势介入放宽换手条件）。
 * @param s { sealFund, amount, blastCount } 涨停池元素
 * @param prevSealFund 上一轮该股封单额（<=0 表示无快照 → 变化率 0，首轮不判）
 */
export function classifyBoardTrapFromLimit(
  s: { sealFund: number; amount: number; blastCount: number },
  prevSealFund: number,
): BoardTrapResult {
  const sealRatio = s.amount > 0 ? s.sealFund / s.amount : 0;
  const sealChangeRate = prevSealFund > 0 && s.sealFund > 0 ? (s.sealFund - prevSealFund) / prevSealFund * 100 : 0;
  // 封单增减 = 主力行为代理（涨停封单撤/加本质是主力单）
  const bigNetFlow = prevSealFund > 0 ? s.sealFund - prevSealFund : 0;
  return classifyBoardTrap({
    sealRatio, sealChangeRate, bigNetFlow,
    blasted: s.blastCount > 0, // zbc 炸板次数 >0 = 曾炸板
  });
}
