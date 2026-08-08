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
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// ---------- 健康检查 ----------
app.get("/api/health", async (req, res) => {
  let db = "down";
  try { await pool.query("SELECT 1"); db = "up"; } catch {}
  res.json({ ok: true, db, version: "v9.77-local", time: new Date().toISOString() });
});

// ---------- 静态托管（前端单文件产物） ----------
const DOCS_DIR = path.join(__dirname, "..", "docs");
app.use(express.static(DOCS_DIR));
// SPA fallback：未知路径回 index.html
app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(DOCS_DIR, "index.html"));
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

// ---------- 启动 ----------
// v9.75（安全修复）：只监听 127.0.0.1（本机），不再暴露 0.0.0.0 —— 局域网其他设备无法访问，恶意网页无法触碰
initDb().then(() => {
  app.listen(PORT, "127.0.0.1", () => {
    console.log(`[server] stock-monitor local server on port ${PORT}`);
    console.log(`[server] 本机访问:   http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error("[server] DB init failed:", err.message);
  process.exit(1);
});
