// 东方财富公开数据接口封装层 - 前端直接调用
// 由于跨域限制，使用JSONP方式或通过公开push2接口获取数据

import { recordApiCall } from "./apiHealth";

const PUSH2 = "https://push2.eastmoney.com/api/qt";
const PUSH2HIS = "https://push2his.eastmoney.com/api/qt";
const EM_UT = "bd1d9ddb04089700cf9c27f6f7426281";

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// strictNum: 解析失败返回 null 而非 0，用于关键聚合字段
// 为什么：num() 把 undefined 静默转 0，接口字段变更时系统"看起来正常但全错"
export function strictNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// 带遥测的 JSONP 包装：记录每次调用的成功/失败/耗时
async function trackedJsonp<T>(name: string, url: string, timeout = 10000, cbParam = "cb"): Promise<T> {
  const start = Date.now();
  try {
    const result = await jsonp<T>(url, timeout, cbParam);
    recordApiCall(name, true, Date.now() - start);
    return result;
  } catch (err) {
    recordApiCall(name, false, Date.now() - start);
    throw err;
  }
}

// 东方财富API的diff字段可能是数组也可能是对象，统一转为数组
function normalizeDiff(raw: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") return Object.values(raw);
  return [];
}

// JSONP请求封装（callbackParam 可指定回调参数名，不同接口要求不同，如 "cb" 或 "callback"）
function jsonpOnce<T = unknown>(url: string, timeout = 10000, callbackParam = "cb"): Promise<T> {
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
    // 隐藏 Referer 防止东方财富按来源域名拒绝请求
    script.referrerPolicy = "no-referrer";
    script.onerror = () => {
      cleanup();
      reject(new Error("JSONP load error"));
    };
    document.head.appendChild(script);
  });
}

// 带自动重试的 JSONP 请求（东方财富接口偶尔返回 502/超时，重试通常可恢复）
async function jsonp<T = unknown>(url: string, timeout = 10000, callbackParam = "cb", maxRetries = 2): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await jsonpOnce<T>(url, timeout, callbackParam);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        // 退避等待：第1次重试等500ms，第2次等1000ms
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }
  throw lastError!;
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
  const json = await trackedJsonp<any>("指数概览", url);
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
  const json = await trackedJsonp<any>("涨跌家数", url, 10000);
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

  return {
    total,
    up,
    down,
    flat,
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
  { secid: "100.KS11", name: "韩国KOSPI" },
  { secid: "100.TWII", name: "台湾加权" },
  { secid: "100.GDAXI", name: "德国DAX" },
  { secid: "100.FTSE", name: "英国富时100" },
  { secid: "100.AS51", name: "澳洲标普200" },
];

// 隔夜关联品种
export const COMMODITY_INDICES = [
  { secid: "100.UDI", name: "美元指数", hint: "美元走强通常利空大宗商品和新兴市场" },
  { secid: "133.USDCNH", name: "离岸人民币", hint: "人民币贬值利空进口型企业，利好出口型企业" },
  { secid: "101.GC00Y", name: "COMEX黄金", hint: "与A股黄金概念板块联动性强，关注贵金属标的" },
  { secid: "101.CL00Y", name: "NYMEX原油", hint: "与石油石化/化工板块联动，油价上涨利好能源股" },
  { secid: "101.HG00Y", name: "COMEX铜", hint: "铜价是经济风向标，与有色金属板块高度联动" },
];

export interface GlobalIndex {
  name: string;
  price: number;
  pct: number;
  change: number;
}

export async function fetchCommodities(): Promise<GlobalIndex[]> {
  try {
    const secids = COMMODITY_INDICES.map((i) => i.secid).join(",");
    const url = `${PUSH2}/ulist.np/get?ut=${EM_UT}&fltt=2&fields=f2,f3,f4,f12,f14&secids=${secids}`;
    const json = await trackedJsonp<any>("板块资金流", url, 10000);
    const diff = normalizeDiff(json?.data?.diff);
    return diff.map((d) => {
      const code = String(d.f12 ?? "");
      const match = COMMODITY_INDICES.find((g) => g.secid.includes(code));
      return { name: match?.name || String(d.f14 ?? code), price: num(d.f2), pct: num(d.f3), change: num(d.f4) };
    });
  } catch { return []; }
}

