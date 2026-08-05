// ============================================================
// stock-monitor 数据库备份脚本（v9.27 · P0-2 安全修复）
// 替代旧 backup.bat（其中 set PGPASSWORD=明文 已泄露到 GitHub）。
// 本脚本从 server/.env 读取 DATABASE_URL 解析密码，绝不落盘、不入库。
// 用法：node scripts/backup.js   （或直接运行 backup.bat）
// ============================================================
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const cs = process.env.DATABASE_URL;
if (!cs) {
  console.error("[backup] DATABASE_URL 未配置（server/.env）");
  process.exit(1);
}

// postgres://user:pass@host:port/db
const m = cs.match(/^postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(\w+)/);
if (!m) {
  console.error("[backup] 无法解析 DATABASE_URL（格式应为 postgres://user:pass@host:port/db）");
  process.exit(1);
}
const [, user, password, host, port, db] = m;

const PGBIN = process.env.PGBIN || "C:\\Program Files (x86)\\PostgreSQL\\16\\bin";
// 备份目录：项目内 stock-monitor/backups（随项目一起迁移/归档）
const backupDir = path.join(__dirname, "..", "..", "backups");
if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const out = path.join(backupDir, `stock_monitor_${date}.dump`);

try {
  execFileSync(
    path.join(PGBIN, "pg_dump.exe"),
    ["-U", user, "-h", host, "-p", port, "-d", db, "-F", "c", "-f", out],
    { env: { ...process.env, PGPASSWORD: password }, stdio: "inherit" },
  );
  console.log(`[backup] 备份完成: ${out}`);
} catch (e) {
  console.error("[backup] 备份失败:", e.message);
  process.exit(1);
}
