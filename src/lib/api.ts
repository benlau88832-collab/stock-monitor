// 东方财富公开数据接口封装层 - 前端直接调用
// 由于跨域限制，使用JSONP方式或通过公开push2接口获取数据

const PUSH2 = "https://push2.eastmoney.com/api/qt";
const PUSH2HIS = "https://push2his.eastmoney.com/api/qt";

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// 东方财富API的diff字段可能是数组也可能是对象，统一转为数组
function normalizeDiff(raw: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") return Object.values(raw);
  return [];
}

// JSONP请求封装（callbackParam 可指定回调参数名，不同接口要求不同，如 "cb" 或 "callback"）
function jsonp<T = unknown>(url: string, timeout = 10000, callbackParam = "cb"): Promise<T> {
  return new Promise((resolve, reject) => {
    const callbackName = `jsonp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement("script");
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("JSONP timeout"));
    }, timeout);

    function cleanup() {
      clearTimeout(timer);
      delete (window as unknown as Record<string, unknown>)[callbackName];
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    (window as unknown as Record<string, unknown>)[callbackName] = (data: T) => {
      cleanup();
      resolve(data);
    };

    const separator = url.includes("?") ? "&" : "?";
    script.src = `${url}${separator}${callbackParam}=${callbackName}&_=${Date.now()}`;
    script.onerror = () => {
      cleanup();
      reject(new Error("JSONP load error"));
    };
    document.head.appendChild(script);
  });
}

// ============== 指数概览 ==============
export const MAJOR_INDICES = [
  { secid: "1.000001", name: "上证指数", code: "000001" },
  { secid: "0.399001", name: "深证成指", code: "399001" },
  { secid: "0.399006", name: "创业板指", code: "399006" },
  { secid: "1.000688", name: "科创50", code: "000688" },
  { secid: "1.000300", name: "沪深300", code: "000300" },
];

export interface IndexQuote {
  code: string;
  name: string;
  price: number;
  pct: number;
  change: number;
}

export async function fetchIndexOverview(): Promise<IndexQuote[]> {
  const secids = MAJOR_INDICES.map((i) => i.secid).join(",");
  const url = `${PUSH2}/ulist.np/get?fltt=2&fields=f2,f3,f4,f12,f14&secids=${secids}`;
  const json = await jsonp<any>(url);
  const diff = normalizeDiff(json?.data?.diff);
  return diff.map((d: Record<string, unknown>) => ({
    code: String(d.f12 ?? ""),
    name: String(d.f14 ?? ""),
    price: num(d.f2),
    pct: num(d.f3),
    change: num(d.f4),
  }));
}

// ============== 全市场涨跌家数（修正版） ==============
export interface MarketBreadth {
  total: number;
  up: number;
  down: number;
  flat: number;
  limitUp: number;
  limitDown: number;
  avgPct: number;
}

// 并行获取所有A股涨跌数据（关键修复：1.处理diff可能是对象而非数组的情况 2.保证total与up+down+flat内部一致 3.板块并行请求避免超时级联拖慢 4.按板块区分涨跌停幅度）
export async function fetchMarketBreadth(): Promise<MarketBreadth> {
  // 沪深全部A股 - 各板块分别获取以确保完整
  // 涨跌停幅度（2025年7月新规后，各板块ST/*ST股票涨跌幅已与该板块普通股统一，无需再单独区分）：
  // 主板±10%；创业板/科创板±20%；北交所±30%
  const segments: Array<{ fs: string; limitPct: number }> = [
    { fs: "m:0+t:6", limitPct: 10 },     // 深圳主板
    { fs: "m:0+t:80", limitPct: 20 },    // 创业板
    { fs: "m:1+t:2", limitPct: 10 },     // 上海主板
    { fs: "m:1+t:23", limitPct: 20 },    // 科创板
    { fs: "m:0+t:81+s:2048", limitPct: 30 }, // 北交所
  ];

  // 单个板块的抓取逻辑，返回该板块实际抓取到的个股列表（可能因超时/异常而不完整，但至少内部一致）
  async function fetchSegment(seg: { fs: string; limitPct: number }): Promise<Array<{ pct: number; price: number; limitPct: number }>> {
    const stocks: Array<{ pct: number; price: number; limitPct: number }> = [];
    let page = 1;
    while (true) {
      const url = `${PUSH2}/clist/get?pn=${page}&pz=5000&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${seg.fs}&fields=f2,f3,f12`;
      try {
        const json = await jsonp<any>(url, 15000);
        const rawDiff = json?.data?.diff;
        let diff: Array<Record<string, unknown>> = [];
        if (Array.isArray(rawDiff)) {
          diff = rawDiff;
        } else if (rawDiff && typeof rawDiff === "object") {
          diff = Object.values(rawDiff);
        }

        if (diff.length === 0) break;

        for (const d of diff) {
          const pct = num(d.f3);
          const price = num(d.f2);
          if (price > 0) {
            stocks.push({ pct, price, limitPct: seg.limitPct });
          }
        }

        if (diff.length < 5000) break;
        page++;
        if (page > 3) break;
      } catch {
        break;
      }
    }
    return stocks;
  }

  // 各板块并行请求，互不阻塞，减少整体超时风险
  const results = await Promise.allSettled(segments.map(fetchSegment));
  const allStocks: Array<{ pct: number; price: number; limitPct: number }> = [];
  for (const r of results) {
    if (r.status === "fulfilled") allStocks.push(...r.value);
  }

  let up = 0, down = 0, flat = 0, limitUp = 0, limitDown = 0, sum = 0;
  for (const s of allStocks) {
    const pct = s.pct;
    sum += pct;
    if (pct > 0) up++;
    else if (pct < 0) down++;
    else flat++;
    // 涨跌停判断：按所属板块动态取幅度阈值，留0.2%误差余量（数据精度/四舍五入）
    if (pct >= s.limitPct - 0.2) limitUp++;
    if (pct <= -(s.limitPct - 0.2)) limitDown++;
  }

  // 关键修复：total 必须与 up+down+flat 的实际来源保持一致，避免出现"总数4440但涨跌家数只加起来400"这类自相矛盾的展示
  const total = allStocks.length;

  return {
    total,
    up,
    down,
    flat,
    limitUp,
    limitDown,
    avgPct: allStocks.length ? sum / allStocks.length : 0,
  };
}

// ============== 全球市场指数 ==============
export const GLOBAL_INDICES = [
  { secid: "100.NDX", name: "纳斯达克100" },
  { secid: "100.DJIA", name: "道琼斯工业指数" },
  { secid: "100.SPX", name: "标普500" },
  { secid: "100.HSI", name: "恒生指数" },
  { secid: "100.N225", name: "日经225" },
  { secid: "100.GDAXI", name: "德国DAX" },
  { secid: "100.FTSE", name: "英国富时100" },
  { secid: "100.AS51", name: "澳洲标普200" },
];

export interface GlobalIndex {
  name: string;
  price: number;
  pct: number;
  change: number;
}

export async function fetchGlobalIndices(): Promise<GlobalIndex[]> {
  try {
    const secids = GLOBAL_INDICES.map((i) => i.secid).join(",");
    const url = `${PUSH2}/ulist.np/get?fltt=2&fields=f2,f3,f4,f12,f14&secids=${secids}`;
    const json = await jsonp<any>(url, 10000);
    const diff = normalizeDiff(json?.data?.diff);
    return diff.map((d) => {
      const code = String(d.f12 ?? "");
      const match = GLOBAL_INDICES.find((g) => g.secid.includes(code));
      return {
        name: match?.name || String(d.f14 ?? code),
        price: num(d.f2),
        pct: num(d.f3),
        change: num(d.f4),
      };
    });
  } catch {
    return [];
  }
}

// ============== 沪深两市成交额 ==============
export async function fetchMarketTurnover(): Promise<{ amount: number; available: boolean }> {
  try {
    const url = `${PUSH2}/ulist.np/get?fltt=2&fields=f2,f3,f12,f14,f6&secids=1.000001,0.399001`;
    const json = await jsonp<any>(url, 6000);
    const diff = normalizeDiff(json?.data?.diff);
    let totalAmount = 0;
    for (const d of diff) {
      totalAmount += num(d.f6);
    }
    return { amount: totalAmount, available: totalAmount > 0 };
  } catch {
    return { amount: 0, available: false };
  }
}

// ============== 市场主力资金结构 ==============
export interface MarketFundData {
  mainNet: number;
  extraLargeNet: number;
  largeNet: number;
  mediumNet: number;
  smallNet: number;
  mainNet5d: number;
  mainNet10d: number;
}

export async function fetchMarketMainFund(): Promise<MarketFundData> {
  const url = `${PUSH2}/ulist.np/get?fltt=2&fields=f2,f3,f12,f14,f62,f66,f69,f72,f75,f78,f81,f84,f87,f164,f165,f174,f175,f184&secids=1.000001,0.399001`;
  const json = await jsonp<any>(url);
  const diff = normalizeDiff(json?.data?.diff);
  const agg: MarketFundData = {
    mainNet: 0,
    extraLargeNet: 0,
    largeNet: 0,
    mediumNet: 0,
    smallNet: 0,
    mainNet5d: 0,
    mainNet10d: 0,
  };
  for (const d of diff) {
    agg.mainNet += num(d.f62);
    agg.extraLargeNet += num(d.f66);
    agg.largeNet += num(d.f72);
    agg.mediumNet += num(d.f78);
    agg.smallNet += num(d.f84);
    agg.mainNet5d += num(d.f164);
    agg.mainNet10d += num(d.f174);
  }
  return agg;
}

// ============== 板块资金流 ==============
export interface BoardFlowItem {
  code: string;
  name: string;
  pct: number;
  mainNet: number;
  extraLargeNet: number;
  largeNet: number;
  mediumNet: number;
  smallNet: number;
  mainNetPct: number;
  mainNet5d: number;
  mainNet5dPct: number;
  mainNet10d: number;
  mainNet10dPct: number;
  boardType: string;
}

const BOARD_FS: Record<string, string> = {
  region: "m:90+t:1",
  industry: "m:90+t:2",
  concept: "m:90+t:3",
};

export async function fetchBoardFundFlow(
  boardType: "industry" | "concept" | "region",
  limit = 15,
): Promise<BoardFlowItem[]> {
  const fs = BOARD_FS[boardType];
  const fields = "f12,f14,f3,f62,f66,f72,f78,f84,f164,f165,f174,f175,f184";
  const url = `${PUSH2}/clist/get?pn=1&pz=${limit}&po=1&np=1&fltt=2&invt=2&fid=f62&fs=${fs}&fields=${fields}`;
  const json = await jsonp<any>(url);
  const diff = normalizeDiff(json?.data?.diff);
  return diff.map((d) => ({
    code: String(d.f12 ?? ""),
    name: String(d.f14 ?? ""),
    pct: num(d.f3),
    mainNet: num(d.f62),
    extraLargeNet: num(d.f66),
    largeNet: num(d.f72),
    mediumNet: num(d.f78),
    smallNet: num(d.f84),
    mainNetPct: num(d.f184),
    mainNet5d: num(d.f164),
    mainNet5dPct: num(d.f165),
    mainNet10d: num(d.f174),
    mainNet10dPct: num(d.f175),
    boardType,
  }));
}

// ============== 板块成分股 ==============
export interface BoardStock {
  code: string;
  name: string;
  price: number;
  pct: number;
  mainNet: number;
  mainNetPct: number;
  extraLargeNet: number;
  mediumNet: number;
  smallNet: number;
  turnoverRate: number;
  pe: number;
  volumeRatio: number;
}

export async function fetchBoardConstituents(boardCode: string, limit = 10): Promise<BoardStock[]> {
  const fields = "f12,f14,f2,f3,f62,f66,f72,f78,f84,f184,f8,f9,f10";
  const url = `${PUSH2}/clist/get?pn=1&pz=${limit}&po=1&np=1&fltt=2&invt=2&fid=f62&fs=b:${boardCode}&fields=${fields}`;
  const json = await jsonp<any>(url);
  const diff = normalizeDiff(json?.data?.diff);
  return diff.map((d) => ({
    code: String(d.f12 ?? ""),
    name: String(d.f14 ?? ""),
    price: num(d.f2),
    pct: num(d.f3),
    mainNet: num(d.f62),
    mainNetPct: num(d.f184),
    extraLargeNet: num(d.f66),
    mediumNet: num(d.f78),
    smallNet: num(d.f84),
    turnoverRate: num(d.f8),
    pe: num(d.f9),
    volumeRatio: num(d.f10),
  }));
}

// ============== 个股查询 ==============
export function marketPrefix(code: string): "0" | "1" {
  if (/^(60|68|90|110|113|118|132|204)/.test(code)) return "1";
  if (/^5/.test(code)) return "1";
  return "0";
}

export function toSecid(code: string): string {
  return `${marketPrefix(code)}.${code}`;
}

// 按股票代码判断所属板块的涨跌停幅度（2025年7月新规后ST股与所属板块普通股涨跌幅一致，无需单独区分）
// 主板（60/00开头）±10%；创业板（30开头）/科创板（68开头）±20%；北交所（8/4/92开头）±30%
export function stockLimitPct(code: string): number {
  if (code.startsWith("30") || code.startsWith("68")) return 20;
  if (code.startsWith("8") || code.startsWith("4") || code.startsWith("92")) return 30;
  return 10;
}

export async function fetchStockOne(code: string) {
  const secid = toSecid(code);
  const fields = "f2,f3,f12,f14,f8,f9,f10,f62,f66,f69,f72,f75,f78,f81,f84,f87,f164,f165,f174,f175,f184";
  const url = `${PUSH2}/ulist.np/get?fltt=2&fields=${fields}&secids=${secid}`;
  const json = await jsonp<any>(url);
  const diff = normalizeDiff(json?.data?.diff);
  if (!diff.length) return null;
  const d = diff[0];
  return {
    code: String(d.f12 ?? ""),
    name: String(d.f14 ?? ""),
    price: num(d.f2),
    pct: num(d.f3),
    mainNet: num(d.f62),
    mainNetPct: num(d.f184),
    extraLargeNet: num(d.f66),
    largeNet: num(d.f72),
    mediumNet: num(d.f78),
    smallNet: num(d.f84),
    mainNet5d: num(d.f164),
    mainNet5dPct: num(d.f165),
    mainNet10d: num(d.f174),
    mainNet10dPct: num(d.f175),
    turnoverRate: num(d.f8),
    pe: num(d.f9),
    volumeRatio: num(d.f10),
  };
}

// ============== 资金快照历史（真实数据：东方财富大盘资金流历史K线接口） ==============
export interface FundSnapshot {
  date: string;
  mainNet: number;
  extraLargeNet: number;
  largeNet: number;
  mediumNet: number;
  smallNet: number;
  mainNet5d: number;
  mainNet10d: number;
}

// 东方财富"数据中心-资金流向-大盘"历史日K线接口（真实数据，非模拟）
// 参考：http://data.eastmoney.com/zjlx/dpzjlx.html
// klines每行格式：日期,主力净额,小单净额,中单净额,大单净额,超大单净额,...(占比等字段)
export async function fetchMarketFundHistory(days = 30): Promise<FundSnapshot[]> {
  const fields2 = "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65";
  const url = `${PUSH2HIS}/stock/fflow/daykline/get?lmt=${days}&klt=101&secid=1.000001&secid2=0.399001&fields1=f1,f2,f3,f7&fields2=${fields2}`;
  try {
    const json = await jsonp<any>(url, 10000);
    const klines: string[] = json?.data?.klines ?? [];
    const parsed: FundSnapshot[] = klines.map((line) => {
      const p = line.split(",");
      return {
        date: p[0],
        mainNet: num(p[1]),
        smallNet: num(p[2]),
        mediumNet: num(p[3]),
        largeNet: num(p[4]),
        extraLargeNet: num(p[5]),
        mainNet5d: 0,
        mainNet10d: 0,
      };
    });
    // 用真实每日主力净额滚动求和，得到近5日/近10日主力净流入（真实计算，非随机）
    const withRolling = parsed.map((item, idx) => {
      const window5 = parsed.slice(Math.max(0, idx - 4), idx + 1);
      const window10 = parsed.slice(Math.max(0, idx - 9), idx + 1);
      return {
        ...item,
        mainNet5d: window5.reduce((s, x) => s + x.mainNet, 0),
        mainNet10d: window10.reduce((s, x) => s + x.mainNet, 0),
      };
    });
    // 最新日期排在最前面，供表格/图表展示
    return withRolling.sort((a, b) => b.date.localeCompare(a.date));
  } catch {
    return [];
  }
}

// ============== 实时快讯（东方财富7x24全球直播，真实滚动数据） ==============
export interface FastNewsItem {
  code: string;
  title: string;
  summary: string;
  time: string; // "YYYY-MM-DD HH:mm:ss"
  url: string;
}

// 东方财富快讯详情页真实链接格式：finance.eastmoney.com/a/{code}.html（已实测验证可访问）
export function newsDetailUrl(code: string): string {
  return `https://finance.eastmoney.com/a/${code}.html`;
}

// 东方财富"7x24全球直播"快讯接口（与 kuaixun.eastmoney.com 首页同源，真实滚动更新）
// 注意：该接口的JSONP回调参数名为 callback（不是cb），否则不会包裹返回值
export async function fetchFastNews(pageSize = 20): Promise<FastNewsItem[]> {
  const url = `https://np-weblist.eastmoney.com/comm/web/getFastNewsList?client=web&biz=web_724&fastColumn=102&sortEnd=&pageSize=${pageSize}&req_trace=${Date.now()}`;
  try {
    const json = await jsonp<any>(url, 10000, "callback");
    const list: any[] = json?.data?.fastNewsList ?? [];
    return list.map((item) => ({
      code: String(item.code ?? ""),
      title: String(item.title ?? item.summary ?? ""),
      summary: String(item.summary ?? ""),
      time: String(item.showTime ?? ""),
      url: newsDetailUrl(String(item.code ?? "")),
    }));
  } catch {
    return [];
  }
}
