// ============================================================
// server/lib/sources.js —— 数据源注册表（P1-16 单一事实来源）
// 背景：域名白名单曾在 hostGuard.js / proxy.js / 前端 jsonpQueue 三处重复维护且互不一致
// （proxy 多了 emappdata/ifzq/10jqka，hostGuard 多了 sina/AI/推送域；废弃的 search-api-web 仍在名单）。
// 本表是唯一权威：hostGuard 出站白名单与 proxy 转发白名单都从这里派生；
// fallbackTo 声明 provider 的降级链（push2→push2delay、push2his→tencentKline）。
// ============================================================

const PROVIDERS = [
  // ---- 东方财富行情族 ----
  { id: "push2",        host: "push2.eastmoney.com",             kind: "quote", priority: 0, fallbackTo: "push2delay" },
  { id: "push2delay",   host: "push2delay.eastmoney.com",        kind: "quote", priority: 1 },
  { id: "push2ex",      host: "push2ex.eastmoney.com",           kind: "quote", priority: 0 },
  { id: "push2his",     host: "push2his.eastmoney.com",          kind: "kline", priority: 0, fallbackTo: "tencentKline" },
  { id: "datacenter",   host: "datacenter-web.eastmoney.com",    kind: "data",  priority: 0 },
  { id: "emappdata",    host: "emappdata.eastmoney.com",         kind: "data",  priority: 0 },
  // ---- 东财新闻/公告/页面 ----
  { id: "npWeblist",    host: "np-weblist.eastmoney.com",        kind: "news",  priority: 0 },
  { id: "npAnotice",    host: "np-anotice-stock.eastmoney.com",  kind: "news",  priority: 0 },
  { id: "dataEm",       host: "data.eastmoney.com",              kind: "page",  priority: 0 },
  { id: "quoteEm",      host: "quote.eastmoney.com",             kind: "page",  priority: 0 },
  { id: "emweb",        host: "emweb.securities.eastmoney.com",  kind: "page",  priority: 0 },
  // ---- 备用行情（腾讯/新浪/同花顺）----
  { id: "tencentQuote", host: "qt.gtimg.cn",                     kind: "quote", priority: 1 },
  { id: "tencentKline", host: "web.ifzq.gtimg.cn",               kind: "kline", priority: 1 },
  { id: "sina",         host: "hq.sinajs.cn",                    kind: "quote", priority: 1 },
  { id: "ths",          host: "dq.10jqka.com.cn",                kind: "data",  priority: 1 },
  { id: "thsConcepts",  host: "q.10jqka.com.cn",                 kind: "data",  priority: 1 },
  // ---- 免费大宗商品价格（v9.140.0 阶段三 #13：景气度价格数据源）----
  // 实测：百川盈孚首页 SSR 直出"今日涨跌"81 项可解析；生意社 100ppi.com JS challenge + API 需密钥（blocked，不进白名单）
  { id: "baiinfo",      host: "www.baiinfo.com",                 kind: "data",  priority: 1 },
  // ---- AI 网关（LLM 出站）----
  { id: "agnes",        host: "apihub.agnes-ai.cn",              kind: "ai" },
  { id: "opencode",     host: "opencode.ai",                     kind: "ai" },
  // ---- 推送网关 ----
  { id: "serverchan",   host: "sctapi.ftqq.com",                 kind: "push" },
  { id: "wecom",        host: "qyapi.weixin.qq.com",             kind: "push" },
  { id: "bark",         host: "api.day.app",                     kind: "push" },
  { id: "feishu",       host: "open.feishu.cn",                  kind: "push" },
  { id: "qmsg",         host: "qmsg.zndx.net",                   kind: "push" },
];

const byId = new Map(PROVIDERS.map(p => [p.id, p]));
const byHost = new Map(PROVIDERS.map(p => [p.host, p]));

/** 全部出站白名单（hostGuard 用：任意模块出站都要过） */
function allAllowedHosts() {
  return PROVIDERS.map(p => p.host);
}

/** 前端转发白名单（/api/proxy 用：只放行行情/新闻类，AI/推送域不放行给浏览器） */
function proxyAllowedHosts() {
  return PROVIDERS.filter(p => p.kind !== "ai" && p.kind !== "push").map(p => p.host);
}

/** 按 provider id 取 host */
function hostOf(id) {
  return byId.get(id)?.host;
}

/** 按 host 取 fallback host（无则 undefined）—— jsonpQueue/proxy 域名降级查表 */
function fallbackHostFor(host) {
  const p = byHost.get(host);
  if (!p?.fallbackTo) return undefined;
  return byId.get(p.fallbackTo)?.host;
}

module.exports = { PROVIDERS, allAllowedHosts, proxyAllowedHosts, hostOf, fallbackHostFor };
