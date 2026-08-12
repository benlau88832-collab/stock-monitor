// ============================================================
// server/routes/backtest.js —— 情绪周期回测 API（v9.126.0，蓝图 L4 批次 C）
// GET /api/backtest/stage?days=60 → market_daily 逐日重建阶段（与认知层同一判定函数）→
//   分阶段统计 次日溢价/晋级率/胜率（赚钱效应）→ 阈值校准参考（对照蓝图表）。
// 纯读库 0 token；N<5 阶段标注 sampleEnough=false；不承诺胜率。
// ============================================================
const { pool } = require("../db");
const { stageFromDaily, stageBacktest } = require("../lib/stageBacktest");

/** kv_store 读值（兼容 JSONB 对象 / {__raw} 字符串两种形态，与 brainContext.kvRead 同口径） */
function kvParse(v) {
  if (v == null) return null;
  if (typeof v === "string") { try { return JSON.parse(v); } catch { return null; } }
  if (typeof v === "object" && "__raw" in v) { try { return JSON.parse(v.__raw); } catch { return null; } }
  return v;
}

module.exports = function backtestRoutes(app) {
  app.get("/api/backtest/stage", async (req, res) => {
    try {
      const days = Math.min(Math.max(Number(req.query.days) || 60, 10), 250);
      const r = await pool.query(
        `SELECT key,value FROM kv_store WHERE key LIKE 'market_daily:%' ORDER BY key DESC LIMIT $1`, [days],
      ).catch(() => ({ rows: [] }));
      const byDate = new Map();
      for (const row of r.rows) {
        const v = kvParse(row.value);
        const date = String(row.key).replace("market_daily:", "");
        if (v && /^\d{4}-\d{2}-\d{2}$/.test(date)) byDate.set(date, { date, ...v });
      }
      // 情绪分不在 market_daily（存于 sentiment_snapshot:日期 / sentiment:日期）→ 逐日合并
      const sR = await pool.query(
        `SELECT key,value FROM kv_store WHERE key LIKE 'sentiment_snapshot:%' OR key LIKE 'sentiment:%' ORDER BY key DESC LIMIT $1`, [days * 2],
      ).catch(() => ({ rows: [] }));
      const sentByDate = new Map();
      for (const row of sR.rows) {
        const v = kvParse(row.value);
        const date = String(row.key).replace(/^sentiment_snapshot:/, "").replace(/^sentiment:/, "");
        const s = typeof v === "object" && v != null ? Number(v.sentiment ?? v.score ?? NaN) : Number(v);
        if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(s) && !sentByDate.has(date)) sentByDate.set(date, s);
      }
      const dates = [...byDate.keys()].sort(); // 升序 → 次日配对
      const rows = [];
      for (let i = 0; i < dates.length; i++) {
        const daily = { ...byDate.get(dates[i]), sentiment: sentByDate.get(dates[i]) ?? null };
        const next = byDate.get(dates[i + 1]) ?? null;
        rows.push(stageFromDaily(daily, next));
      }
      const perStage = stageBacktest(rows);
      res.json({
        perStage,
        sampleSize: dates.length,
        thresholdRef: {
          蓝图参考: "试错/启动 涨停<30·炸板偏高·1-2板 | 主升/发酵 涨停>80·炸板<10%·>5板 | 震荡 30-80·炸板10-25%·3-5板 | 退潮 <30·炸板>25%·<3板",
          当前判定: "deriveSentimentStage(温度计分30/45/65/82 阈值 + premium<0 压制 + 炸板率0.15 分歧)",
          校准原则: "按 perStage 次日溢价/胜率分布微调阈值；N<5 的阶段不作为校准依据",
        },
        caliber: "回测口径=生产口径（同一 deriveSentimentStage）；赚钱效应=次日溢价(premiumAvg T+1)>0 占比；样本=market_daily 历史行；不承诺胜率；日期带横杠",
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
};
