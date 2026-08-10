// ============================================================
// 概念白名单接入（v9.91.0 概念地基 + v9.91.3 数据源统一）
// v9.91.3（数据源统一）：数据源从同花顺 q.10jqka.com.cn（361 概念，GBK 页面抓取）切换为
//   东方财富 clist 接口（504 概念全量，push2delay 分页）—— 个股概念数据本身就是东财 F10
//   （BOARD_NAME），白名单必须与之一致，避免双体系命名打架（人脑工程 vs 脑机接口类）。
// 职责：抓取概念列表 → 落库 PG concept_whitelist（全站题材白名单）；
//       前端 isThemeBoard 白名单化判定 + 服务端 stockConcepts 过滤共用此表。
// 刷新策略：表空 或 最后更新 >24h → 重抓（懒加载，路由首调时触发）
// ============================================================
const { getJson } = require("./outbound");

// 概念板块全量：fs=m:90+t:3（东财概念板块），fid=f12（按代码排序稳定分页），f12=BK 代码、f14=板块名
const CLIST_URL = "https://push2delay.eastmoney.com/api/qt/clist/get?pn={pn}&pz=100&po=1&np=1&fltt=2&invt=2&fid=f12&fs=m:90+t:3&fields=f12,f14";
const REFRESH_MS = 24 * 3600 * 1000; // 24h
const TOTAL_PAGES = 6; // 504 概念 / 每页 100 → 6 页（实测 pz 上限 100，pn=1..6 全量无缺口）

/** 抓取东财概念板块全量列表（6 页 × 100，失败抛错调用方降级） */
async function fetchConceptList() {
  const items = [];
  const seen = new Set();
  for (let pn = 1; pn <= TOTAL_PAGES; pn++) {
    const url = CLIST_URL.replace("{pn}", String(pn));
    // v9.86.0（P2-7）：统一出站客户端（hostGuard 白名单含 push2delay）
    const r = await getJson(url, { timeout: 6000, source: "push2delay" });
    const rows = r.data?.data?.diff ?? [];
    for (const row of rows) {
      const code = String(row.f12 ?? "").trim();   // BKxxxx 板块代码
      const name = String(row.f14 ?? "").trim();   // 板块名（如"光刻胶""鸡肉概念"）
      if (!code || !name || seen.has(code)) continue;
      seen.add(code);
      items.push({ code, name });
    }
    if (rows.length < 100) break; // 提前结束（数据不足 100 时）
  }
  if (items.length === 0) throw new Error("东财概念列表解析为空");
  return items;
}

/** 建表（幂等） */
async function ensureTable(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS concept_whitelist (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source TEXT DEFAULT 'em',
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
          `INSERT INTO concept_whitelist(code, name, source, updated_at) VALUES($1,$2,'em',now())
           ON CONFLICT(code) DO UPDATE SET name=$2, source='em', updated_at=now()`,
          [it.code, it.name],
        );
      }
      await client.query("COMMIT");
    } catch (e) { await client.query("ROLLBACK"); throw e; }
    finally { client.release(); }
    return { refreshed: true, count: items.length };
  } catch (e) {
    console.warn("[conceptWhitelist] 东财概念白名单刷新失败:", e.message);
    return { refreshed: false, count: null, error: e.message };
  }
}

/** 读全量白名单 → [{code, name}]（按 updated_at 倒序，新概念在前） */
async function getConceptWhitelist(pool) {
  await ensureTable(pool);
  const r = await pool.query("SELECT code, name FROM concept_whitelist ORDER BY updated_at DESC, code");
  return r.rows.map(x => ({ code: x.code, name: x.name }));
}

module.exports = { fetchConceptList, ensureConceptWhitelist, getConceptWhitelist, CLIST_URL };
