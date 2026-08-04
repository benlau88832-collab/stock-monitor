// ============================================================
// /api/db/*  前端数据读写 PostgreSQL
// 约定：
//   GET  /api/db/kv?key=xxx         → { key, value } | { value: null }
//   PUT  /api/db/kv                 → body { key, value }  upsert
//   POST /api/db/kv/bulk            → body [{ key, value }] 批量 upsert（迁移用）
//   GET  /api/db/news?since=YYYY-MM-DD → 快讯列表
//   POST /api/db/news               → body [newsItem] upsert
//   GET  /api/db/anns?since=YYYY-MM-DD → 公告列表
//   POST /api/db/anns               → body [annItem] upsert
//   GET  /api/db/zt?date=YYYY-MM-DD → 涨停快照
//   POST /api/db/zt                 → body { date, data }
// ============================================================
const { pool } = require("../db");

module.exports = function dbRoutes(app) {

  // ---------- 通用 kv ----------
  app.get("/api/db/kv", async (req, res) => {
    try {
      const key = String(req.query.key || "");
      if (!key) return res.status(400).json({ error: "key required" });
      const r = await pool.query("SELECT value FROM kv_store WHERE key=$1", [key]);
      res.json({ key, value: r.rows.length ? r.rows[0].value : null });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // v9.26.6：列出全部 key（供前端启动时批量拉回历史数据：seats/playbook/rec_tracker 等）
  app.get("/api/db/kv/keys", async (req, res) => {
    try {
      const r = await pool.query("SELECT key, updated_at FROM kv_store ORDER BY key");
      res.json({ keys: r.rows.map(x => x.key) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // v9.26.6：批量拉取多个 key（limit 防止过大响应；前端分批）
  app.get("/api/db/kv/bulk", async (req, res) => {
    try {
      const keysRaw = String(req.query.keys || "");
      const keys = keysRaw.split(",").map(s => s.trim()).filter(Boolean);
      if (keys.length === 0) return res.json({ items: [] });
      const r = await pool.query("SELECT key, value FROM kv_store WHERE key = ANY($1::text[])", [keys]);
      res.json({ items: r.rows.map(x => ({ key: x.key, value: x.value })) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put("/api/db/kv", async (req, res) => {
    try {
      const { key, value } = req.body || {};
      if (!key) return res.status(400).json({ error: "key required" });
      const v = typeof value === "string" ? { __raw: value } : (value ?? null);
      await pool.query(
        `INSERT INTO kv_store(key, value, updated_at) VALUES($1,$2,now())
         ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
        [key, JSON.stringify(v)],
      );
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/db/kv/bulk", async (req, res) => {
    try {
      const items = Array.isArray(req.body) ? req.body : [];
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const { key, value } of items) {
          if (!key) continue;
          const v = typeof value === "string" ? { __raw: value } : (value ?? null);
          await client.query(
            `INSERT INTO kv_store(key, value, updated_at) VALUES($1,$2,now())
             ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
            [key, JSON.stringify(v)],
          );
        }
        await client.query("COMMIT");
      } catch (e) { await client.query("ROLLBACK"); throw e; }
      finally { client.release(); }
      res.json({ ok: true, count: items.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ---------- 快讯 ----------
  app.get("/api/db/news", async (req, res) => {
    try {
      const since = String(req.query.since || "");
      const limit = Math.max(1, Math.min(Number(req.query.limit) || 200, 1000));
      const q = since
        ? "SELECT * FROM news WHERE time >= $1 ORDER BY time DESC LIMIT $2"
        : "SELECT * FROM news ORDER BY time DESC LIMIT $1";
      const r = since ? await pool.query(q, [since, limit]) : await pool.query(q, [limit]);
      res.json(r.rows.map(row => ({
        code: row.code, title: row.title, summary: row.summary,
        boards: row.boards ?? [], sentiment: row.sentiment,
        stars: row.stars, isOverseas: row.is_overseas, time: row.time, url: row.url,
      })));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/db/news", async (req, res) => {
    try {
      const items = Array.isArray(req.body) ? req.body : [];
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const n of items) {
          if (!n.code) continue;
          await client.query(
            `INSERT INTO news(code,title,summary,boards,sentiment,stars,is_overseas,time,url)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT(code) DO UPDATE SET title=$2,summary=$3,boards=$4,sentiment=$5,stars=$6,is_overseas=$7,time=$8,url=$9`,
            [n.code, n.title, n.summary ?? "", JSON.stringify(n.boards ?? []), n.sentiment ?? "neutral", n.stars ?? 1, !!n.isOverseas, n.time ?? "", n.url ?? ""],
          );
        }
        await client.query("COMMIT");
      } catch (e) { await client.query("ROLLBACK"); throw e; }
      finally { client.release(); }
      res.json({ ok: true, count: items.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ---------- 公告 ----------
  app.get("/api/db/anns", async (req, res) => {
    try {
      const since = String(req.query.since || "");
      const limit = Math.max(1, Math.min(Number(req.query.limit) || 200, 1000));
      const q = since
        ? "SELECT * FROM announcements WHERE time >= $1 ORDER BY time DESC LIMIT $2"
        : "SELECT * FROM announcements ORDER BY time DESC LIMIT $1";
      const r = since ? await pool.query(q, [since, limit]) : await pool.query(q, [limit]);
      res.json(r.rows.map(row => ({
        artCode: row.art_code, stockCode: row.stock_code, stockName: row.stock_name,
        title: row.title, columnName: row.column_name, boards: row.boards ?? [],
        score: row.score, logic: row.logic, time: row.time, url: row.url,
      })));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/db/anns", async (req, res) => {
    try {
      const items = Array.isArray(req.body) ? req.body : [];
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const a of items) {
          if (!a.artCode) continue;
          await client.query(
            `INSERT INTO announcements(art_code,stock_code,stock_name,title,column_name,boards,score,logic,time,url)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             ON CONFLICT(art_code) DO UPDATE SET stock_code=$2,stock_name=$3,title=$4,column_name=$5,boards=$6,score=$7,logic=$8,time=$9,url=$10`,
            [a.artCode, a.stockCode ?? "", a.stockName ?? "", a.title ?? "", a.columnName ?? "",
             JSON.stringify(a.boards ?? []), a.score ?? null, a.logic ?? null, a.time ?? "", a.url ?? ""],
          );
        }
        await client.query("COMMIT");
      } catch (e) { await client.query("ROLLBACK"); throw e; }
      finally { client.release(); }
      res.json({ ok: true, count: items.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ---------- 涨停快照 ----------
  app.get("/api/db/zt", async (req, res) => {
    try {
      const date = String(req.query.date || "");
      const r = date
        ? await pool.query("SELECT date,data FROM zt_snapshot WHERE date=$1", [date])
        : await pool.query("SELECT date,data FROM zt_snapshot ORDER BY date DESC LIMIT 30");
      res.json(r.rows.map(x => ({ date: x.date, data: x.data })));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/db/zt", async (req, res) => {
    try {
      const { date, data } = req.body || {};
      if (!date) return res.status(400).json({ error: "date required" });
      await pool.query(
        `INSERT INTO zt_snapshot(date,data) VALUES($1,$2)
         ON CONFLICT(date) DO UPDATE SET data=$2, created_at=now()`,
        [date, JSON.stringify(data ?? {})],
      );
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
};
