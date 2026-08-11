// ============================================================
// v9.101.1（产品级升级第一批 T-B1）：期望值 EV 统计纯函数
// 游资决策核心"胜率×赔率=期望值 EV"显性化 —— recTracker/signalLedger
// 已有 T+1/T+3 回填数据，本模块把样本聚合成可展示的统计口径。
// 口径：胜率 = 正收益样本比例；赔率 = 平均盈 / 平均亏；
//       EV = 胜率×平均盈 - (1-胜率)×平均亏（%）
// 诚实标注：样本 < minSamples（默认 20）→ accumulated=false（"积累中"），
//   沿用项目"样本不足/估算值*"风格，不误导决策。
// ============================================================

export interface EvStats {
  /** 胜率 %（正收益样本比例），无样本为 null */
  winRate: number | null;
  /** 平均盈利 %（正收益样本均值） */
  avgWin: number | null;
  /** 平均亏损 %（亏损样本均值，正数表示亏损幅度） */
  avgLoss: number | null;
  /** 赔率 = avgWin / avgLoss（亏损样本为 0 时用 1 保底，避免除零） */
  payoff: number | null;
  /** 期望值 % = winRate×avgWin - (1-winRate)×avgLoss */
  ev: number | null;
  /** 样本数 */
  sampleCount: number;
  /** 样本是否达到可信门槛（≥ minSamples）—— false 时 UI 显示"积累中" */
  accumulated: boolean;
  /** 人类可读摘要："胜率 X%（n 样本）· 赔率 Y:1 · EV Z%" */
  label: string;
}

/**
 * 计算期望值统计（纯函数）
 * @param rets  历史样本收益率数组（%，如 recTracker T+1 回填的 pct 序列）
 * @param minSamples 可信样本门槛（默认 20，样本不足显示"积累中"）
 */
export function computeEvStats(rets: number[], minSamples = 20): EvStats {
  const sampleCount = Array.isArray(rets) ? rets.length : 0;
  const accumulated = sampleCount >= minSamples;
  if (sampleCount === 0) {
    return { winRate: null, avgWin: null, avgLoss: null, payoff: null, ev: null, sampleCount: 0, accumulated: false, label: `积累中（0/${minSamples} 样本）` };
  }
  const wins = rets.filter(r => r > 0);
  const losses = rets.filter(r => r < 0);
  const winRate = Math.round(wins.length / sampleCount * 1000) / 10;
  const avgWin = wins.length > 0 ? wins.reduce((s, v) => s + v, 0) / wins.length : null;
  // 亏损幅度取正数（平均亏 X%），全赢无亏损样本时用 1% 保底（避免除零；无亏损即赔率极高语义）
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, v) => s + v, 0) / losses.length) : null;
  const lossBase = avgLoss ?? 1;
  const payoff = avgWin != null ? Math.round(avgWin / lossBase * 10) / 10 : null;
  // v9.101.1：全亏（winRate=0 且 avgWin=null）时 EV 仍可算 = -avgLoss（-lossBase）
  const ev = avgWin != null || winRate === 0
    ? Math.round((winRate / 100 * (avgWin ?? 0) - (1 - winRate / 100) * lossBase) * 10) / 10
    : null;
  const label = accumulated
    ? `胜率 ${winRate}%（${sampleCount} 样本）· 赔率 ${payoff ?? "—"}:1 · EV ${ev ?? "—"}%`
    : `积累中（${sampleCount}/${minSamples} 样本）· 当前胜率 ${winRate}%`;
  return { winRate, avgWin, avgLoss, payoff, ev, sampleCount, accumulated, label };
}
