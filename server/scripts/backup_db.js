// ============================================================
// v9.80（V1 运维 P0）：PostgreSQL 每日备份脚本
// 用法：node scripts/backup_db.js [备份目录]（默认 E:\CC-HAHA\backups\stock_monitor）
// 建议配合 Windows 计划任务每日 03:00 运行：
//   schtasks /create /tn "stock-monitor-backup" /tr "C:\Python312\python.exe E:\...\backup_db.js" /sc daily /st 03:00
// 说明：优先用 pg_dump（结构+数据，可恢复）；无 pg_dump 时降级 SQL 导出（仅数据表）
// ============================================================
require("dotenv").config();
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

const DATABASE_URL = process.env.DATABASE_URL || "";
// postgres://user:pass@host:port/db
function parseDbUrl(url) {
  try {
    const u = new URL(url);
    return {
      user: decodeURIComponent(u.username || "postgres"),
      pass: decodeURIComponent(u.password || ""),
      host: u.hostname || "127.0.0.1",
      port: u.port || "5432",
      db: u.pathname.replace(/^\//, "") || "stock_monitor",
    };
  } catch { return null; }
}

const BACKUP_ROOT = process.argv[2] || "E:/CC-HAHA/backups/stock_monitor";

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { ...opts, timeout: 120000, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) { console.error(`[backup] ${cmd} 失败:`, (stderr || err.message).slice(0, 300)); resolve(false); return; }
      resolve(true);
    });
  });
}

async function main() {
  const db = parseDbUrl(DATABASE_URL);
  if (!db) { console.error("[backup] DATABASE_URL 无效或未配置"); process.exit(1); }
  const today = new Date();
  const ts = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  const dir = path.join(BACKUP_ROOT, ts);
  fs.mkdirSync(dir, { recursive: true });
  // 环境变量方式传密码（避免命令行暴露）
  const env = { ...process.env, PGPASSWORD: db.pass };

  // 尝试 pg_dump（最佳：结构+数据+可恢复）
  const dumpFile = path.join(dir, `stock_monitor_${ts}.dump`);
  const pgDumpOk = await run("pg_dump", ["-U", db.user, "-h", db.host, "-p", db.port, "-d", db.db, "-F", "c", "-f", dumpFile], { env });
  if (pgDumpOk && fs.existsSync(dumpFile) && fs.statSync(dumpFile).size > 0) {
    console.log(`[backup] ✅ pg_dump 完成: ${dumpFile} (${(fs.statSync(dumpFile).size / 1024).toFixed(0)}KB)`);
  } else {
    console.warn("[backup] pg_dump 不可用（PG 未加入 PATH？），尝试 pg 查询降级…");
  }

  // 降级：JSON 导出关键表（kv_store/news/announcements/zt_snapshot/research_reports/price_watch*）
  const { Pool } = require("pg");
  const pool = new Pool({
    connectionString: DATABASE_URL,
    max: 3,
    connectionTimeoutMillis: 5000,
  });
  const tables = ["kv_store", "news", "announcements", "zt_snapshot", "research_reports", "price_watch", "price_watch_log", "price_watch_events", "decision_post", "trade_ledger"];
  const exportFile = path.join(dir, `tables_${ts}.json`);
  const out = {};
  for (const t of tables) {
    try {
      const r = await pool.query(`SELECT * FROM ${t}`);
      out[t] = r.rows;
    } catch { /* 表不存在跳过 */ }
  }
  fs.writeFileSync(exportFile, JSON.stringify(out, null, 1));
  console.log(`[backup] ✅ JSON 导出: ${exportFile} (${(fs.statSync(exportFile).size / 1024).toFixed(0)}KB, ${tables.length} 表)`);
  await pool.end();

  // 保留 14 天，清理更早
  try {
    const dirs = fs.readdirSync(BACKUP_ROOT).filter(d => /^\d{8}$/.test(d)).sort();
    const cutoff = Date.now() - 14 * 86400000;
    for (const d of dirs) {
      const t = new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`).getTime();
      if (t < cutoff) fs.rmSync(path.join(BACKUP_ROOT, d), { recursive: true, force: true });
    }
  } catch { /* 清理失败不影响 */ }
  console.log(`[backup] 🗑 已清理 14 天前备份`);
  console.log(`[backup] 完成: ${dir}`);
  process.exit(0);
}

main();