// ============================================================
// v9.142.0 server swing direction: board kline + fund history + zt catalyst
// GET /api/swing/direction
// ============================================================
const { pool } = require("../db");
const { getJson } = require("../lib/outbound");
const { scoreBoard, rankSwingBoards, scoreFund, scoreCatalyst } = require("../lib/swingMainline");

const EM_UT = "7eea3edcaed734bea9cbfc24409ed989";

function bjDateStr() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

async function fetchBoardKlines(code, days = 60) {
  const secid = `90.${code}`;
  const url = `http://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=0&lmt=${days}&end=20500101&ut=${EM_UT}`;
  const r = await getJson(url, { timeout: 8000, retries: 1, source: "push2his" });
  const rows = r.data?.data?.klines ?? [];
  if (!Array.isArray(rows) || rows.length < 25) throw new Error("board kline insufficient");
  return rows.map((line) => {
    const [date, open, close, high, low, volume] = String(line).split(",");
    return { date, open: Number(open), close: Number(close), high: Number(high), low: Number(low), volume: Number(volume) || 0 };
  });
}

async function loadBoardSources() {
  const snapR = await pool.query(`SELECT date,data FROM zt_snapshot ORDER BY date DESC LIMIT 1`);
  if (!snapR.rows[0]) return { date: null, boards: [], counts: {} };
  const raw = snapR.rows[0].data;
  const snap = typeof raw === "string" ? JSON.parse(raw) : raw;
  const arr = Array.isArray(snap) ? snap : snap?.pool ?? [];
  const counts = {};
  const boards = [];
  for (const p of arr) {
    const name = String(p?.hybk ?? "").trim();
    if (!name || name === "未分类") continue;
    counts[name] = (counts[name] ?? 0) + 1;
    if (!boards.some((b) => b.name === name)) boards.push({ name, code: p?.code ? String(p.code) : "" });
  }
  return { date: String(snapR.rows[0].date || ""), boards, counts };
}

async function loadFundMap() {
  const r = await pool.query(
    `SELECT key,value FROM kv_store WHERE key LIKE 'fund_streak:%' ORDER BY key DESC LIMIT 20`
  );
  const dates = [];
  const byName = new Map();
  const byCode = new Map();
  for (const row of r.rows) {
    const v = row.value;
    const data = typeof v === "string" ? JSON.parse(v) : v;
    const items = Array.isArray(data?.items) ? data.items : [];
    const date = String(row.key).replace("fund_streak:", "");
    dates.push(date);
    for (const it of items) {
      const name = String(it?.name ?? it?.board ?? "").trim();
      const code = String(it?.code ?? "").trim();
      const mainNet = Number(it?.mainNet);
      if (name && Number.isFinite(mainNet)) {
        if (!byName.has(name)) byName.set(name, []);
        byName.get(name).push({ date, mainNet });
      }
      if (code && name) byCode.set(name, code);
    }
  }
  return { dates, byName, byCode };
}

async function loadCachedDirection() {
  try {
    const r = await pool.query(`SELECT value FROM kv_store WHERE key=$1`, [`swing_direction:${bjDateStr()}`]);
    const v = r.rows[0]?.value;
    const data = typeof v === "string" ? JSON.parse(v) : v;
    if (data && Array.isArray(data.boards) && data.boards.length > 0) return data;
  } catch { /* ignore */ }
  return null;
}

async function buildDirection() {
  const today = bjDateStr();
  const cached = await loadCachedDirection();
  const { date, boards, counts } = await loadBoardSources();
  if (boards.length === 0 && cached) return cached;
  const fund = await loadFundMap();

  const results = [];
  const raw = [];
  let sources = boards.slice(0, 8);
  if (sources.length === 0) sources = [...fund.byName.keys()].slice(0, 8).map((name) => ({ name, code: fund.byCode.get(name) || "" }));
  const tasks = sources.map(async (b) => {
    const code = fund.byCode.get(b.name) || b.code || "";
    if (!code) return null;
    try {
      const klines = await fetchBoardKlines(code, 60);
      const fundSeq = (fund.byName.get(b.name) || []).slice(-20).map((x) => x.mainNet).reverse();
      const catalysts = counts[b.name] ? [{ title: `${b.name}涨停${counts[b.name]}只`, level: "行业" }] : [];
      const s = scoreBoard({ code, name: b.name, klines, fundSeq, catalysts });
      results.push(s);
      raw.push({ score: s, klines, fundSeq });
    } catch {
      const fundSeq = (fund.byName.get(b.name) || []).slice(-20).map((x) => x.mainNet).reverse();
      const catalysts = counts[b.name] ? [{ title: `${b.name}涨停${counts[b.name]}只`, level: "行业" }] : [];
      const f = scoreFund(fundSeq);
      const c2 = scoreCatalyst(catalysts);
      const s = {
        code, name: b.name, trend: 50, fund: f.score, catalyst: c2.score,
        total: Math.round(50 * 0.4 + f.score * 0.35 + c2.score * 0.25),
        phase: "资金信号", ma20Up: false, pct20d: null, fund10d: f.fund10d, fund20d: f.fund20d,
        catalystsTop: c2.catalystsTop, signals: [...f.signals, ...c2.signals, "板块K线暂不可用，使用资金/涨停数据"],
      };
      results.push(s);
      raw.push({ score: s, klines: [], fundSeq });
    }
  });
  await Promise.allSettled(tasks);

  const ranked = rankSwingBoards(results);
  const klineReady = raw.some((r) => Array.isArray(r.klines) && r.klines.length >= 25);
  const degraded = results.length === 0 || !klineReady;
  const out = {
    date: today,
    sourceDate: date,
    boards: ranked,
    raw: raw.sort((a, b) => ranked.findIndex((r) => r.code === a.score.code) - ranked.findIndex((r) => r.code === b.score.code)).slice(0, 5),
    asOf: new Date().toISOString(),
    degraded,
    reason: degraded ? (results.length === 0 ? "板块K线/资金数据暂不可用，显示最近缓存或空态" : "板块K线暂不可用，当前仅资金/涨停维度，禁止标记为完整方向") : null,
  };

  try {
    await pool.query(
      `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now())
       ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
      [`swing_direction:${today}`, JSON.stringify(out)],
    );
  } catch (e) { console.warn("[swing] cache failed:", e.message); }
  return out;
}

module.exports = function swingRoutes(app) {
  app.get("/api/swing/direction", async (_req, res) => {
    try {
      const out = await buildDirection();
      res.json(out);
    } catch (e) {
      const cached = await loadCachedDirection().catch(() => null);
      if (cached) return res.json({ ...cached, degraded: true, reason: `实时计算失败，使用缓存：${e.message}` });
      res.status(502).json({ error: e.message });
    }
  });
};

module.exports.buildDirection = buildDirection;
