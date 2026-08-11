// ============================================================
// server/scripts/import_policy_docs.js —— 政策语料库首批导入（T-E1，v9.105.0）
// 抓 gov.cn 五年规划建议全文 → 提取正文 → 入库 policy_docs（幂等：UNIQUE(source_url)）
// 首批：十五五规划建议（gov.cn/zhengce/202510/content_7046050.htm）
//       + 十四五规划建议（gov.cn/zhengce/2020-11/03/content_5556991.htm）对照
// 运行：cd server && node scripts/import_policy_docs.js
// ============================================================
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { Pool } = require("pg");
const https = require("https");

const DOCS = [
  { title: "中共中央关于制定国民经济和社会发展第十五个五年规划的建议", doc_date: "2025-10-23", category: "五年规划建议",
    source_url: "https://www.gov.cn/zhengce/202510/content_7046050.htm" },
  { title: "中共中央关于制定国民经济和社会发展第十四个五年规划和二〇三五年远景目标的建议", doc_date: "2020-11-03", category: "五年规划建议",
    source_url: "https://www.gov.cn/zhengce/2020-11/03/content_5556991.htm" },
];

function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" } }, (r) => {
      if (r.statusCode !== 200) { reject(new Error("HTTP " + r.statusCode)); r.resume(); return; }
      const chunks = [];
      r.on("data", c => chunks.push(c));
      r.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    }).on("error", reject).setTimeout(20000, function () { this.destroy(new Error("timeout")); });
  });
}

/** gov.cn 正文提取：<p> 段拼接（过滤空/样式段） */
function extractBody(html) {
  const ps = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map(m => m[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim())
    .filter(t => t.length >= 8);
  return ps.join("\n").slice(0, 60000);
}

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let ok = 0;
  for (const doc of DOCS) {
    try {
      const html = await fetchHtml(doc.source_url);
      const body = extractBody(html);
      if (body.length < 500) { console.warn(`[import] ${doc.title} 正文过短(${body.length})，跳过`); continue; }
      await pool.query(
        `INSERT INTO policy_docs(title,doc_date,category,content,source_url) VALUES($1,$2,$3,$4,$5)
         ON CONFLICT(source_url) DO NOTHING`,
        [doc.title, doc.doc_date, doc.category, body, doc.source_url],
      );
      console.log(`[import] ${doc.title} 入库 OK（正文 ${body.length} 字）`);
      ok++;
    } catch (e) { console.warn(`[import] ${doc.title} 失败: ${e.message}`); }
  }
  const r = await pool.query("SELECT id,title,doc_date,LENGTH(content) AS len FROM policy_docs ORDER BY id");
  console.log(`policy_docs 共 ${r.rows.length} 篇：`);
  for (const row of r.rows) console.log(`  #${row.id} ${row.title}（${row.doc_date}，${row.len} 字）`);
  await pool.end();
  process.exit(ok > 0 ? 0 : 1);
})().catch(e => { console.error("ERR", e.message); process.exit(1); });
