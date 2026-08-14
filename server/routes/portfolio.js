// ============================================================
// v9.142.0 可操作闭环：统一持仓/成交/逻辑台账/盯盘接口
// GET  /api/portfolio
// POST /api/portfolio/trade
// POST /api/portfolio/logic
// DELETE /api/portfolio/logic/:id
// ============================================================
const { pool } = require("../db");
const { netPositions, concentration } = require("../lib/positions");
const { fetchStockSnapshotServer } = require("../lib/stockSnapshot");
const { checkLedgerAlerts } = require("../../src/shared/logic-ledger.js");

function bjDateStr(offset = 0) {
  const d = new Date(Date.now() + 8 * 3600 * 1000 + offset * 86400000);
  return d.toISOString().slice(0, 10);
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function rowToLogic(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    status: row.status,
    thesis: row.thesis,
    catalysts: Array.isArray(row.catalysts) ? row.catalysts : [],
    breakLine: num(row.break_line),
    board: row.board,
    decisionRef: row.decision_ref,
    tradeRef: row.trade_ref,
    simulated: Boolean(row.simulated),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at,
  };
}

async function loadPortfolio() {
  const [tradeRows, logicRows, watchRows, postRows] = await Promise.all([
    pool.query(
      `SELECT code,name,action,price,quantity,ts,date,pnl_pct,simulated
       FROM trade_ledger ORDER BY ts ASC LIMIT 2000`
    ),
    pool.query(`SELECT * FROM logic_ledger ORDER BY updated_at DESC LIMIT 200`),
    pool.query(`SELECT * FROM price_watch WHERE status='active' ORDER BY created_at`),
    pool.query(
      `SELECT ticket_id,date,mainline,code,human_action,confidence_at_post,price_at_post,simulated,ts
       FROM decision_post WHERE date >= to_char(now() - interval '30 days', 'YYYY-MM-DD')
       ORDER BY ts DESC LIMIT 100`
    ),
  ]);

  const allTrades = tradeRows.rows;
  const realTrades = allTrades.filter((t) => !t.simulated);
  const simulatedTrades = allTrades.filter((t) => t.simulated);
  const positions = netPositions(realTrades);
  const simulatedPositions = netPositions(simulatedTrades);

  for (const p of [...positions, ...simulatedPositions]) {
    if (!p.open) continue;
    try {
      const snap = await fetchStockSnapshotServer(p.code);
      if (snap && num(snap.price) > 0) {
        p.lastPrice = num(snap.price);
        p.pct = num(snap.pct);
        p.unrealizedPnlPct = p.avgCost > 0 ? Math.round((p.lastPrice - p.avgCost) / p.avgCost * 1000) / 10 : null;
      }
    } catch { /* 单股失败保留空字段 */ }
  }

  const logic = logicRows.rows.map(rowToLogic);
  const watch = watchRows.rows.map((w) => ({
    code: w.code,
    name: w.name,
    buyLow: num(w.buy_low),
    buyHigh: num(w.buy_high),
    stopLoss: num(w.stop_loss),
    triggerPct: num(w.trigger_pct) ?? 5,
    status: w.status,
    note: w.note,
  }));

  const decisions = postRows.rows.map((p) => ({
    ticketId: p.ticket_id,
    date: p.date,
    mainline: p.mainline,
    code: p.code,
    humanAction: p.human_action,
    confidenceAtPost: num(p.confidence_at_post),
    priceAtPost: num(p.price_at_post),
    simulated: Boolean(p.simulated),
  }));

  const priceMap = new Map();
  const needPrice = logic.filter((e) => e.breakLine != null && e.status === "验证中");
  for (const e of needPrice) {
    if (!priceMap.has(e.code)) {
      try {
        const snap = await fetchStockSnapshotServer(e.code);
        if (snap && num(snap.price) > 0) priceMap.set(e.code, num(snap.price));
      } catch { /* 忽略 */ }
    }
  }

  const todos = [];
  for (const e of logic) {
    const alerts = checkLedgerAlerts(e, {
      price: priceMap.get(e.code) ?? null,
      boardHealthy: null,
      today: bjDateStr(),
    });
    for (const a of alerts) todos.push({ type: a.type, severity: a.severity, message: a.message, code: e.code });
  }
  const pendingDecisions = decisions.filter((d) => d.humanAction === "watch" || d.humanAction === "confirm" && !d.simulated);
  for (const d of pendingDecisions.slice(0, 5)) {
    todos.push({
      type: "decision_pending",
      severity: "warning",
      message: `${d.code || d.mainline || "主线"} 已拍板：${d.humanAction === "confirm" ? "确认上车" : "等待观察"}`,
      code: d.code,
    });
  }

  return {
    positions,
    simulatedPositions,
    logic,
    watch,
    decisions,
    todos: todos.slice(0, 20),
    concentration: concentration(positions),
    asOf: new Date().toISOString(),
  };
}

