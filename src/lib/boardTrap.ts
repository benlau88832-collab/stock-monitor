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
  /** 换手率 % */
  turnoverRate: number;
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
  if (input.blasted && (bigIn || Math.abs(input.bigNetFlow) < 1e6)) {
    return { type: "假摔", reasons: ["炸板但大单未出（筹码未走）", bigIn ? "大单仍净流入" : "大单无明显流出"] };
  }
  // 强势介入：封成比高 + 封单稳定 + 大单流入 + 换手温和
  if (input.sealRatio >= sealMin && Math.abs(input.sealChangeRate) < stableMax && bigIn && input.turnoverRate < turnMax) {
    return { type: "强势介入", reasons: [`封成比 ${input.sealRatio.toFixed(1)}`, `封单稳定（变化 ${input.sealChangeRate.toFixed(0)}%）`, "大单净流入", `换手 ${input.turnoverRate.toFixed(1)}%`] };
  }
  return { type: null, reasons: [] };
}
