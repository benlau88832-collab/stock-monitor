// 真实东方财富链接生成器 - 所有链接经过验证可真实跳转

// 个股行情页 - 使用东方财富统一行情页面格式
export function stockRealUrl(code: string): string {
  // 900开头为沪市B股，不属于北交所，必须用sh前缀（否则会404）
  if (code.startsWith("900")) {
    return `https://quote.eastmoney.com/sh${code}.html`;
  }
  // 200开头为深市B股，用sz前缀
  if (code.startsWith("200")) {
    return `https://quote.eastmoney.com/sz${code}.html`;
  }
  if (code.startsWith("6") || code.startsWith("5")) {
    return `https://quote.eastmoney.com/sh${code}.html`;
  }
  if (code.startsWith("0") || code.startsWith("3")) {
    return `https://quote.eastmoney.com/sz${code}.html`;
  }
  if (code.startsWith("4") || code.startsWith("8") || code.startsWith("9")) {
    return `https://quote.eastmoney.com/bj/${code}.html`;
  }
  return `https://quote.eastmoney.com/sz${code}.html`;
}

// 板块行情页 - 使用东方财富板块详情页
// 注意：东方财富板块页面URL必须带市场前缀"90."，否则会404（如 quote.eastmoney.com/bk/90.BK1277.html）
export function boardRealUrl(boardCode: string, boardType: string): string {
  // 东方财富板块代码格式：BK0xxx
  if (boardCode && boardCode.startsWith("BK")) {
    return `https://quote.eastmoney.com/bk/90.${boardCode}.html`;
  }
  // 如果板块代码不以BK开头，尝试拼接
  if (boardCode && /^\d+$/.test(boardCode)) {
    return `https://quote.eastmoney.com/bk/90.BK${boardCode}.html`;
  }
  // 根据类型回退到对应列表页
  if (boardType === "concept") {
    return "https://quote.eastmoney.com/center/boardlist.html#concept_board";
  }
  if (boardType === "industry") {
    return "https://quote.eastmoney.com/center/boardlist.html#industry_board";
  }
  if (boardType === "region") {
    return "https://quote.eastmoney.com/center/boardlist.html#region_board";
  }
  return "https://quote.eastmoney.com/center/boardlist.html#boards-BK06551";
}

// 指数行情页
export function indexRealUrl(code: string, name?: string): string {
  // 上证指数
  if (code === "000001" && name?.includes("上证")) {
    return "https://quote.eastmoney.com/zs000001.html";
  }
  // 深证成指
  if (code === "399001") return "https://quote.eastmoney.com/zs399001.html";
  // 创业板指
  if (code === "399006") return "https://quote.eastmoney.com/zs399006.html";
  // 科创50
  if (code === "000688") return "https://quote.eastmoney.com/zs000688.html";
  // 沪深300
  if (code === "000300") return "https://quote.eastmoney.com/zs000300.html";
  // 通用指数
  return `https://quote.eastmoney.com/zs${code}.html`;
}

// 新闻链接
export function newsRealUrl(_title: string, sourceUrl?: string): string {
  if (sourceUrl && sourceUrl.startsWith("http")) return sourceUrl;
  return "https://finance.eastmoney.com/";
}

// 全球市场链接
export function globalMarketUrl(name: string): string {
  if (name.includes("纳斯达克")) return "https://quote.eastmoney.com/unify/r/100.NDX";
  if (name.includes("道琼斯")) return "https://quote.eastmoney.com/unify/r/100.DJIA";
  if (name.includes("标普")) return "https://quote.eastmoney.com/unify/r/100.SPX";
  if (name.includes("恒生")) return "https://quote.eastmoney.com/unify/r/100.HSI";
  if (name.includes("日经")) return "https://quote.eastmoney.com/unify/r/100.N225";
  if (name.includes("德国") || name.includes("DAX")) return "https://quote.eastmoney.com/unify/r/100.GDAXI";
  if (name.includes("英国") || name.includes("富时")) return "https://quote.eastmoney.com/unify/r/100.FTSE";
  if (name.includes("澳洲") || name.includes("AS51")) return "https://quote.eastmoney.com/unify/r/100.AS51";
  if (name.includes("韩国") || name.includes("KOSPI")) return "https://quote.eastmoney.com/unify/r/100.KS11";
  if (name.includes("台湾")) return "https://quote.eastmoney.com/unify/r/100.TWII";
  return "https://quote.eastmoney.com/center/gridlist.html#global_0";
}

// 隔夜关联品种链接
export function commodityUrl(name: string): string {
  if (name.includes("美元指数")) return "https://quote.eastmoney.com/unify/r/100.UDI";
  if (name.includes("人民币")) return "https://quote.eastmoney.com/unify/r/133.USDCNH";
  if (name.includes("黄金")) return "https://quote.eastmoney.com/unify/r/101.GC00Y";
  if (name.includes("原油")) return "https://quote.eastmoney.com/unify/r/101.CL00Y";
  if (name.includes("铜")) return "https://quote.eastmoney.com/unify/r/101.HG00Y";
  return "https://quote.eastmoney.com/center/gridlist.html#global_0";
}

// 资金流向详情页
export function fundFlowUrl(): string {
  return "https://data.eastmoney.com/zjlx/detail.html";
}

// 北向资金页面
export function northboundUrl(): string {
  return "https://data.eastmoney.com/hsgt/index.html";
}

// 涨跌统计页面
export function marketBreadthUrl(): string {
  return "https://quote.eastmoney.com/center/gridlist.html#hs_a_board";
}
