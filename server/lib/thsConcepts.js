// ============================================================
// 同花顺概念库接入（v9.91.0 概念地基）
// 数据源：q.10jqka.com.cn/gn/（概念列表页，GBK 编码，单页全量 ~361 个概念）
// 职责：抓取概念列表 → 落库 PG concept_whitelist（全站题材白名单）；
//       前端 isThemeBoard 白名单化判定 + 服务端 stockConcepts 过滤共用此表。
// 刷新策略：表空 或 最后更新 >24h → 重抓（懒加载，路由首调时触发）
// ============================================================
const https = require("https");
const { assertHostAllowed } = require("./hostGuard");

const CONCEPT_LIST_URL = "https://q.10jqka.com.cn/gn/";
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const REFRESH_MS = 24 * 3600 * 1000; // 24h
const FETCH_TIMEOUT = 10000;

/** 抓取概念列表页原始 Buffer（GBK 页面不可经 requestRaw 的 utf8 解码，这里自取 Buffer） */
function fetchRaw(url, timeout = FETCH_TIMEOUT) {
  return new Promise((resolve, reject) => {
    assertHostAllowed(url);
    const u = new URL(url);
    const req = https.request(u, {
      method: "GET",
      headers: { "User-Agent": BROWSER_UA, Referer: "https://q.10jqka.com.cn/" },
    }, r => {
      const chunks = [];
      r.on("data", c => chunks.push(c));
      r.on("end", () => {
        if (r.statusCode && (r.statusCode < 200 || r.statusCode >= 300)) {
          reject(new Error(`http ${r.statusCode}`));
          return;
        }
        resolve(Buffer.concat(chunks));
      });
    });
    req.on("error", reject);
    req.setTimeout(timeout, () => { req.destroy(new Error("upstream timeout")); });
    req.end();
  });
}

/** 解析概念列表页 HTML → [{code, name}]（GBK → UTF-8） */
function parseConceptList(buf) {
  const html = new TextDecoder("gbk").decode(buf);
  const items = [];
  const seen = new Set();
  // <a href="http://q.10jqka.com.cn/gn/detail/code/309183/" target="_blank">AI智能体</a>
  const re = /\/gn\/detail\/code\/(\d+)\/"[^>]*>([^<]+)<\/a>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const code = m[1];
    const name = m[2].trim();
    if (!code || !name || seen.has(code)) continue;
    seen.add(code);
    items.push({ code, name });
  }
  return items;
}

/** 抓取同花顺概念全量列表（失败抛错，调用方降级） */
async function fetchConceptList() {
  const buf = await fetchRaw(CONCEPT_LIST_URL);
  const items = parseConceptList(buf);
  if (items.length === 0) throw new Error("同花顺概念列表解析为空");
  return items;
}

/** 建表（幂等） */
async function ensureTable(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS concept_whitelist (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source TEXT DEFAULT 'ths',
    updated_at TIMESTAMPTZ DEFAULT now()
  )`);
}

/** 检查是否需要刷新（表空 或 最后更新 >24h）→ 需要则抓取落库 */
async function ensureConceptWhitelist(pool, { force = false } = {}) {
  await ensureTable(pool);
  if (!force) {
    const r = await pool.query("SELECT max(updated_at) AS t FROM concept_whitelist");
    const last = r.rows[0]?.t ? new Date(r.rows[0].t).getTime() : 0;
    if (last > 0 && Date.now() - last < REFRESH_MS) return { refreshed: false, count: null };
  }
  try {
    const items = await fetchConceptList();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const it of items) {
        await client.query(
          `INSERT INTO concept_whitelist(code, name, source, updated_at) VALUES($1,$2,'ths',now())
           ON CONFLICT(code) DO UPDATE SET name=$2, updated_at=now()`,
          [it.code, it.name],
        );
      }
      await client.query("COMMIT");
    } catch (e) { await client.query("ROLLBACK"); throw e; }
    finally { client.release(); }
    return { refreshed: true, count: items.length };
  } catch (e) {
    console.warn("[thsConcepts] 概念白名单刷新失败:", e.message);
    return { refreshed: false, count: null, error: e.message };
  }
}

/** 读全量白名单 → [{code, name}]（按 updated_at 倒序，新概念在前） */
async function getConceptWhitelist(pool) {
  await ensureTable(pool);
  const r = await pool.query("SELECT code, name FROM concept_whitelist ORDER BY updated_at DESC, code");
  return r.rows.map(x => ({ code: x.code, name: x.name }));
}

module.exports = { fetchConceptList, parseConceptList, ensureConceptWhitelist, getConceptWhitelist, CONCEPT_LIST_URL };
