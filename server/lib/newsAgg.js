// ============================================================
// server/lib/newsAgg.js —— 跨源资讯聚合（v9.124.0，蓝图 4A T-资讯-1/2）
// 蓝图定位：个股雷达信息透明化——公告(已有) ∪ 个股新闻(新增) ∪ 概念/板块新闻(映射)
//   ∪ 券商研报(后续批次) 全部归入统一资讯流，实体打标后按股票查询。
// 设计：纯函数优先（normalize/mapNewsToEntities 0 token 可单测）；
//   抓取多源候选（emweb F10 主源；search-api 待实测回加白名单后启用），
//   全部失败静默 → 不阻塞既有主链（PG-first 降级链同款姿势）。
// ============================================================
const { getJson } = require("./outbound");

/** 东财 search-api cmsArticleWebOld 个股新闻行 → 统一 item（纯函数；shape 待源验证锁定） */
function normalizeSearchArticle(row, fallbackCode = "") {
  return {
    type: "stock_news",
    source: "search-api",
    code: String(row?.code ?? fallbackCode ?? ""),
    title: String(row?.title ?? "").replace(/<\/?em>/g, ""),
    summary: String(row?.summary ?? row?.content ?? "").replace(/<\/?em>/g, "").slice(0, 200),
    url: String(row?.url ?? ""),
    time: String(row?.date ?? row?.showTime ?? ""),
    impact: null,
  };
}

/** emweb F10 NewsBulletin 行 → 统一 item（纯函数；news/ssbk 双键兼容） */
function normalizeEmwebArticle(row, fallbackCode = "") {
  return {
    type: "stock_news",
    source: "emweb",
    code: String(fallbackCode ?? ""),
    title: String(row?.NOTICE_TITLE ?? row?.title ?? ""),
    summary: String(row?.CONTENT ?? row?.summary ?? "").slice(0, 200),
    url: String(row?.Url ?? row?.url ?? ""),
    time: String(row?.NOTICE_DATE ?? row?.date ?? ""),
    impact: null,
  };
}

/** 财联社电报行 → 统一 item（纯函数；shape 待源验证锁定） */
function normalizeKuaixun(row) {
  const ctime = Number(row?.ctime);
  return {
    type: "kuaixun",
    source: "cls",
    code: "",
    title: String(row?.title ?? row?.content ?? "").slice(0, 120),
    summary: String(row?.content ?? "").slice(0, 200),
    url: String(row?.shareurl ?? row?.url ?? ""),
    time: ctime > 0 ? new Date(ctime * 1000).toISOString().slice(0, 19).replace("T", " ") : "",
    impact: null,
  };
}

/**
 * 资讯 → 概念标签（纯函数，0 token）—— 用全站唯一概念词表（与 themeAnalysis 同源防词根漂移）
 * @param {string} text 标题+摘要
 * @param {Array<{name?:string,label?:string,roots:string[]}>} conceptGroups CONCEPT_GROUPS 词表
 * @returns {string[]} 命中概念组名（前 3 个）
 */
function mapNewsToEntities(text, conceptGroups) {
  const t = String(text ?? "");
  if (!t) return [];
  const hits = [];
  for (const g of conceptGroups ?? []) {
    const roots = g?.roots ?? [];
    if (roots.some((r) => String(r).length >= 2 && t.includes(String(r)))) {
      hits.push(String(g.name ?? g.label ?? roots[0]));
    }
  }
  return hits.slice(0, 3);
}

/** 个股新闻抓取（多源候选，失败降级；网络恢复后实测定主次，全部失败返回 [] 静默） */
async function fetchStockNewsServer(code) {
  const prefix = String(code).startsWith("6") ? "SH" : "SZ";
  // 源1：emweb F10 NewsBulletin（公告+新闻同源，emweb.securities.eastmoney.com 已在白名单 kind=page）
  try {
    const j = await getJson(
      `https://emweb.securities.eastmoney.com/PC_HSF10/NewsBulletin/PageAjax?code=${prefix}${code}&pageSize=10&pageIndex=1`,
      { timeout: 5000, source: "eastmoney" },
    );
    const d = j?.data ?? {};
    const rows = [...(Array.isArray(d.news) ? d.news : []), ...(Array.isArray(d.ssbk) ? d.ssbk : [])];
    const items = rows.map((r) => normalizeEmwebArticle(r, code)).filter((x) => x.title);
    if (items.length) return items;
  } catch { /* 降级下一源 */ }
  // 源2：search-api（关键词搜索；曾被 P1-16 以"废弃"移出白名单 → 实测可用后回加 sources.js 再启用，勿盲加）
  return [];
}

/** 去重 + 落库（同 source+title+time 幂等跳过；返回新入条数） */
async function upsertNewsFeed(pool, items) {
  if (!pool || !Array.isArray(items) || items.length === 0) return 0;
  const { CONCEPT_GROUPS } = require("../../src/shared/concept-groups.js");
  let added = 0;
  for (const it of items) {
    if (!it || !it.title || !it.code) continue;
    try {
      const entities = mapNewsToEntities((it.title ?? "") + (it.summary ?? ""), CONCEPT_GROUPS);
      const r = await pool.query(
        `INSERT INTO news_feed(type,source,code,title,summary,url,impact,entities,time)
         SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9
         WHERE NOT EXISTS (SELECT 1 FROM news_feed WHERE source=$2 AND title=$4 AND time=$9 LIMIT 1)`,
        [it.type ?? "stock_news", it.source, it.code, it.title, it.summary ?? "", it.url ?? "", it.impact ?? null, JSON.stringify(entities), it.time ?? ""],
      );
      added += r.rowCount ?? 0;
    } catch { /* 单条失败不阻塞 */ }
  }
  return added;
}

module.exports = { normalizeSearchArticle, normalizeEmwebArticle, normalizeKuaixun, mapNewsToEntities, fetchStockNewsServer, upsertNewsFeed };
