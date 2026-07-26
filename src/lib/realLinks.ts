// 真实东方财富链接生成器（禁止模拟数据，所有链接可真实跳转）
export function stockRealUrl(code: string): string {
  // 东方财富个股行情页真实格式
  const prefix = code.startsWith("6") || code.startsWith("5") ? "1" : "0";
  const secid = `${prefix}.${code}`;
  return `https://quote.eastmoney.com/${secid}.html`;
}

export function stockNewsUrl(code: string): string {
  const prefix = code.startsWith("6") || code.startsWith("5") ? "1" : "0";
  return `https://quote.eastmoney.com/${prefix}.${code}.html#news`; // 跳转到新闻板块
}

export function boardRealUrl(boardCode: string, boardType: string): string {
  // 板块行情页真实格式
  return `https://quote.eastmoney.com/center/boardlist.html#concept_board`; // 概念板块真实入口
}

export function newsRealUrl(title: string, sourceUrl?: string): string {
  // 如果有真实源URL则直接返回，否则返回东方财富新闻中心
  if (sourceUrl && sourceUrl.startsWith("http")) return sourceUrl;
  return `https://news.eastmoney.com/`; // 东方财富新闻中心真实入口
}

export function indexRealUrl(secid: string, name: string): string {
  // 指数真实页面
  if (secid === "1.000001") return "https://quote.eastmoney.com/unify/r/1.000001";
  if (secid === "0.399001") return "https://quote.eastmoney.com/unify/r/0.399001";
  if (secid === "0.399006") return "https://quote.eastmoney.com/unify/r/0.399006";
  if (secid === "1.000688") return "https://quote.eastmoney.com/unify/r/1.000688";
  if (secid === "1.000300") return "https://quote.eastmoney.com/unify/r/1.000300";
  return `https://quote.eastmoney.com/unify/index.html`;
}

export function globalMarketUrl(market: string): string {
  // 全球市场真实数据源
  if (market.includes("纳斯达克") || market.includes("NASDAQ")) return "https://www.nasdaq.com/";
  if (market.includes("道琼斯") || market.includes("DJI")) return "https://www.marketwatch.com/investing/index/djia";
  if (market.includes("恒生") || market.includes("HSI")) return "https://www.hsi.com.hk/";
  if (market.includes("日经") || market.includes("NIKKEI")) return "https://indexes.nikkei.co.jp/nkave/";
  return "https://quote.eastmoney.com/center/global.html";
}
