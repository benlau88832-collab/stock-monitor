// 东方财富公开数据接口封装层 - 前端直接调用
// 由于跨域限制，使用JSONP方式或通过公开push2接口获取数据

const PUSH2 = "https://push2.eastmoney.com/api/qt";
const PUSH2HIS = "https://push2his.eastmoney.com/api/qt";
// 公开访问令牌（东方财富push2接口的通用ut参数，各类第三方抓取工具均携带此固定值，
// 补上后可降低接口因缺少常规参数而返回不完整/异常数据的概率）
const EM_UT = "bd1d9ddb04089700cf9c27f6f7426281";

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
  const url = `${PUSH2}/ulist.np/get?ut=${EM_UT}&fltt=2&fields=f2,f3,f4,f12,f14&secids=${secids}`;
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

// 全市场涨跌家数（关键修复：改用东方财富指数官方自带的涨跌家数统计字段 f104/f105/f106，
// 这与东方财富网站每个行情页顶部"上证：X 涨:A 平:B 跌:C"展示的数字完全同源、由交易所侧
// 实时统计好返回，不依赖前端自行翻页抓取全市场几千只个股再计数——旧方案在网络不稳定/接口
// 分页限流时容易出现漏抓，导致"总数4440但涨跌加起来只有400"这类自相矛盾的错误数字。
// 覆盖范围：上证指数(沪市全部，含主板+科创板) + 深证成指(深市全部，含主板+创业板) + 北证50(北交所)，
// 三者合计即为沪深北全市场股票，与"数据来源：沪深主板+创业板+科创板+北交所"的口径一致。
const BREADTH_SECIDS = ["1.000001", "0.399001", "0.899050"];

