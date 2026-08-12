// ============================================================
// server/lib/behaviorCoach.js —— 行为偏差检测（v9.125.0，蓝图 L6 纪律层前置）
// 蓝图定位：把"铁血纪律"做成可执行规则，对抗追涨杀跌/处置效应——散户亏损是"行为病"不是"消息病"
//   （上交所大数据：300万以下账户系统性追涨杀跌；散户亏损约 2/3 来自交易税费与佣金 [源:刘玉珍/北大光华]）。
// 纯函数 0 token：输入 trade_ledger 成交行 → 输出行为偏差信号 + 纪律提醒文案（引用行为金融原理）。
// 纪律：N<3 不判定（防误报）；输出带 sampleSize + caliber；不承诺收益。
// 前端消费：/api/coach（个股雷达「纪律教练」区，批次 B UI 接入）。
// ============================================================

/**
 * 行为偏差检测（纯函数）
 * @param {Array} trades trade_ledger 行（date/ts/code/name/action/price/quantity/cost/pnl_pct）
 * @param {object} opts { days=30, maxTradesPerDay=3, stopLossPct=5 }
 * @returns {Array<{type,severity,evidence,advice,principle}>}
 */
function detectBehaviorBias(trades, opts = {}) {
  const days = opts.days ?? 30;
  const maxTradesPerDay = opts.maxTradesPerDay ?? 3;
  const stopLossPct = opts.stopLossPct ?? 5;
  const rows = (Array.isArray(trades) ? trades : []).filter(
    (t) => t && (t.action === "buy" || t.action === "sell" || t.action === "stop"),
  );
  const out = [];
  if (rows.length < 3) return out; // 样本不足不判定（防误报）

  // ① 频繁交易：近 days 窗口成交笔数日均 > 阈值
  const tsOf = (t) => { const d = new Date(t.ts ?? t.date).getTime(); return Number.isFinite(d) ? d : 0; };
  const cutoff = Date.now() - days * 86400000;
  const recent = rows.filter((t) => tsOf(t) === 0 || tsOf(t) >= cutoff);
  if (recent.length / days > maxTradesPerDay) {
    out.push({
      type: "频繁交易", severity: "warn",
      evidence: `近${days}日成交 ${recent.length} 笔（日均 ${(recent.length / days).toFixed(1)} 笔 > ${maxTradesPerDay} 笔）`,
      advice: `交易频次过高：散户亏损约 2/3 来自税费与佣金——减少无效交易本身就是收益，目标日均 ≤${maxTradesPerDay} 笔`,
      principle: "频繁交易是散户亏损最大单一来源（刘玉珍/北大光华）",
    });
  }

  // ② 不止损：已平仓单中亏损超阈值占比 >40%
  const closed = rows.filter((t) => t.action === "sell" || t.action === "stop");
  const losers = closed.filter((t) => typeof t.pnl_pct === "number" && t.pnl_pct < -stopLossPct);
  if (closed.length >= 3 && losers.length / closed.length > 0.4) {
    out.push({
      type: "不止损", severity: "alert",
      evidence: `已平仓 ${closed.length} 笔中 ${losers.length} 笔亏损超 ${stopLossPct}%（占比 ${Math.round(losers.length / closed.length * 100)}%）`,
      advice: `铁律：单笔止损 ${stopLossPct}%。亏损单拖成深套是处置效应——小亏拖成大亏，破位不犹豫`,
      principle: "处置效应：赚 3-5% 就跑、亏了死扛（行为金融）",
    });
  }

  // ③ 追高：买入价高于持仓成本（越涨越买）
  const highChase = rows.filter((t) => t.action === "buy" && typeof t.cost === "number" && t.cost > 0 && t.price > t.cost);
  if (highChase.length >= 2) {
    out.push({
      type: "追高", severity: "warn",
      evidence: `${highChase.length} 笔买入价高于持仓成本（越涨越买）`,
      advice: "高位加仓放大回撤：买在分歧、卖在一致，而非追涨——等回踩确认再补",
      principle: "追涨杀跌是散户成为流动性付费使用者的根本（上交所大数据）",
    });
  }

  // ④ 处置效应：盈利单平均持有天数 << 亏损单平均持有天数（>2 倍）
  const holdOf = (t) => { const d = tsOf(t); return d > 0 ? (Date.now() - d) / 86400000 : null; };
  const winDays = closed.filter((t) => (t.pnl_pct ?? 0) > 0).map(holdOf).filter((v) => v != null);
  const loseDays = closed.filter((t) => (t.pnl_pct ?? 0) <= 0).map(holdOf).filter((v) => v != null);
  if (winDays.length >= 2 && loseDays.length >= 2) {
    const wAvg = winDays.reduce((a, b) => a + b, 0) / winDays.length;
    const lAvg = loseDays.reduce((a, b) => a + b, 0) / loseDays.length;
    if (wAvg > 0 && lAvg / Math.max(wAvg, 0.1) > 2) {
      out.push({
        type: "处置效应", severity: "warn",
        evidence: `盈利单平均持有 ${wAvg.toFixed(1)} 天 vs 亏损单 ${lAvg.toFixed(1)} 天（拿不住利润、抱得住亏损）`,
        advice: "让利润奔跑、截断亏损：盈利单给足时间，亏损单严格止损",
        principle: "处置效应（行为金融）",
      });
    }
  }

  return out;
}

module.exports = { detectBehaviorBias };
