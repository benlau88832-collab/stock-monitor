// ============================================================
// v9.143.0 portfolio periodic report: combo-level review
// GET /api/portfolio/report?days=30
// ============================================================
const { pool } = require("../db");
const { loadPortfolio } = require("./portfolio");

function bjDateStr(offset = 0) {
  const d = new Date(Date.now() + 8 * 3600 * 1000 + offset * 86400000);
  return d.toISOString().slice(0, 10);
}

module.exports = function portfolioReportRoutes(app) {
  app.get("/api/portfolio/report", async (req, res) => {
    try {
      const days = Math.max(7, Math.min(90, Number(req.query.days) || 30));
      const since = bjDateStr(-(days - 1));
      const today = bjDateStr();
      const port = await loadPortfolio();
      const trades = (port.trades ?? []).filter((t) => !t.simulated && String(t.date || "") >= since);
      const logic = (port.logic ?? []).filter((e) => String(e.createdAt || "").slice(0, 10) >= since || String(e.updatedAt || "").slice(0, 10) >= since);
      const reviewDue = logic.filter((e) => e.nextReviewAt && String(e.nextReviewAt).slice(0, 10) <= today);
      const invalidationCount = logic.reduce((s, e) => s + (Array.isArray(e.invalidationConditions) ? e.invalidationConditions.length : 0), 0);

      const byTheme = new Map();
      const realized = trades.filter((t) => (t.action === "sell" || t.action === "stop") && t.pnlPct != null);
      for (const t of realized) {
        const key = t.board || t.name || t.code || "未知";
        const rec = byTheme.get(key) ?? { theme: key, count: 0, pnlSum: 0, wins: 0 };
        rec.count++; rec.pnlSum += Number(t.pnlPct) || 0; if (Number(t.pnlPct) > 0) rec.wins++;
        byTheme.set(key, rec);
      }
      const themes = [...byTheme.values()]
        .map((x) => ({ ...x, avgPnl: Math.round(x.pnlSum / x.count * 10) / 10, winRate: Math.round(x.wins / x.count * 100) }))
        .sort((a, b) => b.pnlSum - a.pnlSum)
        .slice(0, 8);
      const realizedAvg = realized.length > 0 ? Math.round(realized.reduce((s, t) => s + (Number(t.pnlPct) || 0), 0) / realized.length * 10) / 10 : null;

      res.json({
        periodDays: days,
        since,
        asOf: new Date().toISOString(),
        positions: port.positions?.length ?? 0,
        trades: trades.length,
        realizedPnlPct: realizedAvg,
        reviewDue: reviewDue.length,
        invalidationCount,
        byTheme: themes,
        pendingLogic: logic.length,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
};
