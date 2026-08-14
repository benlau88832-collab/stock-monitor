// ============================================================
// stock-monitor local server entry
// Static hosting: docs/index.html
// APIs: /api/db/*, /api/proxy/*, cron + LLM analysis
// ============================================================
const express = require("express");
const cors = require("cors");
const path = require("path");
const { initDb, pool } = require("./db");

require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 8080;

const isLocalOrigin = (origin) => {
  if (!origin) return true;
  try {
    const u = new URL(origin);
    return u.hostname === "localhost" || u.hostname === "127.0.0.1";
  } catch { return false; }
};
app.use(cors({
  origin: (origin, cb) => {
    if (isLocalOrigin(origin)) cb(null, true);
    else cb(null, false);
  },
}));

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

const DOCS_DIR = path.join(__dirname, "..", "docs");
app.use(express.static(DOCS_DIR));
app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(DOCS_DIR, "index.html"));
});

app.get("/api/auth/local-token", async (req, res) => {
  try {
    const origin = req.headers.origin;
    if (origin) {
      let u;
      try { u = new URL(origin); } catch { return res.status(403).json({ error: "forbidden" }); }
      const selfPort = req.socket.localPort || 8080;
      const isSelf = (u.hostname === "localhost" || u.hostname === "127.0.0.1")
        && (u.port === String(selfPort) || u.port === "8080");
      if (!isSelf) return res.status(403).json({ error: "forbidden origin" });
    }
    const r = await pool.query("SELECT value FROM kv_store WHERE key='local_token'");
    const v = r.rows[0]?.value;
    const t = v && typeof v === "object" && "__raw" in v ? v.__raw : (typeof v === "string" ? v : v?.token);
    res.json({ token: t ? String(t) : null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const WRITE_AUTH_WHITELIST = new Set(["/ai/call", "/ai/stream", "/brain/pg"]);
let writeTokenCache = { t: null, ts: 0 };
let writeTokenInitialized = false;

async function effectiveWriteToken() {
  if (process.env.LOCAL_TOKEN) return process.env.LOCAL_TOKEN;
  if (writeTokenCache.t && Date.now() - writeTokenCache.ts < 30000) return writeTokenCache.t;
  try {
    const r = await pool.query("SELECT value FROM kv_store WHERE key='local_token'");
    const v = r.rows[0]?.value;
    const t = v && typeof v === "object" && "__raw" in v ? v.__raw : (typeof v === "string" ? v : v?.token);
    writeTokenCache = { t: t ? String(t) : null, ts: Date.now() };
    writeTokenInitialized = true;
    return writeTokenCache.t;
  } catch {
    return writeTokenInitialized ? writeTokenCache.t : null;
  }
}

app.use("/api", async (req, res, next) => {
  const method = req.method;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();
  if (WRITE_AUTH_WHITELIST.has(req.path)) return next();
  const token = await effectiveWriteToken();
  if (!token || req.headers["x-local-token"] !== token) {
    return res.status(401).json({ error: "unauthorized: missing/invalid x-local-token" });
  }
  next();
});

require("./routes/db")(app);

// v9.142.0 unified portfolio/trade/logic ledger + server swing direction
require("./routes/portfolio")(app);
require("./routes/swing")(app);
require("./routes/chain")(app);

require("./routes/cognition")(app);
require("./routes/decisions")(app);
require("./routes/proactive")(app);
require("./routes/reasoning")(app);
require("./routes/proxy")(app);
require("./routes/health")(app);
require("./routes/ai")(app);
require("./routes/research")(app);
require("./routes/watch")(app);
require("./routes/push")(app);
require("./routes/news")(app);
require("./routes/coach")(app);
require("./routes/backtest")(app);

require("./cron")({ pool });

(async () => {
  try {
    const { ensureConceptWhitelist } = require("./lib/thsConcepts");
    const r = await ensureConceptWhitelist(pool);
    if (r.refreshed) console.log(`[thsConcepts] whitelist refreshed: ${r.count}`);
    else console.log("[thsConcepts] whitelist fresh");
  } catch (e) { console.warn("[thsConcepts] preload failed:", e.message); }
})();

async function ensureLocalToken(p) {
  if (process.env.LOCAL_TOKEN) return process.env.LOCAL_TOKEN;
  try {
    const r = await p.query("SELECT value FROM kv_store WHERE key='local_token'");
    if (r.rows.length && r.rows[0].value) {
      const v = r.rows[0].value;
      const t = v && typeof v === "object" && "__raw" in v ? v.__raw : (typeof v === "string" ? v : v?.token);
      if (t) return String(t);
    }
    const token = require("crypto").randomBytes(24).toString("hex");
    await p.query(
      `INSERT INTO kv_store(key,value,updated_at) VALUES('local_token',$1,now())
       ON CONFLICT(key) DO UPDATE SET value=$1, updated_at=now()`,
      [JSON.stringify({ token })],
    );
    console.log("[server] LOCAL_TOKEN generated");
    return token;
  } catch (e) {
    console.warn("[server] LOCAL_TOKEN init failed:", e.message);
    return null;
  }
}

initDb().then(async () => {
  try {
    const { runMigrations } = require("./db-migrations");
    await runMigrations();
  } catch (e) { console.warn("[server] db-migrations failed:", e.message); }
  const token = await ensureLocalToken(pool);
  try { const { buildDirection } = require("./routes/swing"); buildDirection().catch((e) => console.warn("[swing] warmup failed:", e.message)); setInterval(() => buildDirection().catch((e) => console.warn("[swing] background refresh failed:", e.message)), 30 * 60 * 1000); } catch (e) { console.warn("[swing] warmup setup failed:", e.message); }
  app.listen(PORT, "127.0.0.1", () => {
    console.log(`[server] stock-monitor local server on port ${PORT}`);
    console.log(`[server] local: http://localhost:${PORT}${token ? " (x-local-token enabled)" : ""}`);
  });
}).catch(err => {
  console.error("[server] DB init failed:", err.message);
  process.exit(1);
});
