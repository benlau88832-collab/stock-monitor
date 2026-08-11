// ============================================================
// server/lib/mainlineBacktest.js —— 主线级回测（T-B4，v9.106.0）
// 数据源：zt_snapshot 多日（date + data.pool 的 hybk 板块聚合）
// 方法：对每个板块算"每日涨停家数序列"→ 次日/3日变化（延续/退潮）→ 聚合
//   { board, samples, nextDayAvg(次日涨停家数变化均值), nextDayWinRate(次日延续胜率),
//     day3Avg, day3WinRate } —— 与 T-D3 事件研究同构（简化版，不做 AR/CAR）
// 输出"同主线历史胜率表"（升级报告 T-B4 验证点）
// ============================================================

/**
 * 主线回测聚合（纯函数）
 * @param ztRows [{date, boards: [{hybk, count}]}] 多日涨停快照（按日期升序）
 * @returns 按 samples 降序的板块回测结果
 */
function runMainlineBacktest(ztRows) {
  // 板块 → 每日涨停数序列（date → count）
  const series = new Map(); // board -> Array<{date, count}>
  for (const row of ztRows) {
    const date = String(row.date).slice(0, 10);
    const counts = new Map();
    for (const b of (row.boards ?? [])) {
      const name = String(b.hybk || b.board || "未分类");
      counts.set(name, (counts.get(name) ?? 0) + Number(b.count ?? 1));
    }
    for (const [board, count] of counts) {
      if (!series.has(board)) series.set(board, []);
      series.get(board).push({ date, count });
    }
  }
  const out = [];
  for (const [board, arr] of series) {
    if (arr.length < 3) continue; // 至少 3 日才有次日对比
    arr.sort((a, b) => a.date.localeCompare(b.date));
    const nextDeltas = [];
    const day3Deltas = [];
    for (let i = 0; i < arr.length - 1; i++) {
      nextDeltas.push(arr[i + 1].count - arr[i].count);
    }
    for (let i = 0; i < arr.length - 3; i++) {
      day3Deltas.push(arr[i + 3].count - arr[i].count);
    }
    const avg = (d) => (d.length > 0 ? Math.round(d.reduce((s, v) => s + v, 0) / d.length * 10) / 10 : null);
    const win = (d) => (d.length > 0 ? Math.round(d.filter(v => v > 0).length / d.length * 1000) / 10 : null);
    out.push({
      board,
      samples: nextDeltas.length,
      nextDayAvg: avg(nextDeltas),
      nextDayWinRate: win(nextDeltas),
      day3Avg: avg(day3Deltas),
      day3WinRate: win(day3Deltas),
    });
  }
  return out.sort((a, b) => b.samples - a.samples).slice(0, 20);
}

module.exports = { runMainlineBacktest };