export async function fetchMarketBreadth(): Promise<MarketBreadth> {
  const url = `${PUSH2}/ulist.np/get?ut=${EM_UT}&fltt=2&fields=f2,f3,f12,f104,f105,f106&secids=${BREADTH_SECIDS.join(",")}`;
  const json = await jsonp<any>(url, 10000);
  const diff = normalizeDiff(json?.data?.diff);

  let up = 0, down = 0, flat = 0;
  let pctSum = 0, pctCount = 0;
  for (const d of diff) {
    up += num(d.f104);
    down += num(d.f105);
    flat += num(d.f106);
    const pct = num(d.f3);
    if (Number.isFinite(pct)) { pctSum += pct; pctCount++; }
  }
  const total = up + down + flat;

  // 数据合理性校验兜底：真实A股全市场几千只股票，不可能出现"下跌0且平盘0"这种全员上涨的极端情况
  // （历史最大涨停潮也会有个别下跌/停牌平盘股），一旦出现说明接口返回了异常/不完整数据，
  // 此时直接抛出异常交由上层判定为"数据不足"，避免把明显错误的数字展示给用户
  if (total > 0 && up > 0 && down === 0 && flat === 0) {
    throw new Error("涨跌家数数据异常（全员上涨不合理），判定为接口返回不完整");
  }

  // 涨跌停家数为补充指标：单独抓取全市场个股统计，允许尽力而为（若因网络原因未取全，
  // 只影响这两个补充数字，不会影响上面已经从官方口径拿到的total/up/down/flat主指标）
  let limitUp = 0, limitDown = 0;
  try {
    const segments: Array<{ fs: string; limitPct: number }> = [
      { fs: "m:0+t:6", limitPct: 10 },     // 深圳主板
      { fs: "m:0+t:80", limitPct: 20 },    // 创业板
      { fs: "m:1+t:2", limitPct: 10 },     // 上海主板
      { fs: "m:1+t:23", limitPct: 20 },    // 科创板
      { fs: "m:0+t:81+s:2048", limitPct: 30 }, // 北交所
    ];
    async function fetchSegment(seg: { fs: string; limitPct: number }): Promise<{ limitUp: number; limitDown: number }> {
      let segLimitUp = 0, segLimitDown = 0;
      let page = 1;
      while (true) {
        const segUrl = `${PUSH2}/clist/get?ut=${EM_UT}&pn=${page}&pz=5000&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${seg.fs}&fields=f2,f3,f12`;
        try {
          const segJson = await jsonp<any>(segUrl, 15000);
          const rawDiff = segJson?.data?.diff;
          let segDiff: Array<Record<string, unknown>> = [];
          if (Array.isArray(rawDiff)) segDiff = rawDiff;
          else if (rawDiff && typeof rawDiff === "object") segDiff = Object.values(rawDiff);
          if (segDiff.length === 0) break;
          for (const d of segDiff) {
            const pct = num(d.f3);
            const price = num(d.f2);
            if (price <= 0) continue;
            if (pct >= seg.limitPct - 0.2) segLimitUp++;
            if (pct <= -(seg.limitPct - 0.2)) segLimitDown++;
          }
          if (segDiff.length < 5000) break;
          page++;
          if (page > 3) break;
        } catch {
          break;
        }
      }
      return { limitUp: segLimitUp, limitDown: segLimitDown };
    }
    const results = await Promise.allSettled(segments.map(fetchSegment));
    for (const r of results) {
      if (r.status === "fulfilled") {
        limitUp += r.value.limitUp;
        limitDown += r.value.limitDown;
      }
    }
  } catch {
    // 涨跌停统计失败时保持0，不影响主指标
  }

  return {
    total,
    up,
    down,
    flat,
    limitUp,
    limitDown,
    avgPct: pctCount ? pctSum / pctCount : 0,
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
    const url = `${PUSH2}/ulist.np/get?ut=${EM_UT}&fltt=2&fields=f2,f3,f4,f12,f14&secids=${secids}`;
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
    const url = `${PUSH2}/ulist.np/get?ut=${EM_UT}&fltt=2&fields=f2,f3,f12,f14,f6&secids=1.000001,0.399001`;
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
  const url = `${PUSH2}/ulist.np/get?ut=${EM_UT}&fltt=2&fields=f2,f3,f12,f14,f62,f66,f69,f72,f75,f78,f81,f84,f87,f164,f165,f174,f175,f184&secids=1.000001,0.399001`;
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
  const url = `${PUSH2}/clist/get?ut=${EM_UT}&pn=1&pz=${limit}&po=1&np=1&fltt=2&invt=2&fid=f62&fs=${fs}&fields=${fields}`;
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
  const url = `${PUSH2}/clist/get?ut=${EM_UT}&pn=1&pz=${limit}&po=1&np=1&fltt=2&invt=2&fid=f62&fs=b:${boardCode}&fields=${fields}`;
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
  const url = `${PUSH2}/ulist.np/get?ut=${EM_UT}&fltt=2&fields=${fields}&secids=${secid}`;
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
  const url = `${PUSH2HIS}/stock/fflow/daykline/get?ut=${EM_UT}&lmt=${days}&klt=101&secid=1.000001&secid2=0.399001&fields1=f1,f2,f3,f7&fields2=${fields2}`;
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

// ============== 个股相关新闻（利好利空资讯） ==============
export interface StockNewsItem {
  code: string;
  title: string;
  summary: string;
  time: string; // "YYYY-MM-DD HH:mm:ss"
  source: string;
  url: string;
}

// 东方财富全文检索接口 - 按股票名称/代码搜索相关新闻资讯（真实数据，非模拟）
// 参考：与东方财富网站搜索框功能同源接口
export async function fetchStockNews(keyword: string, pageSize = 10): Promise<StockNewsItem[]> {
  const param = {
    uid: "",
    keyword,
    type: ["cmsArticleWebOld"],
    client: "web",
    clientType: "web",
    clientVersion: "curr",
    param: {
      cmsArticleWebOld: {
        searchScope: "default",
        sort: "default",
        pageIndex: 1,
        pageSize,
        preTag: "",
        postTag: "",
      },
    },
  };
  const url = `https://search-api-web.eastmoney.com/search/jsonp?param=${encodeURIComponent(JSON.stringify(param))}`;
  try {
    const json = await jsonp<any>(url, 10000, "cb");
    const list: any[] = json?.result?.cmsArticleWebOld ?? [];
    return list.map((item) => ({
      code: String(item.code ?? ""),
      title: String(item.title ?? ""),
      summary: String(item.content ?? ""),
      time: String(item.date ?? ""),
      source: String(item.mediaName ?? ""),
      url: String(item.url ?? ""),
    }));
  } catch {
    return [];
  }
}

// ============== 个股公告（资金面/公司层面重大事项） ==============
export interface StockAnnouncement {
  code: string;
  title: string;
  columnName: string;
  time: string; // "YYYY-MM-DD HH:mm:ss"
  url: string;
}

// 东方财富个股公告接口（真实数据，与 data.eastmoney.com/notices 公告大全同源）
export async function fetchStockAnnouncements(code: string, pageSize = 10): Promise<StockAnnouncement[]> {
  const url = `https://np-anotice-stock.eastmoney.com/api/security/ann?sr=-1&page_size=${pageSize}&page_index=1&ann_type=A&client_source=web&f_node=0&s_node=0&stock_list=${code}`;
  try {
    const json = await jsonp<any>(url, 10000);
    const list: any[] = json?.data?.list ?? [];
    return list.map((item) => {
      const artCode = String(item.art_code ?? "");
      const columns: any[] = item.columns ?? [];
      return {
        code: String(item.codes?.[0]?.stock_code ?? code),
        title: String(item.title ?? ""),
        columnName: columns.length > 0 ? String(columns[0].column_name ?? "") : "",
        time: String(item.display_time ?? item.notice_date ?? ""),
        url: `https://data.eastmoney.com/notices/detail/${code}/${artCode}.html`,
      };
    });
  } catch {
    return [];
  }
}
