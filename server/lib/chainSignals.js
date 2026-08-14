// ============================================================
// v9.143.0 chain signal sync: commodity_price kv -> industry_chain_signal
// v9.145.0（第二轮 P1-4）：新信号写入后触发产业链传导推理
// ============================================================
const { runChainReasoning } = require("./chainReasoning");

let lastSync = 0;

async function syncCommoditySignals(pool, force = false) {
  if (!force && Date.now() - lastSync < 30 * 60 * 1000) return;
  lastSync = Date.now();
  try {
    const kvR = await pool.query(`SELECT value FROM kv_store WHERE key LIKE 'commodity_price:%' ORDER BY key DESC LIMIT 1`);
    const raw = kvR.rows?.[0]?.value;
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    const items = Array.isArray(v?.items) ? v.items : [];
    if (items.length === 0) return;

    const nodesR = await pool.query(
      `SELECT n.id,n.name,c.id AS chain_id,c.name AS chain_name
       FROM industry_chain_node n JOIN industry_chain c ON c.id=n.chain_id`,
    );
    const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    const changedChains = new Set();

    for (const node of nodesR.rows) {
      const keys = [node.chain_id, node.chain_name, node.name];
      const hit = items.find((x) => keys.some((k) => k && (String(x.name).includes(k) || k.includes(String(x.name)))));
      if (!hit) continue;
      await pool.query(`DELETE FROM industry_chain_signal WHERE node_id=$1 AND signal_type='price' AND effective_date=$2`, [node.id, today]);
      await pool.query(
        `INSERT INTO industry_chain_signal(node_id,signal_type,value,unit,direction,effective_date,source_url)
         VALUES($1,'price',$2,$3,$4,$5,'https://www.baiinfo.com/')`,
        [node.id, Number(hit.price) || null, hit.unit || null, hit.dir || "flat", today],
      );
      changedChains.add(node.chain_id);
    }

    for (const chainId of [...changedChains].slice(0, 3)) {
      try { await runChainReasoning(pool, chainId); } catch { /* 推理失败不阻塞同步 */ }
    }
  } catch { /* 信号同步失败不阻塞链路 */ }
}

module.exports = { syncCommoditySignals };
