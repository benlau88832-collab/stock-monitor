// ============================================================
// stock-monitor 本地服务端 · 入口
// 功能：① 静态托管 docs/index.html（v9.25 前端）
//       ② /api/db/*  前端数据读写 PostgreSQL
//       ③ /api/proxy/* 东方财富接口转发（CORS/限流缓存）
//       ④ 定时抓取 + LLM 分析（cron）
// 访问：本机 http://localhost:8080 ；局域网 http://<本机IP>:8080
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

app.use(cors());
// v9.64（V1 安全）：10mb → 1mb（配合 kv/bulk ≤100 条，防一次打满 PG）
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// ---------- 健康检查 ----------
app.get("/api/health", async (req, res) => {
  let db = "down";
  try { await pool.query("SELECT 1"); db = "up"; } catch {}
  res.json({ ok: true, db, version: "v9.25-local", time: new Date().toISOString() });
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

// ---------- 定时任务（收盘抓取 + LLM 分析） ----------
require("./cron")({ pool });

// ---------- 启动 ----------
initDb().then(() => {
  app.listen(PORT, "0.0.0.0", () => {
    const nets = os.networkInterfaces();
    const ips = [];
    for (const k of Object.keys(nets)) {
      for (const n of nets[k] || []) {
        if (n.family === "IPv4" && !n.internal) ips.push(n.address);
      }
    }
    console.log(`[server] stock-monitor local server on port ${PORT}`);
    console.log(`[server] 本机访问:   http://localhost:${PORT}`);
    ips.forEach(ip => console.log(`[server] 局域网访问: http://${ip}:${PORT}`));
  });
}).catch(err => {
  console.error("[server] DB init failed:", err.message);
  process.exit(1);
});
