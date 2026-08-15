// ============================================================
// server/lib/webSearch.js —— 外网信息搜索层（任务 03，v9.148.0）
// 目标：给产业链简报引擎"向外挖"的腿 —— 按关键词搜索外网公开信息，
//       英文原发优先，多源聚合（当前主源 Google News RSS，无限额免 key）。
// 链路：requestRaw(url, { viaProxy: true }) 经本地代理（127.0.0.1:7897）出墙。
//   注意：viaProxy 依赖 httpProxy.PROXY_AGENT 导出（v9.148.0 修复：此前未导出恒直连）。
// 输出：searchWeb(keyword, {days, lang}) → [{title, url, source, time, authoritative, lang}]
// ============================================================
const { requestRaw, getJson } = require("./outbound");

// 权威源判定名单（≥2 独立来源且 ≥1 权威源 → "已验证"的验证规则用）
// 覆盖：头部财经媒体/行业研究/官方机构（英文原发优先）
const AUTHORITATIVE_HINTS = [
  "reuters", "bloomberg", "cnbc", "ft.com", "wsj", "marketwatch", "bbc",
  "axios", "nikkei", "trendforce", "digitimes", "semianalysis", "tomsguide",
  "tomshardware", "anandtech", "eejournal", "eetimes", "semiengineering",
  "smm", "metalbulletin", "argusmedia", "fastmarkets", "kitco", "mining",
  "usgs", "lme", "worldbank", "imf", "tradingeconomics", "spglobal",
  "fitchratings", "moodys", "iea", "semi.org", "gov", "exchange", "cmegroup",
];

/** 解析 Google News RSS XML → 结构化条目；source 取 <source> 标签（无则取域名） */
function parseRSS(xml) {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  return items.map((it) => {
    const g = (re) => (it.match(re) || ["", ""])[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim();
    const title = g(/<title>([\s\S]*?)<\/title>/);
    const link = g(/<link>([\s\S]*?)<\/link>/);
    const source = g(/<source[^>]*>([\s\S]*?)<\/source>/);
    const pubDate = g(/<pubDate>([\s\S]*?)<\/pubDate>/);
    let src = source;
    if (!src && link) { try { src = new URL(link).hostname.replace(/^www\./, ""); } catch { /* keep */ } }
    // 归一化匹配：源名可能带空格/撇号（如 "Tom's Hardware"），统一去非字母数字再比对
    const low = String(src).toLowerCase().replace(/[^a-z0-9]/g, "");
    return {
      title,
      url: link,
      source: src,
      time: pubDate,
      authoritative: AUTHORITATIVE_HINTS.some((a) => low.includes(a.replace(/[^a-z0-9]/g, ""))),
      lang: "en",
    };
  }).filter((x) => x.title && x.url);
}

/** 按时间窗构造 Google News RSS 查询（tbs=qdr:dN 近 N 天；qdr:w 近一周；qdr:m 近一月） */
function googleNewsUrl(keyword, days, lang) {
  const zh = lang === "zh";
  const q = `${keyword}${days > 0 ? ` when:${days}d` : ""}`;
  return "https://news.google.com/rss/search?q=" + encodeURIComponent(q)
    + (zh
      ? "&hl=zh-CN&gl=CN&ceid=CN:zh-Hans"
      : "&hl=en-US&gl=US&ceid=US:en")
    + (days > 0 ? `&tbs=qdr:d${Math.min(days, 30)}` : "");
}

/** 备源：Hacker News Algolia（国内直连可用，无 key 无限额，技术/产业讨论一手聚合）。
 * 返回条目语义与 Google News 一致；HN 无媒体源名，source 取域名。
 * @param {object} [deps._getJson] 测试注入（默认 outbound.getJson）
 */
async function searchHackerNews(keyword, opts = {}, deps = {}) {
  const { days = 7, timeout = 12000 } = opts;
  const getJsonFn = deps._getJson || getJson;
  const fromTs = Math.floor(Date.now() / 1000) - days * 86400;
  const url = "https://hn.algolia.com/api/v1/search?query=" + encodeURIComponent(keyword)
    + "&tags=story&hitsPerPage=20&numericFilters=created_at_i>" + fromTs;
  const { data } = await getJsonFn(url, { timeout, source: "hnAlgolia" });
  const hits = Array.isArray(data?.hits) ? data.hits : [];
  return hits.filter((h) => h.title && (h.url || h.story_text)).map((h) => ({
    title: String(h.title).trim(),
    url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
    source: h.url ? safeHost(h.url) : "news.ycombinator.com",
    time: h.created_at ? new Date(h.created_at).toUTCString() : "",
    authoritative: false,
    lang: "en",
  }));
}

function safeHost(u) {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return "unknown"; }
}

/**
 * 关键词搜索（主源 Google News RSS 经代理 → 失败降级 HN Algolia 直连）。
 * @param {string} keyword 关键词（支持中英文）
 * @param {object} opts { days=7, lang='en', timeout=15000 }
 * @returns {Promise<Array<{title,url,source,time,authoritative,lang}>>}
 */
async function searchWeb(keyword, opts = {}) {
  try {
    return await searchGoogleNews(keyword, opts);
  } catch (e) {
    // 主源失败（代理不可用/超时）→ 备源直连
    return searchHackerNews(keyword, { days: opts.days ?? 7 });
  }
}

/** 主源：Google News RSS（经代理出墙，无限额免 key，英文原发信息质量最高）
 * @param {object} [deps._requestRaw] 测试注入（默认 outbound.requestRaw）
 */
async function searchGoogleNews(keyword, opts = {}, deps = {}) {
  const { days = 7, lang = "en", timeout = 15000 } = opts;
  const requestRawFn = deps._requestRaw || requestRaw;
  const url = googleNewsUrl(keyword, days, lang);
  const r = await requestRawFn(url, { timeout, viaProxy: true });
  if (r.status && (r.status < 200 || r.status >= 300)) {
    throw new Error(`http ${r.status}`);
  }
  const items = parseRSS(r.body);
  // 去重（Google News 同题多源转载按 title 归一化）
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const key = it.title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, "").slice(0, 60);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ ...it, lang });
  }
  return out;
}

module.exports = { searchWeb, searchGoogleNews, searchHackerNews, parseRSS, AUTHORITATIVE_HINTS };
