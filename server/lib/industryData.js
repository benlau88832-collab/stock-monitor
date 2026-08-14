// ============================================================
// v9.145.0（P2-4）：产业数据信号整备
// 当前阶段优先消费本地 SQL：news/policy_docs/fund_streak/commodity_price。
// 外部协会/统计口径源通过 industry_signal_adapters 扩展，避免强依赖不可用接口。
// ============================================================

async function syncLocalIndustrySignals(pool) {
  const out = { news: 0, policy: 0, fund: 0, price: 0 };
  const nodeR = await pool.query(
    `SELECT n.id, n.chain_id, n.name, c.name AS chain_name
     FROM industry_chain_node n JOIN industry_chain c ON c.id=n.chain_id`,
  );
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

  for (const node of nodeR.rows) {
    const keys = [node.chain_id, node.chain_name, node.name, ...String(node.name).split(/[：/:]/).slice(1)];

    // news 信号：标题/摘要命中链节点关键词
    try {
      const newsR = await pool.query(
        `SELECT title,summary,url,time FROM news
         WHERE (title ILIKE ANY($1) OR summary ILIKE ANY($1))
           AND time >= $2 ORDER BY time DESC LIMIT 5`,
        [keys.map((k) => `%${k}%`), new Date(Date.now() + 8 * 3600 * 1000 - 30 * 86400000).toISOString().slice(0, 10)],
      );
      for (const n of newsR.rows) {
        const date = String(n.time || "").slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
        await pool.query(`DELETE FROM industry_chain_signal WHERE node_id=$1 AND signal_type='news' AND effective_date=$2 AND source_url=$3`, [node.id, date, n.url || `news:${n.title}`]);
        await pool.query(
          `INSERT INTO industry_chain_signal(node_id,signal_type,value,unit,direction,effective_date,source_url)
           VALUES($1,'news',NULL,NULL,'flat',$2,$3)`,
          [node.id, date, n.url || `news:${n.title}`],
        );
        out.news++;
      }
    } catch { /* 单节点新闻信号失败不阻塞 */ }

    // policy 信号
    try {
      const policyR = await pool.query(
        `SELECT title,doc_date,category,content,source_url FROM policy_docs
         WHERE title ILIKE ANY($1) OR content ILIKE ANY($1) ORDER BY doc_date DESC LIMIT 5`,
        [keys.map((k) => `%${k}%`)],
      );
      for (const p of policyR.rows) {
        const date = String(p.doc_date || "").slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
        await pool.query(`DELETE FROM industry_chain_signal WHERE node_id=$1 AND signal_type='policy' AND effective_date=$2 AND source_url=$3`, [node.id, date, p.source_url || `policy:${p.title}`]);
        await pool.query(
          `INSERT INTO industry_chain_signal(node_id,signal_type,value,unit,direction,effective_date,source_url)
           VALUES($1,'policy',NULL,NULL,'flat',$2,$3)`,
          [node.id, date, p.source_url || `policy:${p.title}`],
        );
        out.policy++;
      }
    } catch { /* 单节点政策信号失败不阻塞 */ }

    // 资金信号：fund_streak 板块名称匹配
    try {
      const fundR = await pool.query(`SELECT value FROM kv_store WHERE key LIKE 'fund_streak:%' ORDER BY key DESC LIMIT 5`);
      for (const row of fundR.rows) {
        const data = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
        for (const item of (data?.items || [])) {
          const name = String(item?.name ?? item?.board ?? "");
          if (!name || !keys.some((k) => k && (name.includes(k) || k.includes(name)))) continue;
          const date = String(data?.date || today).slice(0, 10);
          await pool.query(`DELETE FROM industry_chain_signal WHERE node_id=$1 AND signal_type='fund' AND effective_date=$2 AND source_url=$3`, [node.id, date, `fund_streak:${name}`]);
          await pool.query(
            `INSERT INTO industry_chain_signal(node_id,signal_type,value,unit,direction,effective_date,source_url)
             VALUES($1,'fund',$2,'亿',NULL,$3,$4)`,
            [node.id, Number(item.mainNet) || null, date, `fund_streak:${name}`],
          );
          out.fund++;
        }
      }
    } catch { /* 单节点资金信号失败不阻塞 */ }
  }
  return out;
}

async function getChainSignals(pool, chainId, days = 90) {
  try {
    const r = await pool.query(
      `SELECT s.id,s.node_id,n.name AS node_name,n.chain_id,s.signal_type,s.value,s.unit,s.direction,s.effective_date,s.source_url
       FROM industry_chain_signal s JOIN industry_chain_node n ON n.id=s.node_id
       WHERE n.chain_id=$1 AND s.effective_date >= CURRENT_DATE - ($2::int)
       ORDER BY s.effective_date DESC, s.signal_type LIMIT 500`,
      [chainId, days],
    );
    return r.rows.map((x) => ({
      ...x,
      effectiveDate: x.effective_date instanceof Date ? x.effective_date.toISOString().slice(0, 10) : String(x.effective_date || "").slice(0, 10),
    }));
  } catch { return []; }
}

module.exports = { syncLocalIndustrySignals, getChainSignals };
