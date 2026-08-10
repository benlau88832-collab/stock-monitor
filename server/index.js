// ============================================================
// stock-monitor 本地服务端 · 入口
// 功能：① 静态托管 docs/index.html（v9.25 前端）
//       ② /api/db/*  前端数据读写 PostgreSQL
//       ③ /api/proxy/* 东方财富接口转发（CORS/限流缓存）
//       ④ 定时抓取 + LLM 分析（cron）
// 访问：本机 http://localhost:8080
// ============================================================
const express = require("express");
const cors = require("cors");
const path = require("path");
const os = require("os");
const { initDb, pool } = require("./db");

// v9.26.5：显式加载 .env（保证任意启动方式都读到 AI_API_KEY / DATABASE_URL）
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 8080;

// v9.75（安全修复）：CORS 从全放开收敛为仅本机来源 ——
// 之前 app.use(cors()) 允许任意网页跨域读取 /api/db/*（实测可无鉴权读到 AI Key），
// 现在只放行 localhost/127.0.0.1 同源访问；GitHub Pages 线上无 /api 不受影响。
const isLocalOrigin = (origin) => {
  if (!origin) return true; // 同源/无 Origin（curl 等）
  try {
    const u = new URL(origin);
    return u.hostname === "localhost" || u.hostname === "127.0.0.1";
  } catch { return false; }
};
app.use(cors({
  origin: (origin, cb) => {
    if (isLocalOrigin(origin)) cb(null, true);
    else cb(null, false); // 拒绝第三方 Origin，不返回 ACAO 头
  },
}));
// v9.67：1mb → 2mb —— AI 长上下文+history+toolDefs+researchCtx 累积常超 1mb（PM2 日志反复 PayloadTooLargeError），2mb 在安全范围
// v9.77：2mb → 10mb —— localStorage 全量迁移（migrateLocalStorageToCloud，~4.5MB）批量 POST 仍超 2mb → 413 静默丢数据；
//   仅监听 127.0.0.1 本机，10mb 安全
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// ---------- 健康检查 ----------
app.get("/api/health", async (req, res) => {
  let db = "down";
  try { await pool.query("SELECT 1"); db = "up"; } catch {}
  res.json({ ok: true, db, version: "v9.94.2-local", time: new Date().toISOString() });
});

// ---------- 静态托管（前端单文件产物） ----------
const DOCS_DIR = path.join(__dirname, "..", "docs");
app.use(express.static(DOCS_DIR));
// SPA fallback：未知路径回 index.html
app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(DOCS_DIR, "index.html"));
});

// ============== v9.85.0（P0-2）：本地 token 专用读取端点 ==============
// 背景：kv 敏感 key 已脱敏（local_token 不再可经 /api/db/kv 读取），前端改走本端点。
// 安全：严格校验 Origin 必须为本服务自身（localhost:8080/127.0.0.1:8080 或同源无 Origin）——
//   其他 localhost 端口网页（恶意）拿不到 token；服务端仅监听 127.0.0.1。
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

// ============== v9.85.0（P0-2）：/api 写操作统一鉴权中间件 ==============
// 背景（审查报告 P0-2）：此前仅 /api/ai/* 与 /api/proxy/* 有 LOCAL_TOKEN 鉴权（且因 P0-1 未生效），
//   /api/db、/api/watch、/api/push、/api/research、/api/theme-analysis 等写接口全部裸奔——
//   localhost 任意网页可覆盖 PG 数据、读推送凭据、触发付费 LLM/推送。
// 策略：POST/PUT/DELETE 必须携带 x-local-token（前端 cloudStore.apiFetch 自动带）；
//   GET 读端点维持 localhost-only（与现状一致，全量收敛列入 backlog）。
// 白名单：/api/ai/call|stream 自带鉴权（P0-1 已修复）；/api/brain/pg 是工具名白名单只读查询。
const WRITE_AUTH_WHITELIST = new Set(["/api/ai/call", "/api/ai/stream", "/api/brain/pg"]);
let writeTokenCache = { t: null, ts: 0 };
let writeTokenInitialized = false; // v9.85.2（P1-1）：fail-closed —— 已初始化后读取失败拒绝写操作
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

// ---------- DB 读写路由 ----------
require("./routes/db")(app);

// ---------- 东财代理路由 ----------
require("./routes/proxy")(app);

// ---------- AI 中转路由（v9.26 F-03：模型 Key 只存服务端 .env） ----------
require("./routes/ai")(app);

// ---------- v9.66：个股深度调研（妙想中转） ----------
require("./routes/research")(app);

// ---------- v9.66：个股盯价监控（清单/走势/触发事件） ----------
require("./routes/watch")(app);

// ---------- P0-4：外部推送中转（Server酱/企业微信/Bark） ----------
require("./routes/push")(app);

// ---------- 定时任务（收盘抓取 + LLM 分析） ----------
require("./cron")({ pool });

// ---------- v9.91.0（概念地基）：同花顺概念白名单启动预加载（异步，不阻塞启动） ----------
// 表空或 >24h 时后台抓取落库；首次请求 /api/concepts/whitelist 时前端会再触发一次懒加载兜底
(async () => {
  try {
    const { ensureConceptWhitelist } = require("./lib/thsConcepts");
    const r = await ensureConceptWhitelist(pool);
    if (r.refreshed) console.log(`[thsConcepts] 概念白名单启动刷新完成: ${r.count} 个概念`);
    else console.log("[thsConcepts] 概念白名单已就绪（无需刷新）");
  } catch (e) { console.warn("[thsConcepts] 启动预加载失败（首次请求时再试）:", e.message); }
})();

// ---------- 启动 ----------
// v9.75（安全修复）：只监听 127.0.0.1（本机），不再暴露 0.0.0.0 —— 局域网其他设备无法访问，恶意网页无法触碰
// v9.84.3（5.4）：LOCAL_TOKEN 默认启用 —— 未配置 env 时自动生成随机 token 落 kv（local_token），
//   前端自动读取并在 /api/ai/* 携带 x-local-token（防局域网/公网白嫖 AI 配额，V1 遗留半成品收尾）
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
    console.log("[server] LOCAL_TOKEN 自动生成并落库（/api/ai 接口鉴权已启用）");
    return token;
  } catch (e) {
    console.warn("[server] LOCAL_TOKEN 初始化失败（鉴权未启用）:", e.message);
    return null;
  }
}

initDb().then(async () => {
  const token = await ensureLocalToken(pool);
  app.listen(PORT, "127.0.0.1", () => {
    console.log(`[server] stock-monitor local server on port ${PORT}`);
    console.log(`[server] 本机访问:   http://localhost:${PORT}${token ? "（x-local-token 已启用）" : ""}`);
  });
}).catch(err => {
  console.error("[server] DB init failed:", err.message);
  process.exit(1);
});
