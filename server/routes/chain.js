// ============================================================
// v9.143.0 chain/context: stock -> industry chain context
// Shared chain KB now lives in src/shared/transmission-chain.js.
// ============================================================
const { pool } = require("../db");
const { buildChainView } = require("../../src/shared/transmission-chain.js");
const { getChainDbContext } = require("../lib/chainDb");

function bjDateStr() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

async function findBoardsForCode(code) {
  const candidates = [];
  const [conceptR, ztR] = await Promise.allSettled([
    pool.query(`SELECT concepts, all_boards, hybk, core_concept FROM stock_concepts WHERE code=$1`, [code]),
    pool.query(`SELECT data FROM zt_snapshot ORDER BY date DESC LIMIT 1`),
  ]);
  if (conceptR.status === "fulfilled" && conceptR.value.rows[0]) {
    const row = conceptR.value.rows[0];
    if (row.core_concept) candidates.push(String(row.core_concept));
    if (row.hybk) candidates.push(String(row.hybk));
    const boards = Array.isArray(row.all_boards) ? row.all_boards : [];
    for (const b of boards.slice(0, 6)) candidates.push(String(b));
    const concepts = Array.isArray(row.concepts) ? row.concepts : [];
    for (const c of concepts.slice(0, 6)) candidates.push(String(c));
  }
  if (ztR.status === "fulfilled" && ztR.value.rows[0]) {
    const raw = ztR.value.rows[0].data;
    const snap = typeof raw === "string" ? JSON.parse(raw) : raw;
    const poolArr = Array.isArray(snap) ? snap : snap?.pool ?? [];
    const hit = poolArr.find((p) => String(p.code ?? p.c ?? "") === code);
    if (hit?.hybk) candidates.push(String(hit.hybk));
    if (hit?.name) candidates.push(String(hit.name));
  }
  return [...new Set(candidates.filter(Boolean))];
}

async function findChainForBoards(candidates) {
  for (const b of candidates) {
    const chain = buildChainView(b);
    if (chain) return { chain, board: b };
  }
  return null;
}

async function enrichSignals(board) {
  const out = { fund: null, ztCount: null };
  try {
    const r = await pool.query(`SELECT value FROM kv_store WHERE key=$1`, [`fund_streak:${bjDateStr()}`]);
    const v = r.rows[0]?.value;
    const data = typeof v === "string" ? JSON.parse(v) : v;
    const items = Array.isArray(data?.items) ? data.items : [];
    const hit = items.find((x) => String(x.name ?? x.board ?? "") === board);
    if (hit) out.fund = { name: hit.name || board, mainNet: Number(hit.mainNet) || 0 };
  } catch { /* ignore */ }
  try {
    const r = await pool.query(`SELECT data FROM zt_snapshot ORDER BY date DESC LIMIT 1`);
    const raw = r.rows[0]?.data;
    const snap = typeof raw === "string" ? JSON.parse(raw) : raw;
    const arr = Array.isArray(snap) ? snap : snap?.pool ?? [];
    out.ztCount = arr.filter((p) => String(p.hybk ?? "") === board).length;
  } catch { /* ignore */ }
  return out;
}

module.exports = function chainRoutes(app) {
  app.get("/api/chain/context", async (req, res) => {
    const code = String(req.query.code || "").trim();
    const board = String(req.query.board || "").trim();
    try {
      if (code && !/^\d{6}$/.test(code)) return res.status(400).json({ error: "invalid code" });
      if (code) {
        const dbCtx = await getChainDbContext(pool, code);
        if (dbCtx.mapped) {
          return res.json({ code, board: dbCtx.chain.boardName, boards: dbCtx.boards, chain: dbCtx.chain, signals: { fund: null, ztCount: null }, source: "db" });
        }
      }
      const candidates = code ? await findBoardsForCode(code) : (board ? [board] : []);
      if (candidates.length === 0) {
        return res.json({ code, board, chain: null, reason: "未收录，待补充" });
      }
      const found = await findChainForBoards(candidates);
      if (!found) {
        return res.json({ code, board, chain: null, boards: candidates.slice(0, 10), reason: "未收录，待补充" });
      }
      const signals = await enrichSignals(found.board);
      res.json({ code, board: found.board, boards: candidates.slice(0, 10), chain: found.chain, signals });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
};
