// ============================================================
// v9.145.0（P2-1）：基本面历史趋势 + 同行对比，数据来自本地 SQL
// ============================================================

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtDate(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return v.toISOString().slice(0, 10);
  }
  return String(v || "").slice(0, 10);
}

function percentile(value, values) {
  if (value == null || values.length === 0) return null;
  const below = values.filter((v) => v != null && v < value).length;
  return Math.round((below / values.length) * 100);
}

async function persistFundamentalHistory(pool, code, f) {
  if (!f || !Array.isArray(f.finRows)) return;
  const name = f.name || code;
  for (const row of f.finRows) {
    const reportDate = String(row.REPORT_DATE || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) continue;
    try {
      await pool.query(
        `INSERT INTO fundamental_history(code,name,report_date,roe,debt,gross,rev_yoy,profit_yoy,eps,cash_ps,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
         ON CONFLICT(code,report_date) DO UPDATE SET
           name=EXCLUDED.name,roe=EXCLUDED.roe,debt=EXCLUDED.debt,gross=EXCLUDED.gross,
           rev_yoy=EXCLUDED.rev_yoy,profit_yoy=EXCLUDED.profit_yoy,eps=EXCLUDED.eps,
           cash_ps=EXCLUDED.cash_ps,updated_at=now()`,
        [code, name, reportDate, num(row.ROEJQ), num(row.ZCFZL), num(row.XSMLL), num(row.TOTALOPERATEREVETZ), num(row.PARENTNETPROFITTZ), num(row.EPSJB), num(row.MGJYXJJE)],
      );
    } catch { /* 单期写入失败不阻塞 */ }
  }
}

async function getFundamentalTrend(pool, code) {
  try {
    const r = await pool.query(
      `SELECT code,name,report_date,roe,debt,gross,rev_yoy,profit_yoy,eps,cash_ps
       FROM fundamental_history WHERE code=$1 ORDER BY report_date DESC LIMIT 8`,
      [code],
    );
    return r.rows.map((x) => ({
      code: x.code,
      name: x.name,
      reportDate: fmtDate(x.report_date),
      roe: num(x.roe),
      debt: num(x.debt),
      gross: num(x.gross),
      revYoy: num(x.rev_yoy),
      profitYoy: num(x.profit_yoy),
      eps: num(x.eps),
      cashPs: num(x.cash_ps),
    }));
  } catch { return []; }
}

// 从已有 stock_fundamentals 快照回填 history，避免本地已有数据被忽略
async function seedFundamentalHistory(pool) {
  try {
    const r = await pool.query(`SELECT code,name,data FROM stock_fundamentals`);
    let inserted = 0;
    for (const row of r.rows) {
      const metrics = row.data?.metrics;
      const reportDate = String(metrics?.reportDate || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) continue;
      try {
        const ins = await pool.query(
          `INSERT INTO fundamental_history(code,name,report_date,roe,debt,gross,rev_yoy,profit_yoy,eps,cash_ps,updated_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
           ON CONFLICT(code,report_date) DO NOTHING RETURNING id`,
          [row.code, row.name || row.code, reportDate, num(metrics?.roe), num(metrics?.debt), num(metrics?.gross), num(metrics?.revTz), num(metrics?.profitTz), num(metrics?.eps), num(metrics?.cashPs)],
        );
        inserted += ins.rowCount || 0;
      } catch { /* 单条冲突跳过 */ }
    }
    return { inserted };
  } catch { return { inserted: 0 }; }
}

async function getPeerComparison(pool, code) {
  const out = { code, peerCount: 0, peers: [], metrics: { pePercentile: null, roePercentile: null, revYoyPercentile: null }, caliber: "本地 stock_fundamentals + stock_concepts + industry_chain_node_stock；样本不足时显示未采集" };
  try {
    const ownR = await pool.query(`SELECT concepts,all_boards,hybk,core_concept FROM stock_concepts WHERE code=$1`, [code]);
    const own = ownR.rows[0];
    if (!own) return out;

    const ownKeys = new Set();
    for (const v of [own.core_concept, own.hybk, ...(own.concepts || []), ...(own.all_boards || [])]) {
      if (v) ownKeys.add(String(v));
    }
    const peersR = await pool.query(`SELECT code,concepts,all_boards,hybk,core_concept FROM stock_concepts WHERE code<>$1`, [code]);
    const peers = peersR.rows.filter((row) => {
      const rowBoards = [row.core_concept, row.hybk, ...(row.concepts || []), ...(row.all_boards || [])];
      return rowBoards.some((v) => v && ownKeys.has(String(v)));
    });

    // 若概念匹配不到，再按产业链节点映射匹配
    if (peers.length === 0) {
      const mapR = await pool.query(
        `SELECT stock_code FROM industry_chain_node_stock WHERE node_id IN (
           SELECT node_id FROM industry_chain_node_stock WHERE stock_code=$1
         ) AND stock_code<>$1`,
        [code],
      );
      const mappedCodes = new Set(mapR.rows.map((r) => r.stock_code));
      if (mappedCodes.size > 0) {
        for (const row of peersR.rows) if (mappedCodes.has(row.code)) peers.push(row);
      }
    }

    const ownData = await pool.query(`SELECT data FROM stock_fundamentals WHERE code=$1`, [code]);
    const ownMetrics = ownData.rows[0]?.data?.metrics || {};
    const peerCodes = peers.map((row) => row.code);
    const peersMetrics = [];
    if (peerCodes.length > 0) {
      const fundR = await pool.query(
        `SELECT code,data FROM stock_fundamentals WHERE code = ANY($1)`,
        [peerCodes],
      );
      const fundedCodes = new Set();
      const metricsRows = [];
      for (const row of fundR.rows) {
        fundedCodes.add(row.code);
        metricsRows.push(row.data?.metrics || {});
      }
      peersMetrics.push(...metricsRows);
      out.peerCount = metricsRows.length;
      out.peers = peers.filter((row) => fundedCodes.has(row.code)).map((row) => ({ code: row.code, name: row.name }));
    }
    if (out.peerCount >= 3) {
      out.metrics.pePercentile = percentile(num(ownMetrics.peTtm), peersMetrics.map((m) => num(m.peTtm)));
      out.metrics.roePercentile = percentile(num(ownMetrics.roe), peersMetrics.map((m) => num(m.roe)));
      out.metrics.revYoyPercentile = percentile(num(ownMetrics.revTz), peersMetrics.map((m) => num(m.revTz)));
    }
  } catch { /* 本地数据不足时保持空 */ }
  return out;
}

module.exports = { persistFundamentalHistory, getFundamentalTrend, getPeerComparison, seedFundamentalHistory };
