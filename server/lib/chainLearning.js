// ============================================================
// server/lib/chainLearning.js —— 变量命中率学习（任务 12，v9.148.0 / T4 重构 v9.148.1）
// 闭环：简报判断（stage/keySignals）→ 事后对照（链内标的 T+5 真实涨跌，本地 K 线）
//      → 命中统计落 kv（chain_hit:chainId:date）→ 下一期简报 prompt 引用
// 触发：cron 每日 16:05 回填（简报日之后已存在 ≥6 个交易日才回填）
// v9.148.1（T4 P1-2）：交易日历锚定重构 —— 原 ROW_NUMBER DESC 量的是"最近 5 日"而非
//   "简报日后 T+5"；现改为：取简报日后全市场共同交易日历，base=第 1 个交易日收盘，
//   last=第 6 个交易日收盘；日历不足 6 天返回 null（跳过，不写 kv）。
// ============================================================
const { getChainStocks, CHAINS } = require("./chainStocks");
const { pool } = require("../db");

/** 交易日历表（v9.148.2 A5 P1-1：替代 DISTINCT date 全表扫 —— kline_daily 3.2GB 无 date 索引，实测 5.1s/次）
 * 建表 + 首次全量填充（一次性 INSERT SELECT DISTINCT ≈8770 行）；增量由 cron/klines.js 每日 upsert */
async function ensureTradingCalendar(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS trading_calendar (date TEXT PRIMARY KEY)`);
  const r = await db.query(`SELECT count(*)::int n FROM trading_calendar`);
  if (Number(r.rows[0]?.n || 0) === 0) {
    await db.query(`INSERT INTO trading_calendar(date) SELECT DISTINCT date FROM kline_daily`);
  }
}

/** 简报日后的交易日历（取前 N 个）；不足返回 null */
async function tradingCalendarAfter(db, fromDate, { need = 6 } = {}) {
  await ensureTradingCalendar(db);
  const r = await db.query(
    `SELECT date FROM trading_calendar WHERE date >= $1 ORDER BY date LIMIT $2`,
    [fromDate, need],
  );
  if (r.rows.length < need) return null;
  return r.rows.map((x) => x.date);
}

/** 链内标的 T+5 平均涨跌（交易日历锚定：简报日后第 1 与第 6 个交易日收盘差） */
async function chainStockAvgPct(db, chainId, fromDate, days = 5) {
  const cal = await tradingCalendarAfter(db, fromDate, { need: days + 1 });
  if (!cal) return null; // 日历不足，跳过（不写脏数据）
  const d0 = cal[0];
  const dN = cal[days];
  const stocks = await getChainStocks(chainId, { limit: 200 }, { _pool: db });
  if (stocks.length === 0) return null;
  const codes = stocks.slice(0, 80).map((s) => s.code);
  const r = await db.query(
    `SELECT code,
            MAX(CASE WHEN date = $2 THEN close END) base_close,
            MAX(CASE WHEN date = $3 THEN close END) last_close
     FROM kline_daily WHERE code = ANY($1) AND date IN ($2, $3) GROUP BY code`,
    [codes, d0, dN],
  );
  const rows = r.rows.filter((x) => x.last_close != null && x.base_close != null && x.base_close > 0);
  if (rows.length === 0) return null;
  const pcts = rows.map((x) => ((Number(x.last_close) - Number(x.base_close)) / Number(x.base_close)) * 100);
  const avg = pcts.reduce((a, b) => a + b, 0) / pcts.length;
  return { avgPct: Number(avg.toFixed(2)), sampleCount: rows.length, codes: rows.length };
}

/** 回填一条链的命中统计（简报日之后已存在 ≥6 个交易日才回填；幂等 ON CONFLICT） */
async function recordChainHit(db, chainId) {
  // 取"存在 ≥6 个交易日"的最新简报（自然日门槛删除，用交易日历判断）
  const r = await db.query(
    `SELECT briefing_date, content FROM chain_briefing
     WHERE chain_id=$1 ORDER BY briefing_date DESC LIMIT 10`,
    [chainId],
  );
  for (const row of r.rows) {
    const date = row.briefing_date;
    const cal = await tradingCalendarAfter(db, date, { need: 6 });
    if (!cal) continue; // 该期简报后交易日不足 6 天 → 看更早一期
    const c = row.content ?? {};
    const stage = c.stage ?? "";
    const stat = await chainStockAvgPct(db, chainId, date, 5);
    if (!stat) continue;
    const key = `chain_hit:${chainId}:${date}`;
    await db.query(
      `INSERT INTO kv_store(key, value, updated_at) VALUES($1,$2,now())
       ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
      [key, JSON.stringify({ chainId, date, stage, ...stat, recordedAt: new Date().toISOString() })],
    );
    return { chainId, date, stage, ...stat };
  }
  return null;
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

module.exports = { chainStockAvgPct, recordChainHit, recordAllChainHits, getChainHitHistory, tradingCalendarAfter, ensureTradingCalendar };
