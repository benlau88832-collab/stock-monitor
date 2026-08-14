// ============================================================
// v9.145.0（P2-3）：催化剂日历，数据源全部来自本地 SQL
// announcements + research_reports + policy_docs
// ============================================================
const { pool } = require("../db");

const TYPE_RULES = [
  { type: "earnings", re: /业绩|预告|快报|财报|半年报|年报/ },
  { type: "lift_ban", re: /解禁/ },
  { type: "buyback", re: /回购/ },
  { type: "increase", re: /增持/ },
  { type: "decrease", re: /减持/ },
  { type: "incentive", re: /股权激励|限制性股票|期权/ },
  { type: "contract", re: /中标|合同|订单/ },
  { type: "meeting", re: /股东大会|董事会|监事会/ },
  { type: "dividend", re: /分红|派息/ },
];

function typeOf(title) {
  const t = String(title || "");
  for (const rule of TYPE_RULES) if (rule.re.test(t)) return rule.type;
  return "other";
}

async function refreshCatalystCalendar(poolArg = pool) {
  let added = 0;
  const annR = await poolArg.query(
    `SELECT stock_code, stock_name, title, time FROM announcements
     WHERE time ~ $1 ORDER BY time DESC LIMIT 3000`,
    ["^\\d{4}-\\d{2}-\\d{2}"],
  );
  for (const a of annR.rows) {
    const date = String(a.time || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const type = typeOf(a.title);
    if (type === "other") continue;
    try {
      await poolArg.query(
        `INSERT INTO catalyst_calendar(code,name,type,title,event_date,source,status)
         VALUES($1,$2,$3,$4,$5,$6,'scheduled')
         ON CONFLICT DO NOTHING`,
        [String(a.stock_code), a.stock_name, type, a.title, date, "announcements"],
      );
      added++;
    } catch { /* 单条冲突/失败跳过 */ }
  }

  const rR = await poolArg.query(`SELECT code,name,report_date FROM research_reports`);
  for (const r of rR.rows) {
    try {
      await poolArg.query(
        `INSERT INTO catalyst_calendar(code,name,type,title,event_date,source,status)
         VALUES($1,$2,'research',$3,$4,'research_reports','scheduled')
         ON CONFLICT DO NOTHING`,
        [r.code, r.name, `深度调研报告 ${r.report_date}`, r.report_date],
      );
      added++;
    } catch { /* 跳过 */ }
  }

  const pR = await poolArg.query(`SELECT title,doc_date,category FROM policy_docs`);
  for (const p of pR.rows) {
    const date = String(p.doc_date || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    try {
      await poolArg.query(
        `INSERT INTO catalyst_calendar(code,name,type,title,event_date,source,status)
         VALUES($1,$2,'policy',$3,$4,'policy_docs','scheduled')
         ON CONFLICT DO NOTHING`,
        ["MARKET", p.category || "政策", p.title, date],
      );
      added++;
    } catch { /* 跳过 */ }
  }
  return { added };
}

async function getCatalystCalendar(code, days = 180) {
  try {
    const r = await pool.query(
      `SELECT code,name,type,title,event_date,source,status
       FROM catalyst_calendar
       WHERE code=$1 AND event_date >= CURRENT_DATE AND event_date <= CURRENT_DATE + ($2::int)
       ORDER BY event_date ASC, type ASC LIMIT 100`,
      [code, days],
    );
    return r.rows.map((x) => ({ ...x, eventDate: String(x.event_date).slice(0, 10) }));
  } catch { return []; }
}

module.exports = { refreshCatalystCalendar, getCatalystCalendar };
