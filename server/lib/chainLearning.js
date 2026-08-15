// ============================================================
// server/lib/chainLearning.js —— 变量命中率学习（任务 12，v9.148.0）
// 闭环：简报判断（stage/keySignals）→ 事后对照（链内标的 T+5 真实涨跌，本地 K 线）
//      → 命中统计落 kv（chain_hit:chainId:date）→ 下一期简报 prompt 引用
// 触发：cron 每日 16:05 回填（简报生成 ≥5 天前的链）
// ============================================================
const { getChainStocks, CHAINS } = require("./chainStocks");
const { pool } = require("../db");

/** 链内标的 T+N 平均涨跌（本地 kline_daily；信号日收盘 → 5 个交易日后收盘） */
async function chainStockAvgPct(db, chainId, fromDate, days = 5) {
  const stocks = await getChainStocks(chainId, { limit: 200 }, { _pool: db });
  if (stocks.length === 0) return null;
  const codes = stocks.slice(0, 80).map((s) => s.code);
  const r = await db.query(
    `WITH ranked AS (
       SELECT code, date, close,
              ROW_NUMBER() OVER (PARTITION BY code ORDER BY date DESC) rn
       FROM kline_daily WHERE code = ANY($1) AND date >= $2
     )
     SELECT code,
            MAX(CASE WHEN rn = 1 THEN close END) last_close,
            MAX(CASE WHEN rn = $3 THEN close END) base_close
     FROM ranked GROUP BY code`,
    [codes, fromDate, days + 1],
  );
  const rows = r.rows.filter((x) => x.last_close != null && x.base_close != null && x.base_close > 0);
  if (rows.length === 0) return null;
  const pcts = rows.map((x) => ((Number(x.last_close) - Number(x.base_close)) / Number(x.base_close)) * 100);
  const avg = pcts.reduce((a, b) => a + b, 0) / pcts.length;
  return { avgPct: Number(avg.toFixed(2)), sampleCount: rows.length, codes: rows.length };
}

/** 回填一条链的命中统计（读 5+ 天前简报 → 对照 T+5） */
async function recordChainHit(db, chainId) {
  const r = await db.query(
    `SELECT briefing_date, content FROM chain_briefing
     WHERE chain_id=$1 AND briefing_date < CURRENT_DATE - 3
     ORDER BY briefing_date DESC LIMIT 1`,
    [chainId],
  );
  if (!r.rows[0]) return null;
  const { briefing_date: date, content } = r.rows[0];
  const c = content ?? {};
  const stage = c.stage ?? "";
  // 对照窗口：简报日后第 4 个自然日~第 8 个自然日（用日期范围近似 T+5 交易日）
  const fromDate = date;
  const stat = await chainStockAvgPct(db, chainId, fromDate, 5);
  if (!stat) return null;
  const key = `chain_hit:${chainId}:${date}`;
  await db.query(
    `INSERT INTO kv_store(key, value, updated_at) VALUES($1,$2,now())
     ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
    [key, JSON.stringify({ chainId, date, stage, ...stat, recordedAt: new Date().toISOString() })],
  );
  return { chainId, date, stage, ...stat };
}

/** 全链回填（cron 每日调用） */
async function recordAllChainHits(db = pool) {
  const results = [];
  for (const chainId of Object.keys(CHAINS)) {
    try {
      const r = await recordChainHit(db, chainId);
      if (r) results.push(r);
    } catch (e) {
      results.push({ chainId, error: e.message });
    }
  }
  return results;
}

/** 某链历史命中统计（简报 prompt 引用：最近 5 期） */
async function getChainHitHistory(db, chainId, { limit = 5 } = {}) {
  const r = await db.query(
    `SELECT key, value FROM kv_store WHERE key LIKE $1 ORDER BY key DESC LIMIT $2`,
    [`chain_hit:${chainId}:%`, limit],
  );
  return r.rows.map((x) => {
    const v = typeof x.value === "string" ? JSON.parse(x.value) : x.value;
    return { date: x.key.split(":").pop(), stage: v.stage, avgPct: v.avgPct, sampleCount: v.sampleCount };
  });
}

module.exports = { chainStockAvgPct, recordChainHit, recordAllChainHits, getChainHitHistory };
