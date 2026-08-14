// ============================================================
// v9.143.0 decision feedback: structured user feedback for AI decisions
// POST /api/db/decision_feedback
// GET  /api/db/decision_feedback?limit=20
// ============================================================
const { pool } = require("../db");

module.exports = function feedbackRoutes(app) {
  app.post("/api/db/decision_feedback", async (req, res) => {
    try {
      const b = req.body || {};
      if (!String(b.feedback || "").trim()) return res.status(400).json({ error: "feedback required" });
      await pool.query(
        `INSERT INTO decision_feedback(ticket_id,code,mainline,feedback,attribution,note) VALUES($1,$2,$3,$4,$5,$6)`,
        [b.ticketId ?? null, b.code ?? null, b.mainline ?? null, String(b.feedback).trim(), b.attribution ?? null, String(b.note || "").slice(0, 200)],
      );
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/db/decision_feedback", async (req, res) => {
    try {
      const limit = Math.max(1, Math.min(Number(req.query.limit) || 20, 200));
      const r = await pool.query(
        `SELECT id,ticket_id,code,mainline,feedback,attribution,note,created_at FROM decision_feedback ORDER BY id DESC LIMIT $1`,
        [limit],
      );
      res.json({ items: r.rows });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
};
