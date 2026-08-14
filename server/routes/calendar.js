// ============================================================
// v9.145.0（P2-3）：催化剂日历 API
// ============================================================
const { pool } = require("../db");
const { refreshCatalystCalendar, getCatalystCalendar } = require("../lib/catalystCalendar");

module.exports = function calendarRoutes(app) {
  app.get("/api/calendar/catalysts", async (req, res) => {
    try {
      const code = String(req.query.code || "").trim();
      const days = Math.max(7, Math.min(365, Number(req.query.days) || 180));
      if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: "code required" });
      res.json({ ok: true, code, days, items: await getCatalystCalendar(code, days) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/calendar/refresh", async (req, res) => {
    try {
      const out = await refreshCatalystCalendar(pool);
      res.json({ ok: true, ...out });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
};
