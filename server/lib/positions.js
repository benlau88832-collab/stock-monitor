// ============================================================
// server/lib/positions.js —— 持仓净额汇总（v9.127.0，蓝图 L6 持仓体检前置）
// trade_ledger 成交行 → 持仓清单（净数量/均价/最后动作时间）+ 集中度。
// 纯函数 0 token；现价不在本层（实时行情属降级链职责，体检面板另行注入），
//   未平仓盈亏标注 null（诚实缺数据）。
// ============================================================

/**
 * 持仓净额汇总（纯函数）
 * @param {Array} trades trade_ledger 行（code/name/action/price/quantity/ts/date/pnl_pct）
 * @returns {Array<{code,name,netQty,avgCost,lastAction,lastTime,closedPnl,open}>}
 */
function netPositions(trades) {
  const map = new Map();
  for (const t of Array.isArray(trades) ? trades : []) {
    if (!t || !t.code) continue;
    const key = String(t.code);
    const p = map.get(key) ?? {
      code: key, name: String(t.name ?? ""), netQty: 0, costSum: 0, buyQty: 0,
      lastAction: "", lastTime: "", closedPnl: 0,
    };
    const qty = Number(t.quantity) || 0;
    const price = Number(t.price) || 0;
    if (t.action === "buy") {
      p.costSum += price * qty;
      p.buyQty += qty;
      p.netQty += qty;
    } else if (t.action === "sell" || t.action === "stop" || t.action === "adjust") {
      p.netQty -= qty;
      if (typeof t.pnl_pct === "number") p.closedPnl += t.pnl_pct;
    }
    const ts = String(t.ts ?? t.date ?? "");
    if (ts >= p.lastTime) { p.lastTime = ts; p.lastAction = String(t.action); }
    map.set(key, p);
  }
  const rows = [...map.values()].map((p) => ({
    code: p.code,
    name: p.name,
    netQty: p.netQty,
    avgCost: p.buyQty > 0 ? Math.round(p.costSum / p.buyQty * 100) / 100 : null,
    lastAction: p.lastAction,
    lastTime: p.lastTime,
    closedPnlPct: Math.round(p.closedPnl * 100) / 100,
    open: p.netQty > 0,
  }));
  return rows;
}

/**
 * 持仓集中度（纯函数）：单票占比 = 该票市值估算占总持仓的比例（无现价 → 用成本占比近似，caliber 注明）
 */
function concentration(positions) {
  const open = (Array.isArray(positions) ? positions : []).filter((p) => p.open);
  const totalCost = open.reduce((a, p) => a + (p.avgCost ?? 0) * Math.max(0, p.netQty), 0);
  if (totalCost <= 0 || open.length === 0) return { openCount: open.length, topShare: null, note: "无持仓或成本缺失" };
  const shares = open.map((p) => ({ code: p.code, share: (p.avgCost ?? 0) * p.netQty / totalCost }));
  shares.sort((a, b) => b.share - a.share);
  return { openCount: open.length, topShare: Math.round(shares[0].share * 1000) / 10, top: shares.slice(0, 3), note: "成本占比近似（无现价），口径注明" };
}

module.exports = { netPositions, concentration };
