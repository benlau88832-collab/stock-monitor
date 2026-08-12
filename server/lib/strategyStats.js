// ============================================================
// server/lib/strategyStats.js —— 战法命中率统计（v9.127.0，蓝图 L7 批次 D 前置）
// 蓝图要求：战法命中率回测统计（统计口径）——decision_post 已存 T+5 PnL 回填（P0-3），
//   按"人类拍板动作 × 置信度桶"分组统计命中率/平均 T+5 盈亏。
// 纯函数 0 token；输出带 n；N<20 标注样本不足（recTracker 同门槛约定）；不承诺胜率。
// ============================================================

/**
 * 战法命中率统计（纯函数）
 * @param {Array} rows decision_post 行（human_action/confidence_at_post/pnl/mainline）
 * @param {number} minN 每组最小样本（<minN 标注 sampleEnough=false）
 */
function strategyStats(rows, minN = 20) {
  const CONF_BUCKETS = [[0, 59], [60, 79], [80, 100]];
  const out = [];
  for (const action of ["confirm", "watch", "reject"]) {
    for (const [lo, hi] of CONF_BUCKETS) {
      const sub = (Array.isArray(rows) ? rows : [])
        .filter((r) => r && r.human_action === action && r.pnl != null)
        .filter((r) => {
          const c = r.confidence_at_post;
          return typeof c === "number" && c >= lo && c <= hi;
        });
      if (!sub.length) continue;
      const wins = sub.filter((r) => (r.pnl ?? 0) > 0).length;
      const pnlSum = sub.reduce((a, r) => a + (r.pnl ?? 0), 0);
      out.push({
        action,
        confidenceBucket: `${lo}-${hi}`,
        n: sub.length,
        winRate: Math.round(wins / sub.length * 100),
        avgPnl: Math.round(pnlSum / sub.length * 100) / 100,
        sampleEnough: sub.length >= minN,
      });
    }
  }
  return out.sort((a, b) => b.n - a.n);
}

module.exports = { strategyStats };
