// ============================================================
// src/lib/sources.ts —— 前端数据源注册表（P1-16，与 server/lib/sources.js 同构）
// 前端仅保留"行情/新闻/数据"类 provider（AI/推送域只存在服务端白名单，浏览器不直连）；
// cors 标记浏览器直连能力：jsonp=script 标签可用，cors=fetch 可用，none=必须走 /api/proxy。
// 单一事实来源：jsonpQueue 的 push2→push2delay 域名降级、行情腾讯兜底都从这里查表，
//   不再散落硬编码字符串替换。
// ============================================================

export interface Provider {
  id: string;
  host: string;
  kind: "quote" | "kline" | "data" | "news" | "page";
  priority: number;
  fallbackTo?: string;
  /** 浏览器直连能力：jsonp（script 标签）/ cors（fetch）/ none（必须走服务端代理） */
  connect: "jsonp" | "cors" | "none";
}

export const PROVIDERS: Provider[] = [
  // ---- 东方财富行情族 ----
  { id: "push2",        host: "push2.eastmoney.com",             kind: "quote", priority: 0, fallbackTo: "push2delay", connect: "jsonp" },
  { id: "push2delay",   host: "push2delay.eastmoney.com",        kind: "quote", priority: 1, connect: "jsonp" },
  { id: "push2ex",      host: "push2ex.eastmoney.com",           kind: "quote", priority: 0, connect: "jsonp" },
  { id: "push2his",     host: "push2his.eastmoney.com",          kind: "kline", priority: 0, fallbackTo: "tencentKline", connect: "jsonp" },
  { id: "datacenter",   host: "datacenter-web.eastmoney.com",    kind: "data",  priority: 0, connect: "jsonp" },
  { id: "emappdata",    host: "emappdata.eastmoney.com",         kind: "data",  priority: 0, connect: "cors" },
  // ---- 东财新闻/公告 ----
  { id: "npWeblist",    host: "np-weblist.eastmoney.com",        kind: "news",  priority: 0, connect: "jsonp" },
  { id: "npAnotice",    host: "np-anotice-stock.eastmoney.com",  kind: "news",  priority: 0, connect: "jsonp" },
  // ---- 备用行情（腾讯/同花顺）----
  { id: "tencentQuote", host: "qt.gtimg.cn",                     kind: "quote", priority: 1, connect: "cors" },
  { id: "tencentKline", host: "web.ifzq.gtimg.cn",               kind: "kline", priority: 1, connect: "cors" },
  { id: "ths",          host: "dq.10jqka.com.cn",                kind: "data",  priority: 1, connect: "cors" },
];

const byId = new Map(PROVIDERS.map(p => [p.id, p]));
const byHost = new Map(PROVIDERS.map(p => [p.host, p]));

/** 按 provider id 取 host */
export function hostOf(id: string): string | undefined {
  return byId.get(id)?.host;
}

/** 按 host 查降级目标 host（无则 undefined）—— jsonpQueue 域名 fallback 查表 */
export function fallbackHostFor(host: string): string | undefined {
  const p = byHost.get(host);
  if (!p?.fallbackTo) return undefined;
  return byId.get(p.fallbackTo)?.host;
}