export async function fetchGlobalIndices(): Promise<GlobalIndex[]> {
  try {
    const secids = GLOBAL_INDICES.map((i) => i.secid).join(",");
    const url = `${PUSH2}/ulist.np/get?ut=${EM_UT}&fltt=2&fields=f2,f3,f4,f12,f14&secids=${secids}`;
    const json = await trackedJsonp<any>("板块成分股", url, 10000);
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
    const json = await trackedJsonp<any>("成交额", url, 6000);
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
  // 精简请求字段：去掉 f69/f75/f81/f87/f165/f175/f184 等占比类冗余字段
  // 这些字段组合过多时东方财富服务端会返回 502 Bad Gateway
  const url = `${PUSH2}/ulist.np/get?ut=${EM_UT}&fltt=2&fields=f12,f62,f66,f72,f78,f84,f164,f174&secids=1.000001,0.399001`;
  const json = await trackedJsonp<any>("全球指数", url);
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
  const json = await trackedJsonp<any>("商品汇率", url);
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

// ============== 板块名称过滤（去除非真正概念板块的指数成分/风格标签） ==============
// 东方财富 m:90+t:3（概念板块）里混入了大量指数成分筛选标签，如"融资融券"、"MSCI中国"等
// 这些不是投资意义上的概念板块，需要过滤掉
const BOARD_NAME_BLACKLIST = [
  // 指数成分标签
  "融资融券", "MSCI中国", "富时罗素", "标准普尔", "沪股通", "深股通",
  "HS300", "深成500", "上证180", "中证500", "中证1000", "深证100",
  "上证50", "创业成份", "创业板综", "AH股", "B股",
  // 风格/规模分类
  "大盘股", "中盘股", "小盘股", "大盘成长", "大盘价值", "中盘成长",
  "中盘价值", "小盘成长", "小盘价值", "百元股",
  // 非概念分类
  "基金重仓", "社保重仓", "险资重仓", "券商重仓", "QFII重仓",
  "昨日高振幅", "昨日涨停", "昨日跌停", "昨日连板", "昨日触板",
  "东方财富热股", "周期股", "消费风格", "科技风格", "金融风格",
  "红利破净股", "红利风格",
  // 报告期标签
  "中报预增", "中报预减", "年报预增", "年报预减", "季报预增", "业绩预升",
];

export function isRealConceptBoard(name: string): boolean {
  for (const keyword of BOARD_NAME_BLACKLIST) {
    if (name.includes(keyword)) return false;
  }
  // 以下划线结尾的通常是指数标签（如"HS300_"）
  if (name.endsWith("_")) return false;
  return true;
}

// ============== 板块资金流排行（净流入/净流出 Top10 + 连续天数统计） ==============
export interface BoardRankItem {
  code: string;
  name: string;
  pct: number;
  turnoverRate: number; // 板块换手率
  mainNet: number;     // 今日主力净流入
  mainNet5d: number;   // 近5日主力净流入
  mainNet10d: number;  // 近10日主力净流入
  consecutiveDays: number;  // 连续净流入/净流出天数（正=连续流入天数，负=连续流出天数）
  boardType: string;
}

// 获取板块资金流排行：同时取净流入Top和净流出Top
// 通过近5日/近10日的方向关系推算连续天数（无需逐日请求历史数据）
export async function fetchBoardRankTopBottom(
  boardType: "industry" | "concept",
  topN = 10,
): Promise<{ inflow: BoardRankItem[]; outflow: BoardRankItem[] }> {
  const fs = BOARD_FS[boardType];
  const fields = "f12,f14,f3,f8,f62,f164,f165,f174,f175";
  // 多请求一些数据（topN*4），过滤掉非真正概念板块后再取前 topN
  const fetchSize = topN * 4;

  // 净流入Top（fid=f62 降序 po=1）
  const inflowUrl = `${PUSH2}/clist/get?ut=${EM_UT}&pn=1&pz=${fetchSize}&po=1&np=1&fltt=2&invt=2&fid=f62&fs=${fs}&fields=${fields}`;
  // 净流出Top（fid=f62 升序 po=0）
  const outflowUrl = `${PUSH2}/clist/get?ut=${EM_UT}&pn=1&pz=${fetchSize}&po=0&np=1&fltt=2&invt=2&fid=f62&fs=${fs}&fields=${fields}`;

  const [inflowRes, outflowRes] = await Promise.allSettled([
    jsonp<any>(inflowUrl),
    jsonp<any>(outflowUrl),
  ]);

  function parseItems(result: PromiseSettledResult<any>): BoardRankItem[] {
    if (result.status !== "fulfilled") return [];
    const diff = normalizeDiff(result.value?.data?.diff);
    return diff.map((d) => {
      const mainNet = num(d.f62);
      const mainNet5d = num(d.f164);
      const mainNet10d = num(d.f174);
      // 推算连续天数：
      // - 如果今日、5日、10日同方向且逐级放大，推断连续时间较长
      // - 如果今日方向与5日方向一致，至少连续2天
      // - 用5日净额/今日净额的比值估算
      let consecutiveDays = 0;
      if (mainNet > 0) {
        if (mainNet5d > 0 && mainNet10d > 0) {
          // 近10日都是净流入，至少持续5天以上
          consecutiveDays = Math.min(10, Math.round(mainNet10d / Math.max(Math.abs(mainNet), 1)));
          if (consecutiveDays < 5) consecutiveDays = 5;
        } else if (mainNet5d > 0) {
          // 近5日净流入，推断2-5天
          consecutiveDays = Math.min(5, Math.max(2, Math.round(mainNet5d / Math.max(Math.abs(mainNet), 1))));
        } else {
          consecutiveDays = 1;
        }
      } else if (mainNet < 0) {
        if (mainNet5d < 0 && mainNet10d < 0) {
          consecutiveDays = -Math.min(10, Math.round(Math.abs(mainNet10d) / Math.max(Math.abs(mainNet), 1)));
          if (consecutiveDays > -5) consecutiveDays = -5;
        } else if (mainNet5d < 0) {
          consecutiveDays = -Math.min(5, Math.max(2, Math.round(Math.abs(mainNet5d) / Math.max(Math.abs(mainNet), 1))));
        } else {
          consecutiveDays = -1;
        }
      }
      return {
        code: String(d.f12 ?? ""),
        name: String(d.f14 ?? ""),
        pct: num(d.f3),
        turnoverRate: num(d.f8),
        mainNet,
        mainNet5d,
        mainNet10d,
        consecutiveDays,
        boardType,
      };
    });
  }

  return {
    inflow: parseItems(inflowRes).filter(b => isRealConceptBoard(b.name)).slice(0, topN),
    outflow: parseItems(outflowRes).filter(b => isRealConceptBoard(b.name)).slice(0, topN),
  };
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
  const json = await trackedJsonp<any>("个股行情", url);
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

// 按股票代码判断所属板块的涨跌停幅度
// 2026年7月6日起，主板ST股涨跌幅由5%调至10%，与主板普通股一致；
// 创业板/科创板ST股此前已统一为20%，北交所ST股为30%，均与各自板块普通股一致。
// 因此无需区分ST与非ST，统一按代码前缀判断板块即可。
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
  const json = await trackedJsonp<any>("板块资金排行", url);
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
// 修复：secid2 参数在部分时段会触发 500 错误，改为分别请求沪深两市然后按日期合并
export async function fetchMarketFundHistory(days = 30): Promise<FundSnapshot[]> {
  const fields2 = "f51,f52,f53,f54,f55,f56";
  async function fetchOne(secid: string): Promise<Map<string, number[]>> {
    const url = `${PUSH2HIS}/stock/fflow/daykline/get?ut=${EM_UT}&lmt=${days}&klt=101&secid=${secid}&fields1=f1,f2,f3,f7&fields2=${fields2}`;
    const json = await jsonp<any>(url, 12000);
    const klines: string[] = json?.data?.klines ?? [];
    const map = new Map<string, number[]>();
    for (const line of klines) {
      const p = line.split(",");
      // [mainNet, smallNet, mediumNet, largeNet, extraLargeNet]
      map.set(p[0], [num(p[1]), num(p[2]), num(p[3]), num(p[4]), num(p[5])]);
    }
    return map;
  }

  try {
    const [shMap, szMap] = await Promise.all([
      fetchOne("1.000001"),
      fetchOne("0.399001"),
    ]);

    // 合并沪深两市同日数据
    const allDates = new Set([...shMap.keys(), ...szMap.keys()]);
    const parsed: FundSnapshot[] = [];
    for (const date of allDates) {
      const sh = shMap.get(date) ?? [0, 0, 0, 0, 0];
      const sz = szMap.get(date) ?? [0, 0, 0, 0, 0];
      parsed.push({
        date,
        mainNet: sh[0] + sz[0],
        smallNet: sh[1] + sz[1],
        mediumNet: sh[2] + sz[2],
        largeNet: sh[3] + sz[3],
        extraLargeNet: sh[4] + sz[4],
        mainNet5d: 0,
        mainNet10d: 0,
      });
    }
    // 按日期正序排列以便滚动计算
    parsed.sort((a, b) => a.date.localeCompare(b.date));

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
  // 该接口的 JSONP 回调参数名为 callback（不是 cb）
  // 注意：不能用 fetch（该域名不设置 CORS 头），只能用 JSONP
  const url = `https://np-weblist.eastmoney.com/comm/web/getFastNewsList?client=web&biz=web_724&fastColumn=102&sortEnd=&pageSize=${pageSize}&req_trace=${Date.now()}`;
  try {
    const json = await jsonp<any>(url, 15000, "callback");
    const list: any[] = json?.data?.fastNewsList ?? [];
    return list.map((item) => ({
      code: String(item.code ?? ""),
      title: String(item.title ?? item.summary ?? ""),
      summary: String(item.summary ?? ""),
      time: String(item.showTime ?? ""),
      url: newsDetailUrl(String(item.code ?? "")),
    }));
  } catch {
    // JSONP 也失败时，尝试用 fetch + no-cors 模式获取（某些环境下可能成功）
    try {
      const resp = await fetch(url, { mode: "cors", signal: AbortSignal.timeout(10000) });
      if (resp.ok) {
        const json = await resp.json();
        const list: any[] = json?.data?.fastNewsList ?? [];
        return list.map((item) => ({
          code: String(item.code ?? ""),
          title: String(item.title ?? item.summary ?? ""),
          summary: String(item.summary ?? ""),
          time: String(item.showTime ?? ""),
          url: newsDetailUrl(String(item.code ?? "")),
        }));
      }
    } catch { /* both methods failed */ }
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
    const json = await trackedJsonp<any>("资金历史", url, 10000);
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

// ============== 龙虎榜数据（东方财富数据中心） ==============
const DATACENTER = "https://datacenter-web.eastmoney.com/api/data/v1/get";

export interface DragonTigerItem {
  code: string;
  name: string;
  tradeDate: string;
  closePrice: number;
  changeRate: number;
  explanation: string; // 上榜原因
  explain: string;     // 机构/游资说明
  netAmt: number;      // 龙虎榜净买入
  buyAmt: number;
  sellAmt: number;
  d1Pct: number | null; // 次日涨跌幅
  d2Pct: number | null;
  d5Pct: number | null;
  d10Pct: number | null;
}

export interface DragonTigerSeat {
  deptName: string;
  buy: number;
  sell: number;
  net: number;
}

// 获取最新龙虎榜列表
export async function fetchDragonTigerList(pageSize = 50): Promise<DragonTigerItem[]> {
  const cols = "SECURITY_CODE,SECURITY_NAME_ABBR,TRADE_DATE,CLOSE_PRICE,CHANGE_RATE,EXPLAIN,BILLBOARD_NET_AMT,BILLBOARD_BUY_AMT,BILLBOARD_SELL_AMT,EXPLANATION,D1_CLOSE_ADJCHRATE,D2_CLOSE_ADJCHRATE,D5_CLOSE_ADJCHRATE,D10_CLOSE_ADJCHRATE";
  const url = `${DATACENTER}?sortColumns=TRADE_DATE,SECURITY_CODE&sortTypes=-1,1&pageSize=${pageSize}&pageNumber=1&reportName=RPT_DAILYBILLBOARD_DETAILSNEW&columns=${cols}&source=WEB&client=WEB`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(12000) });
    const json = await resp.json();
    const list: any[] = json?.result?.data ?? [];
    // 去重（同一只股票同一天可能有多条上榜原因）
    const seen = new Map<string, DragonTigerItem>();
    for (const d of list) {
      const key = `${d.SECURITY_CODE}_${d.TRADE_DATE}`;
      if (!seen.has(key)) {
        seen.set(key, {
          code: d.SECURITY_CODE,
          name: d.SECURITY_NAME_ABBR,
          tradeDate: String(d.TRADE_DATE ?? "").slice(0, 10),
          closePrice: num(d.CLOSE_PRICE),
          changeRate: num(d.CHANGE_RATE),
          explanation: String(d.EXPLANATION ?? ""),
          explain: String(d.EXPLAIN ?? ""),
          netAmt: num(d.BILLBOARD_NET_AMT),
          buyAmt: num(d.BILLBOARD_BUY_AMT),
          sellAmt: num(d.BILLBOARD_SELL_AMT),
          d1Pct: d.D1_CLOSE_ADJCHRATE != null ? num(d.D1_CLOSE_ADJCHRATE) : null,
          d2Pct: d.D2_CLOSE_ADJCHRATE != null ? num(d.D2_CLOSE_ADJCHRATE) : null,
          d5Pct: d.D5_CLOSE_ADJCHRATE != null ? num(d.D5_CLOSE_ADJCHRATE) : null,
          d10Pct: d.D10_CLOSE_ADJCHRATE != null ? num(d.D10_CLOSE_ADJCHRATE) : null,
        });
      }
    }
    return [...seen.values()];
  } catch {
    return [];
  }
}

// 获取某只股票某日的买入/卖出前五席位
export async function fetchDragonTigerSeats(code: string, tradeDate: string): Promise<{ buy: DragonTigerSeat[]; sell: DragonTigerSeat[] }> {
  const baseUrl = `${DATACENTER}?columns=ALL&pageNumber=1&pageSize=50&source=WEB&client=WEB`;
  const filter = `(TRADE_DATE='${tradeDate}')(SECURITY_CODE="${code}")`;
  const buyUrl = `${baseUrl}&reportName=RPT_BILLBOARD_DAILYDETAILSBUY&filter=${encodeURIComponent(filter)}&sortTypes=-1&sortColumns=BUY`;
  const sellUrl = `${baseUrl}&reportName=RPT_BILLBOARD_DAILYDETAILSSELL&filter=${encodeURIComponent(filter)}&sortTypes=-1&sortColumns=SELL`;
  const parseSeat = (d: any): DragonTigerSeat => ({
    deptName: String(d.OPERATEDEPT_NAME ?? ""),
    buy: num(d.BUY),
    sell: num(d.SELL),
    net: num(d.NET),
  });
  const [buyRes, sellRes] = await Promise.allSettled([
    fetch(buyUrl, { signal: AbortSignal.timeout(10000) }).then(r => r.json()),
    fetch(sellUrl, { signal: AbortSignal.timeout(10000) }).then(r => r.json()),
  ]);
  return {
    buy: buyRes.status === "fulfilled" ? (buyRes.value?.result?.data ?? []).map(parseSeat).slice(0, 5) : [],
    sell: sellRes.status === "fulfilled" ? (sellRes.value?.result?.data ?? []).map(parseSeat).slice(0, 5) : [],
  };
}

// ============== 涨停池/炸板池/跌停池（共享数据获取） ==============
const ZT_UT = "7eea3edcaed734bea9cbfc24409ed989";

export function tradeDateStr(): string {
  const d = new Date();
  const day = d.getDay();
  if (day === 0) d.setDate(d.getDate() - 2);
  if (day === 6) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

function ztJsonp<T = any>(url: string, timeout = 12000): Promise<T> {
  return new Promise((resolve, reject) => {
    const cbName = `ztcb_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement("script");
    const timer = setTimeout(() => { cleanup(); reject(new Error("timeout")); }, timeout);
    function cleanup() { clearTimeout(timer); delete (window as any)[cbName]; if (script.parentNode) script.parentNode.removeChild(script); }
    (window as any)[cbName] = (data: T) => { cleanup(); resolve(data); };
    script.src = `${url}&cb=${cbName}&_=${Date.now()}`;
    script.referrerPolicy = "no-referrer";
    script.onerror = () => { cleanup(); reject(new Error("error")); };
    document.head.appendChild(script);
  });
}

export interface LimitPoolSummary {
  limitUpCount: number;
  limitDownCount: number;
  blastedCount: number;
  blastedRate: number;
  boardCounts: Record<number, number>; // 连板数 -> 个数
  totalBoardStocks: number; // 2连板及以上总数
}

// 获取涨停池统计摘要（供多个模块共享）
export async function fetchLimitPoolSummary(date?: string): Promise<LimitPoolSummary> {
  const d = date || tradeDateStr();
  const ztUrl = `https://push2ex.eastmoney.com/getTopicZTPool?ut=${ZT_UT}&dpt=wz.ztzt&Pageindex=0&pagesize=500&sort=fbt:asc&date=${d}`;
  const zbUrl = `https://push2ex.eastmoney.com/getTopicZBPool?ut=${ZT_UT}&dpt=wz.ztzt&Pageindex=0&pagesize=500&sort=fund:asc&date=${d}`;
  const dtUrl = `https://push2ex.eastmoney.com/getTopicDTPool?ut=${ZT_UT}&dpt=wz.ztzt&Pageindex=0&pagesize=500&sort=fund:asc&date=${d}`;

  const [ztRes, zbRes, dtRes] = await Promise.allSettled([
    ztJsonp<any>(ztUrl), ztJsonp<any>(zbUrl), ztJsonp<any>(dtUrl),
  ]);

  const ztPool: any[] = ztRes.status === "fulfilled" ? (ztRes.value?.data?.pool ?? []) : [];
  const zbPool: any[] = zbRes.status === "fulfilled" ? (zbRes.value?.data?.pool ?? []) : [];
  const dtPool: any[] = dtRes.status === "fulfilled" ? (dtRes.value?.data?.pool ?? []) : [];

  const boardCounts: Record<number, number> = {};
  for (const s of ztPool) {
    const lbc = s.lbc ?? 1;
    boardCounts[lbc] = (boardCounts[lbc] ?? 0) + 1;
  }

  const limitUpCount = ztPool.length;
  const blastedCount = zbPool.length;
  const limitDownCount = dtPool.length;
  const blastedRate = (limitUpCount + blastedCount) > 0 ? blastedCount / (limitUpCount + blastedCount) * 100 : 0;
  const totalBoardStocks = ztPool.filter((s: any) => (s.lbc ?? 1) >= 2).length;

  return { limitUpCount, limitDownCount, blastedCount, blastedRate, boardCounts, totalBoardStocks };
}

// ============== 两市历史日成交额（用于量能对比） ==============
export async function fetchTurnoverHistory(days = 10): Promise<{ date: string; amount: number }[]> {
  const fields2 = "f51,f52,f53,f54,f55,f56,f57";
  async function fetchOne(secid: string): Promise<Map<string, number>> {
    const url = `${PUSH2HIS}/stock/kline/get?secid=${secid}&fields1=f1,f2,f3&fields2=${fields2}&klt=101&fqt=0&beg=0&end=20500000&lmt=${days + 5}&ut=${EM_UT}`;
    const json = await trackedJsonp<any>("成交额历史", url, 10000);
    const klines: string[] = json?.data?.klines ?? [];
    const map = new Map<string, number>();
    for (const line of klines) {
      const p = line.split(",");
      map.set(p[0], Number(p[6]) || 0); // f57 = 成交额
    }
    return map;
  }
  try {
    const [shMap, szMap] = await Promise.all([fetchOne("1.000001"), fetchOne("0.399001")]);
    const allDates = new Set([...shMap.keys(), ...szMap.keys()]);
    const result: { date: string; amount: number }[] = [];
    for (const date of allDates) {
      result.push({ date, amount: (shMap.get(date) ?? 0) + (szMap.get(date) ?? 0) });
    }
    result.sort((a, b) => b.date.localeCompare(a.date));
    return result.slice(0, days);
  } catch { return []; }
}

// ============== 限售解禁查询（用于个股否决项） ==============
// reportName=RPT_LIFT_STAGE 已验证可用，FREE_DATE=解禁日期
export interface LiftBanItem {
  code: string;
  name: string;
  freeDate: string; // YYYY-MM-DD
  liftMarketCap: number; // 解禁市值(万元)
  freeRatio: number; // 解禁比例
}

export async function fetchLiftBan(code: string): Promise<LiftBanItem[]> {
  const url = `https://datacenter-web.eastmoney.com/api/data/v1/get?sortColumns=FREE_DATE&sortTypes=1&pageSize=5&pageNumber=1&reportName=RPT_LIFT_STAGE&columns=SECURITY_CODE,SECURITY_NAME_ABBR,FREE_DATE,LIFT_MARKET_CAP,FREE_RATIO&source=WEB&client=WEB&filter=(SECURITY_CODE=%22${code}%22)`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const json = await resp.json();
    const list: any[] = json?.result?.data ?? [];
    return list.map(d => ({
      code: String(d.SECURITY_CODE ?? ""),
      name: String(d.SECURITY_NAME_ABBR ?? ""),
      freeDate: String(d.FREE_DATE ?? "").slice(0, 10),
      liftMarketCap: Number(d.LIFT_MARKET_CAP) || 0,
      freeRatio: Number(d.FREE_RATIO) || 0,
    }));
  } catch { return []; }
}
