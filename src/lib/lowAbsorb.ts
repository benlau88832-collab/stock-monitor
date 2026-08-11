// ============================================================
// v9.101.1（产品级升级第一批 T-B3）：低吸信号引擎（纯函数）
// 客户要求"不追高、做低吸、重胜率赔率" —— 低吸信号从文案级升级为量化信号。
// 候选 = 主线内首板/二板回踩标的；信号组合（全部满足才 ok）：
//   ① 回踩 5 日线不破（现价 ≥ MA5×0.98，回踩到位）
//   ② 缩量（量比 < 0.8，抛压枯竭）
//   ③ 主力 5 日净流入（>0，资金仍在）
//   ④ 环境允许（炸板率 < 30%，情绪不极端分歧）
// 输出"低吸区/止损/目标"三线：低吸区 = MA5 ±2%；止损 = MA5×0.97；
//   目标 = 现价×1.05（首板回踩的次日反抽参考，后续可接前高/涨停价）。
// 阈值可被调用方覆盖（opts），纯函数无副作用。
// ============================================================

export interface LowAbsorbInput {
  /** 现价 */
  price: number;
  /** 5 日均线价 */
  ma5: number;
  /** 量比 = 今日均量 / 5 日均量（<0.8 缩量） */
  volumeRatio: number;
  /** 主力 5 日净流入（元，>0 为净流入） */
  mainNet5d: number;
  /** 当日炸板率 %（<30 环境允许） */
  blastedRate: number;
}

export interface LowAbsorbResult {
  /** 全部信号满足 = true */
  ok: boolean;
  /** 逐信号判定（UI 可逐项打勾/叉） */
  signals: Array<{ name: string; pass: boolean; detail: string }>;
  /** 低吸区 [下沿, 上沿]（MA5 ±2%），不满足时为 null */
  lowAbsorbZone: [number, number] | null;
  /** 止损价（MA5×0.97） */
  stopLoss: number | null;
  /** 目标价（现价×1.05） */
  target: number | null;
  /** 人类可读摘要 */
  text: string;
}

/**
 * 低吸信号判定（纯函数）
 * @param input 候选标的信号输入
 * @param opts 阈值覆盖（默认：回踩容差 2% / 量比 <0.8 / 炸板率 <30%）
 */
export function judgeLowAbsorb(
  input: LowAbsorbInput,
  opts?: { pullbackTolerance?: number; volumeRatioMax?: number; blastedRateMax?: number },
): LowAbsorbResult {
  const tol = opts?.pullbackTolerance ?? 0.02;
  const volMax = opts?.volumeRatioMax ?? 0.8;
  const blastMax = opts?.blastedRateMax ?? 30;
  const signals = [
    { name: "回踩5日线不破", pass: input.price >= input.ma5 * (1 - tol), detail: `现价 ${input.price.toFixed(2)} vs MA5 ${input.ma5.toFixed(2)}` },
    { name: "缩量（量比<" + volMax + "）", pass: input.volumeRatio < volMax, detail: `量比 ${input.volumeRatio.toFixed(2)}` },
    { name: "主力5日净流入", pass: input.mainNet5d > 0, detail: `主力5日 ${(input.mainNet5d / 1e8).toFixed(2)}亿` },
    { name: "炸板率环境允许（<" + blastMax + "%）", pass: input.blastedRate < blastMax, detail: `炸板率 ${input.blastedRate.toFixed(1)}%` },
  ];
  const ok = signals.every(s => s.pass);
  const lowAbsorbZone: [number, number] | null = ok
    ? [Math.round(input.ma5 * (1 - tol) * 100) / 100, Math.round(input.ma5 * (1 + tol) * 100) / 100]
    : null;
  const stopLoss = ok ? Math.round(input.ma5 * 0.97 * 100) / 100 : null;
  const target = ok ? Math.round(input.price * 1.05 * 100) / 100 : null;
  const text = ok
    ? `低吸区 ${lowAbsorbZone![0].toFixed(2)}-${lowAbsorbZone![1].toFixed(2)} · 止损 ${stopLoss!.toFixed(2)} · 目标 ${target!.toFixed(2)}`
    : `未满足（${signals.filter(s => !s.pass).map(s => s.name).join("、")}）`;
  return { ok, signals, lowAbsorbZone, stopLoss, target, text };
}
