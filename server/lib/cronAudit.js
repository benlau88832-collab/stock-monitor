// ============================================================
// v9.145.0（P2-5）：cron 表达式静态审计 + checkpoint 健康接口
// ============================================================
const fs = require("fs");
const path = require("path");

function fieldCount(expr) {
  return String(expr || "").trim().split(/\s+/).filter(Boolean).length;
}

function auditCronExpressions() {
  const files = ["server/cron.js", "server/cron/base.js", "server/cron/brain.js", "server/cron/review.js", "server/cron/ledger.js"];
  const out = [];
  for (const rel of files) {
    const abs = path.join(__dirname, "..", "..", rel);
    let src = "";
    try { src = fs.readFileSync(abs, "utf8"); } catch { continue; }
    const re = /cron\.schedule\(\s*(["'`])([^"'`]+)\1/g;
    let m;
    while ((m = re.exec(src))) {
      const expr = m[2];
      const n = fieldCount(expr);
      const risk = n === 6 ? "6字段=秒级首字段，确认是否预期" : n < 5 ? "字段不足" : "5字段=分时日月周，正常";
      out.push({ file: rel, expression: expr, fieldCount: n, risk });
    }
  }
  return out;
}

async function getCronHealth(pool) {
  const expressions = auditCronExpressions();
  let checkpoints = [];
  let last24h = { ok: 0, error: 0, missed: 0 };
  try {
    const r = await pool.query(
      `SELECT task,last_start,last_end,last_status,last_error,updated_at
       FROM cron_checkpoint ORDER BY updated_at DESC LIMIT 200`,
    );
    checkpoints = r.rows;
    last24h.ok = r.rows.filter((x) => x.last_status === "ok").length;
    last24h.error = r.rows.filter((x) => x.last_status === "error").length;
  } catch { /* 表未就绪时返回空 */ }
  return { expressions, checkpoints, last24h, asOf: new Date().toISOString() };
}

module.exports = { auditCronExpressions, getCronHealth };
