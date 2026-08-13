// ============================================================
// server/lib/stageBacktest.js —— 情绪周期回测引擎（v9.126.0，蓝图 L4 批次 C 前置）
// 蓝图要求：情绪周期阶段判定必须回测验证——各阶段次日溢价/赚钱效应分布（IC 思路），
//   阈值对照蓝图表（试错<30涨停/发酵炸板<10%/震荡10-25%/退潮>25%）校准，而非拍脑袋。
//   v9.136.0（任务3 收口）：上述 10/25 为蓝图回测校准对照值（仅注释参考），非运行期阈值——
//   运行期阶段判定走 deriveSentimentStage（thresholds.BLAST_DIVERGE_PCT=15），校准档位不注入代码。
// 设计（纯函数 0 token，PG-first）：
//   - 历史阶段重建：不依赖 cognition_snapshots 历史（目前仅 1 行）——用 market_daily 逐日
//     重建：sentiment 分 + premiumAvg + blastedRate → deriveSentimentStage（与认知层同一判定函数，
//     保证"回测口径 = 生产口径"）。
//   - 次日赚钱效应：premiumAvg(T+1)（昨日涨停今日平均溢价，游资核心盈亏代理）+ promotionRate(T+1)。
// 合规：输出带 n/sampleSize/caliber；N<5 标注"样本不足仅供参考"；不承诺胜率。
// ============================================================
const { deriveSentimentStage } = require("./cognition");

/**
 * 单日 market_daily → 阶段行（纯函数；与 buildCognition 同口径的派生路径）
 * @param {object} daily {date, sentiment, ztCount, blastedRate, maxBoardHeight, premiumAvg, promotionRate}
 * @param {object|null} nextDaily 次日 market_daily（算赚钱效应）
 */
function stageFromDaily(daily, nextDaily) {
  const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v))) ? null : Number(v);
  const score = num(daily?.sentiment);
  const premium = num(daily?.premiumAvg);
  const brokenRate = num(daily?.blastedRate) != null ? num(daily.blastedRate) / 100 : 0;
  const stage = deriveSentimentStage(score ?? 0, premium ?? 0, brokenRate);
  return {
    date: String(daily?.date ?? ""),
    stage,
    score, premium,
    ztCount: num(daily?.ztCount),
    blastedRate: num(daily?.blastedRate),
    maxBoardHeight: num(daily?.maxBoardHeight),
    promotionRate: num(daily?.promotionRate),
    nextPremium: num(nextDaily?.premiumAvg),
    nextPromotion: num(nextDaily?.promotionRate),
  };
}

/**
 * 阶段序列 → 分阶段统计（纯函数）
 * @param {Array} rows stageFromDaily 输出数组（含 nextPremium 的行才入样本）
 * @returns {Array<{stage,n,winRate,avgPremium,avgNextPromotion}>}
 */
function stageBacktest(rows) {
  const groups = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || r.nextPremium == null) continue; // 无次日数据不入样本
    const g = groups.get(r.stage) ?? { stage: r.stage, n: 0, wins: 0, premiumSum: 0, promoSum: 0 };
    g.n += 1;
    if (r.nextPremium > 0) g.wins += 1;
    g.premiumSum += r.nextPremium;
    g.promoSum += r.nextPromotion ?? 0;
    groups.set(r.stage, g);
  }
  return [...groups.values()].map((g) => ({
    stage: g.stage,
    n: g.n,
    winRate: g.n > 0 ? Math.round(g.wins / g.n * 100) : 0,
    avgPremium: g.n > 0 ? Math.round(g.premiumSum / g.n * 100) / 100 : null,
    avgNextPromotion: g.n > 0 ? Math.round(g.promoSum / g.n * 10) / 10 : null,
    sampleEnough: g.n >= 5,
  })).sort((a, b) => b.n - a.n);
}

module.exports = { stageFromDaily, stageBacktest };
