// ============================================================
// server/routes/coach.js —— 纪律教练 API（v9.125.0，蓝图 L6 纪律层前置）
// GET /api/coach?days=30 → trade_ledger 行为偏差检测（纯函数 0 token）+ 纪律提醒
// 蓝图差异化定位：现有工具（同花顺/东财）只有"数据让你自己看"，纪律教练是对抗
//   行为偏差的"纪律官"——这是直接打散户痛点的能力。
// 合规：输出带 sampleSize + caliber；N<3 不判定；不承诺收益。
// ============================================================
const { pool } = require("../db");
const { detectBehaviorBias } = require("../lib/behaviorCoach");

module.exports = function coachRoutes(app) {
  app.get("/api/coach", async (req, res) => {
    try {
      const days = Math.min(Math.max(Number(req.query.days) || 30, 7), 180);
      const r = await pool.query(
        `SELECT date,ts,code,name,action,price,quantity,cost,pnl_pct FROM trade_ledger ORDER BY ts DESC LIMIT 500`,
      ).catch(() => ({ rows: [] }));
      const biases = detectBehaviorBias(r.rows, { days });
      res.json({
        biases,
        sampleSize: r.rows.length,
        caliber: `行为偏差=规则检测(频繁交易/不止损/追高/处置效应)，trade_ledger 近500笔，窗口${days}日；N<3 不判定防误报；不承诺收益；提醒引用行为金融原理`,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
};