module.exports = function portfolioRoutes(app) {
  app.get("/api/portfolio", async (_req, res) => {
    try {
      res.json(await loadPortfolio());
    } catch (e) {
      console.error("[portfolio] GET failed:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/portfolio/trade", async (req, res) => {
    const t = req.body || {};
    if (!t.code || !t.action || !Number.isFinite(Number(t.price)) || Number(t.price) <= 0) {
      return res.status(400).json({ error: "code/action/price required" });
    }
    const action = String(t.action);
    if (!["buy", "sell", "stop", "adjust"].includes(action)) {
      return res.status(400).json({ error: "invalid action" });
    }
    const price = Number(t.price);
    const quantity = Math.max(1, Math.round(Number(t.quantity) || 100));
    const date = String(t.date || bjDateStr());
    const simulated = Boolean(t.simulated);
    let cost = t.cost != null ? num(t.cost) : null;
    let pnlPct = t.pnlPct != null ? num(t.pnlPct) : null;

    if (action === "buy") {
      cost = cost > 0 ? cost : price;
    } else if (pnlPct == null) {
      const posRows = await pool.query(
        `SELECT code,name,action,price,quantity,ts,date,pnl_pct FROM trade_ledger
         WHERE code=$1 ORDER BY ts ASC LIMIT 500`,
        [String(t.code)]
      );
      const pos = netPositions(posRows.rows).find((p) => p.code === String(t.code) && p.open);
      const avg = pos?.avgCost ?? cost;
      pnlPct = avg != null && avg > 0 ? Math.round((price - avg) / avg * 1000) / 10 : null;
    }

    const r = await pool.query(
      `INSERT INTO trade_ledger(date,decision_post_ref,code,name,action,price,quantity,cost,pnl_pct,notes,simulated,ts)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
       RETURNING *`,
      [
        date,
        t.decisionPostRef ?? null,
        String(t.code),
        String(t.name || ""),
        action,
        price,
        quantity,
        cost,
        pnlPct,
        String(t.notes || ""),
        simulated,
      ]
    );
    res.json({ ok: true, trade: r.rows[0], portfolio: await loadPortfolio() });
  });

  app.post("/api/portfolio/logic", async (req, res) => {
    const b = req.body || {};
    if (!b.code || !String(b.thesis || "").trim()) {
      return res.status(400).json({ error: "code/thesis required" });
    }
    const code = String(b.code).trim();
    const name = String(b.name || code);
    const status = ["验证中", "已兑现", "已证伪", "已离场"].includes(b.status) ? b.status : "验证中";
    const catalysts = Array.isArray(b.catalysts) ? b.catalysts : [];
    const breakLine = b.breakLine != null ? num(b.breakLine) : null;
    const board = b.board ? String(b.board) : null;
    const decisionRef = b.decisionRef ? String(b.decisionRef) : null;
    const tradeRef = b.tradeRef != null ? Math.round(Number(b.tradeRef)) : null;
    const simulated = Boolean(b.simulated);

    let row;
    if (b.id) {
      const r = await pool.query(
        `UPDATE logic_ledger
         SET code=$2,name=$3,status=$4,thesis=$5,catalysts=$6,break_line=$7,board=$8,
             decision_ref=$9,trade_ref=$10,simulated=$11,updated_at=now(),
             closed_at=CASE WHEN $4='已离场' THEN COALESCE(closed_at,now()) ELSE NULL END
         WHERE id=$1 RETURNING *`,
        [Number(b.id), code, name, status, String(b.thesis), JSON.stringify(catalysts), breakLine, board, decisionRef, tradeRef, simulated]
      );
      row = r.rows[0];
    } else {
      const r = await pool.query(
        `INSERT INTO logic_ledger(code,name,status,thesis,catalysts,break_line,board,decision_ref,trade_ref,simulated)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [code, name, status, String(b.thesis), JSON.stringify(catalysts), breakLine, board, decisionRef, tradeRef, simulated]
      );
      row = r.rows[0];
    }
    res.json({ ok: true, logic: rowToLogic(row), portfolio: await loadPortfolio() });
  });

  app.delete("/api/portfolio/logic/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid id" });
    await pool.query(`DELETE FROM logic_ledger WHERE id=$1`, [id]);
    res.json({ ok: true, portfolio: await loadPortfolio() });
  });
};

module.exports.loadPortfolio = loadPortfolio;
