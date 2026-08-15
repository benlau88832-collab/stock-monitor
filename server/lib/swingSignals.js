// ============================================================
// server/lib/swingSignals.js —— 波段信号闭环（v9.147.0 阶段二B）
// 链路：swing 决策 stage.buyPoint（放量首板/首板次日低吸/平台突破/主升回踩）
//   → 信号落库 swing_signals（幂等 code+type+date）
//   → cron 每日用本地 kline_daily 回填 T+20/T+60 收盘涨跌幅
//   → 胜率归因端点 /api/swing/signals（按信号类型统计，样本≥10 才下结论）
// 数据源：本地 K 线（阶段一基建），无外部依赖
// ============================================================

/** 记录波段买点信号（幂等：同 code+type+date 已存在则跳过） */
async function recordSwingSignal(pool, { code, name, signalType, signalDate, price }) {
  if (!code || !signalType || !signalDate) return { recorded: false, reason: "missing" };
  try {
    const r = await pool.query(
      `INSERT INTO swing_signals(code, name, signal_type, signal_date, price)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT (code, signal_type, signal_date) DO NOTHING RETURNING id`,
      [String(code), name ? String(name).slice(0, 30) : null, String(signalType), String(signalDate), price != null ? Number(price) : null],
    );
    return r.rows[0] ? { recorded: true, id: r.rows[0].id } : { recorded: false, reason: "exists" };
  } catch (e) {
    return { recorded: false, reason: String(e?.message || "db_error") };
  }
}

/** 回填 T+20/T+60：对 open 信号用本地 K 线算 signal_date 之后第 20/60 个交易日的收盘涨跌幅 */
async function backfillSignalPnl(pool) {
  const r = await pool.query(
    `SELECT id, code, signal_date, price FROM swing_signals
     WHERE status='open' ORDER BY signal_date LIMIT 500`,
  );
  let backfilled = 0;
  for (const s of r.rows) {
    try {
      const kr = await pool.query(
        `SELECT date, close FROM kline_daily WHERE code=$1 AND date >= $2 ORDER BY date LIMIT 120`,
        [s.code, s.signal_date],
      );
      const rows = kr.rows;
      if (rows.length < 2) continue; // 无后续K线（可能刚触发）
      const idx = rows.findIndex((x) => x.date === s.signal_date);
      if (idx < 0) continue;
      const base = Number(s.price) > 0 ? Number(s.price) : Number(rows[idx].close);
      if (!(base > 0)) continue;
      const at = (offset) => {
        const row = rows[idx + offset];
        return row ? Number(row.close) : null;
      };
      const c20 = at(20);
      const c60 = at(60);
      const pnl = (c) => c != null ? Math.round((c / base - 1) * 10000) / 100 : null;
      const pnlT20 = pnl(c20);
      const pnlT60 = pnl(c60);
      const status = pnlT60 != null ? "t60_done" : pnlT20 != null ? "t20_done" : "open";
      await pool.query(
        `UPDATE swing_signals SET close_t20=$2, close_t60=$3, pnl_t20=$4, pnl_t60=$5, status=$6 WHERE id=$1`,
        [s.id, c20, c60, pnlT20, pnlT60, status],
      );
      backfilled++;
    } catch { /* 单条失败继续 */ }
  }
  return { total: r.rows.length, backfilled };
}

/** 胜率归因：按信号类型统计 T+20/T+60 正收益占比（样本≥10 才下结论） */
async function getSignalStats(pool) {
  const r = await pool.query(
    `SELECT signal_type, count(*)::int AS n,
            count(pnl_t20)::int AS n_t20,
            count(*) FILTER (WHERE pnl_t20 IS NOT NULL AND pnl_t20 > 0)::int AS win_t20,
            round(avg(pnl_t20)::numeric, 2) AS avg_t20,
            count(pnl_t60)::int AS n_t60,
            count(*) FILTER (WHERE pnl_t60 IS NOT NULL AND pnl_t60 > 0)::int AS win_t60,
            round(avg(pnl_t60)::numeric, 2) AS avg_t60
     FROM swing_signals
     GROUP BY signal_type ORDER BY signal_type`,
  );
  return r.rows.map((x) => ({
    signalType: x.signal_type,
    n: x.n,
    t20: {
      n: x.n_t20,
      winRate: x.n_t20 >= 10 ? Math.round(x.win_t20 / x.n_t20 * 100) : null,
      win: x.win_t20,
      avg: x.avg_t20,
    },
    t60: {
      n: x.n_t60,
      winRate: x.n_t60 >= 10 ? Math.round(x.win_t60 / x.n_t60 * 100) : null,
      win: x.win_t60,
      avg: x.avg_t60,
    },
  }));
}

/** 最近信号列表（前端展示） */
async function listRecentSignals(pool, limit = 50) {
  const r = await pool.query(
    `SELECT id, code, name, signal_type, signal_date, price, pnl_t20, pnl_t60, status, created_at
     FROM swing_signals ORDER BY signal_date DESC, id DESC LIMIT $1`,
    [Math.max(1, Math.min(200, Number(limit) || 50))],
  );
  return r.rows;
}

module.exports = { recordSwingSignal, backfillSignalPnl, getSignalStats, listRecentSignals };
