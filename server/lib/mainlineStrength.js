// ============================================================
// server/lib/mainlineStrength.js —— 主线强度分（服务端 CJS 同构实现，v9.136.0）
// 与前端 src/lib/mainlineScore.ts（calcMainlineStrength）逐公式同构：
//   涨停家数占比 25% + 连板高度 20% + 晋级率 15% + 资金连续性 20%
//   + 换手/量能 10% + 催化剂强度 10% = 100。
// 前端 TS 模块 server(CJS) 无法 require → 此处内联等价实现（项目既有模式：
//   cron.js ETF_POOL_MINI / stockPicker 等价，注释互相引用）。
// 用途：runThemeAnalysis 主题打分对齐前端实战引擎排序键（主线单源 v9.136.0），
//   保证同一涨停池输入下服务端 primaryTheme 与前端 candidates[0] 判定口径一致。
// 纯函数：无 I/O，输入相同输出相同（golden 测试 mainlineStrengthGolden.test.ts 锁定）。
// ============================================================

function clamp(v, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * 主线强度分 0-100（与前端 calcMainlineStrength 同口径）
 * @param {object} input
 * @param {number} input.ztCount 主题涨停家数
 * @param {number} input.totalZtCount 全市场涨停家数
 * @param {number} input.height 主题最高连板
 * @param {number} input.totalMaxHeight 全市场最高连板
 * @param {number|null} input.promotionRate 晋级率 0~1（无逐主线数据 → null=中性 50）
 * @param {number} input.mainNet5d 5日主力净流入（元）
 * @param {number|null} input.mainNet10d 10日主力净流入（元，无 → null=中性）
 * @param {number} input.boardPct 板块涨幅 %（保留字段，不参与计分）
 * @param {number|null} input.turnoverRate 换手率 %（无 → null=中性 50）
 * @param {number|null} input.catalystStrength 催化剂强度 0-100（无 → null=中性 50）
 * @returns {{score:number, factors:object, tier:string}}
 */
function calcMainlineStrength(input) {
  // 1. 涨停家数占比 25%：占比 ≥20% = 100 分，≤2% = 0 分（线性）
  const ratio = input.totalZtCount > 0 ? input.ztCount / input.totalZtCount : 0;
  const ztRatio = clamp(ratio / 0.2 * 100);

  // 2. 连板高度 20%：全市场最高板 = 100 分，1 板 = 0 分
  const height = input.totalMaxHeight > 0
    ? clamp(input.height / input.totalMaxHeight * 100)
    : clamp(input.height * 25); // 无全市场数据时：1板=25, 2板=50, 3板=75, 4板=100

  // 3. 晋级率 15%：50% 晋级率 = 100 分，0% = 0 分（无数据中性 50）
  const promotion = input.promotionRate != null
    ? clamp(input.promotionRate / 0.5 * 100)
    : 50;

  // 4. 资金连续性 20%：5日净流入 +5亿 = 100 分，-5亿 = 0 分；10日缺失中性 50
  const fund5 = clamp(50 + input.mainNet5d / 1e8 * 10);
  const fund10 = input.mainNet10d != null ? clamp(50 + input.mainNet10d / 1e8 * 5) : 50;
  const fund = fund5 * 0.6 + fund10 * 0.4;

  // 5. 换手/量能活跃度 10%（无数据中性 50）
  let turnover = 50;
  if (input.turnoverRate != null) {
    if (input.turnoverRate >= 3 && input.turnoverRate <= 8) turnover = 85;
    else if (input.turnoverRate > 8) turnover = 60;
    else if (input.turnoverRate >= 1) turnover = 40;
    else turnover = 25;
  }

  // 6. 催化剂强度 10%（无数据中性 50）
  const catalyst = input.catalystStrength != null ? clamp(input.catalystStrength) : 50;

  const score = Math.round(
    ztRatio * 0.25 + height * 0.20 + promotion * 0.15 + fund * 0.20 + turnover * 0.10 + catalyst * 0.10,
  );
  return {
    score: clamp(score),
    factors: {
      ztRatio: Math.round(ztRatio),
      height: Math.round(height),
      promotion: Math.round(promotion),
      fund: Math.round(fund),
      turnover: Math.round(turnover),
      catalyst: Math.round(catalyst),
    },
    tier: score >= 80 ? "gold" : score >= 60 ? "silver" : "bronze",
  };
}

/**
 * v9.136.0（主线单源）：主题排序键 —— strength 降序 + heat tie-breaker
 * 与认知层 buildMainline / brainContext mainlines.top 同排序键，
 *   保证同一 theme_analysis 输入下三处 top1 完全一致。
 * @param {Array<{strength?:number, heat?:number, theme?:string}>} themes
 */
function rankThemesByStrength(themes) {
  return [...themes].sort(
    (a, b) => ((b.strength ?? 0) - (a.strength ?? 0)) || ((b.heat ?? 0) - (a.heat ?? 0))
      || String(a.theme ?? "").localeCompare(String(b.theme ?? "")),
  );
}

module.exports = { calcMainlineStrength, rankThemesByStrength };
