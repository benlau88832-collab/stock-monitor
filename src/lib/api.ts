// 东方财富公开数据接口封装层 - 前端直接调用
// 由于跨域限制，使用JSONP方式或通过公开push2接口获取数据

import { recordApiCall } from "./apiHealth";
import { getBJDate, getBJWeekday } from "./format";

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

// v9.60（V9-D1）：关键字段缺失检测 —— 东财改字段时"可感知"而非静默 0
// 为什么：红线 #5 —— 接口匹配失败 ≠ 数据真为 0。用 strictNum 语义（非有限数即缺失）
// 判定一组关键资金/涨跌幅字段是否有任一缺失，命中则调用方应标 dataMissing/fundMissing，
// UI 显示"数据缺失"而非误导 0。纯函数，便于单测。
export function hasMissingKeyFields(d: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((k) => strictNum(d[k]) === null);
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

// JSONP 统一走全局队列调度器（并发≤2，自动重试+去重+错峰）
// 为什么替换旧实现：15个JSONP同时发出触发东财盘后限流(ERR_EMPTY_RESPONSE)
import { queuedJsonp } from "./jsonpQueue";

async function jsonp<T = unknown>(url: string, timeout = 6000, callbackParam = "cb"): Promise<T> {
  return queuedJsonp<T>(url, timeout, callbackParam, 2);
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
  try {
    const secids = MAJOR_INDICES.map((i) => i.secid).join(",");
    const url = `${PUSH2}/ulist.np/get?ut=${EM_UT}&fltt=2&fields=f2,f3,f4,f12,f14&secids=${secids}`;
    const json = await trackedJsonp<any>("指数概览", url);
    const diff = normalizeDiff(json?.data?.diff);
    if (diff.length > 0) {
      return diff.map((d: Record<string, unknown>) => ({
        code: String(d.f12 ?? ""),
        name: String(d.f14 ?? ""),
        price: num(d.f2),
        pct: num(d.f3),
        change: num(d.f4),
      }));
    }
    throw new Error("empty diff");
  } catch {
    // P3-2：东财指数接口失败/空 → 降级腾讯 qt.gtimg.cn（浏览器直连无 CORS）
    return fetchIndexOverviewTencent();
  }
}

/**
 * P3-2：腾讯指数备用源（qt.gtimg.cn，雪球格式）
 * 代码映射：上证指数 sh000001 / 深证成指 sz399001 / 创业板指 sz399006 / 科创50 sh000688 / 沪深300 sh000300
 * 返回格式：v_sh000001="1~上证指数~000001~收盘价~昨收~今开~成交量~...~涨幅%~..."
 */
async function fetchIndexOverviewTencent(): Promise<IndexQuote[]> {
  try {
    const codeMap: Record<string, string> = {
      "000001": "sh000001", "399001": "sz399001", "399006": "sz399006",
      "000688": "sh000688", "000300": "sh000300",
    };
    const codes = MAJOR_INDICES.map(i => codeMap[i.code]).filter(Boolean).join(",");
    const resp = await fetch(`https://qt.gtimg.cn/q=${codes}`, { mode: "cors" });
    if (!resp.ok) return [];
    // 腾讯接口默认 GBK，浏览器 fetch 可能乱码 → 用 text() 拿原始后尝试解码
    const raw = await resp.arrayBuffer();
    let text: string;
    try { text = new TextDecoder("gbk").decode(raw); } catch { text = new TextDecoder("utf-8").decode(raw); }
    const out: IndexQuote[] = [];
    for (const line of text.split(";")) {
      const m = line.match(/v_(\w+)="([^"]*)"/);
      if (!m) continue;
      const fields = m[2].split("~");
      if (fields.length < 32) continue;
      const name = fields[1];
      const price = Number(fields[3]);
      const pct = Number(fields[32]);
      const change = Number(fields[31]);
      const code = fields[2];
      if (!name || !Number.isFinite(price)) continue;
      out.push({ code: String(code), name, price, pct: Number.isFinite(pct) ? pct : 0, change: Number.isFinite(change) ? change : 0 });
    }
    if (out.length === 0) return [];
    console.warn("[api] 东财指数降级腾讯备用源:", out.length, "条");
    return out;
  } catch { return []; }
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
    const json = await trackedJsonp<any>("商品汇率", url, 10000);
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
    const json = await trackedJsonp<any>("全球指数", url, 10000);
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
  /** v9.53（V7-8）：关键字段缺失（f62/f164/f174）→ UI 显示"数据缺失"而非误导 0 */
  dataMissing?: boolean;
}

export async function fetchMarketMainFund(): Promise<MarketFundData> {
  // 精简请求字段：去掉 f69/f75/f81/f87/f165/f175/f184 等占比类冗余字段
  // 这些字段组合过多时东方财富服务端会返回 502 Bad Gateway
  // v9.53（V7-9）：单位口径 —— f62/f164/f174 均为"元"（不是万），聚合前不缩放
  // v9.64（V2-P0-1）：补北交所 0.899050（此前缺北交 → 小盘资金失真）
  const url = `${PUSH2}/ulist.np/get?ut=${EM_UT}&fltt=2&fields=f12,f62,f66,f72,f78,f84,f164,f174&secids=1.000001,0.399001,0.899050`;
  const json = await trackedJsonp<any>("主力资金", url);
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
  let missing = false;
  for (const d of diff) {
    // v9.53（V7-8）：字段缺失 → 不再静默当 0（缺失显式标注，UI 显示"数据缺失"）
    // v9.60（V9-D1）：缺失检测从仅 f62/f164/f174 扩展为全部资金字段（f66/f72/f78/f84 任一缺失同样标注）
    if (hasMissingKeyFields(d, ["f62", "f66", "f72", "f78", "f84", "f164", "f174"])) missing = true;
    // v14-6（P2）：关键金额字段 strictNum()（缺失跳过累加不污染，dataMissing 已标注）
    agg.mainNet += strictNum(d.f62) ?? 0;
    agg.extraLargeNet += num(d.f66);
    agg.largeNet += num(d.f72);
    agg.mediumNet += num(d.f78);
    agg.smallNet += num(d.f84);
    agg.mainNet5d += strictNum(d.f164) ?? 0;
    agg.mainNet10d += strictNum(d.f174) ?? 0;
  }
  agg.dataMissing = missing;
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
  /** v9.53（V7-8）：f62 缺失（东财改字段）→ UI 显示"数据缺失" */
  dataMissing?: boolean;
}

const BOARD_FS: Record<string, string> = {
  region: "m:90+t:1",
  industry: "m:90+t:2",
  concept: "m:90+t:3",
};

export async function fetchBoardFundFlow(
  boardType: "industry" | "concept" | "region",
  limit = 15,
  opts?: { all?: boolean },
): Promise<BoardFlowItem[]> {
  const fs = BOARD_FS[boardType];
  const fields = "f12,f14,f3,f62,f66,f72,f78,f84,f164,f165,f174,f175,f184";
  const parse = (json: any): BoardFlowItem[] => {
    const diff = normalizeDiff(json?.data?.diff);
    return diff.map((d) => {
      // v9.53（V7-8/9）：f62 为元；字段缺失标 dataMissing（UI 显示"数据缺失"而非误导 0）
      // v9.60（V9-D1）：缺失检测从仅 f62 扩展为全部资金/涨跌幅关键字段
      const dataMissing = hasMissingKeyFields(d, ["f3", "f62", "f66", "f72", "f78", "f84", "f164", "f165", "f174", "f175", "f184"]);
      return {
        code: String(d.f12 ?? ""),
        name: String(d.f14 ?? ""),
        pct: num(d.f3),
        // v14-6（P2）：关键金额字段 num() → strictNum()（缺失/非法值不静默污染，配合 dataMissing 标注 UI 显示"数据缺失"）
        mainNet: strictNum(d.f62) ?? 0,
        extraLargeNet: num(d.f66),
        largeNet: num(d.f72),
        mediumNet: num(d.f78),
        smallNet: num(d.f84),
        mainNetPct: num(d.f184),
        mainNet5d: strictNum(d.f164) ?? 0,
        mainNet5dPct: num(d.f165),
        mainNet10d: strictNum(d.f174) ?? 0,
        mainNet10dPct: num(d.f175),
        boardType,
        dataMissing,
      };
    });
  };

  // v9.30.1：all=true 时用"双请求"拿全量（流入 po=1 降序 + 流出 po=0 升序），合并去重后本地 mainNet 降序。
  // 修复：原实现仅 po=1 降序 + pz=limit —— 东财 t:2 行业细分远超 100 个，f62 降序前 100 全是正数，
  //      流出行业被挤出结果集 → 资金走势图"主力净流出"永远为 0。
  // 注意：不能靠 pz=500 拉全量 —— 东财对 pz 有上限（约100），且排序后仅返回头部。
  if (opts?.all) {
    const base = `${PUSH2}/clist/get?ut=${EM_UT}&pn=1&pz=300&np=1&fltt=2&invt=2&fid=f62&fs=${fs}&fields=${fields}`;
    const [inflowRes, outflowRes] = await Promise.allSettled([
      trackedJsonp<any>("板块资金流入", `${base}&po=1`),
      trackedJsonp<any>("板块资金流出", `${base}&po=0`),
    ]);
    const merged = new Map<string, BoardFlowItem>();
    for (const r of [inflowRes, outflowRes]) {
      if (r.status === "fulfilled") {
        for (const it of parse(r.value)) if (it.code) merged.set(it.code, it);
      }
    }
    return [...merged.values()].sort((a, b) => b.mainNet - a.mainNet);
  }

  const url = `${PUSH2}/clist/get?ut=${EM_UT}&pn=1&pz=${limit}&po=1&np=1&fltt=2&invt=2&fid=f62&fs=${fs}&fields=${fields}`;
  const json = await trackedJsonp<any>("板块资金流", url);
  return parse(json);
}

// ============== 板块名称过滤（去除非真正概念板块的指数成分/风格标签） ==============
// 东方财富 m:90+t:3（概念板块）里混入了大量指数成分筛选标签，如"融资融券"、"MSCI中国"等
// 这些不是投资意义上的概念板块，需要过滤掉
// 板块过滤：从全局分类模块导入（boardTaxonomy 是唯一分类源）
import { isRealConceptBoard } from "./boardTaxonomy";
export { isRealConceptBoard };

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
  /** v9.60（V9-D1）：关键资金字段缺失（东财改字段）→ UI 显示"数据缺失"而非误导 0 */
  dataMissing?: boolean;
}

export async function fetchBoardConstituents(boardCode: string, limit = 10): Promise<BoardStock[]> {
  const fields = "f12,f14,f2,f3,f62,f66,f72,f78,f84,f184,f8,f9,f10";
  const url = `${PUSH2}/clist/get?ut=${EM_UT}&pn=1&pz=${limit}&po=1&np=1&fltt=2&invt=2&fid=f62&fs=b:${boardCode}&fields=${fields}`;
  const json = await trackedJsonp<any>("板块成分股", url);
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
    dataMissing: hasMissingKeyFields(d, ["f3", "f62", "f184", "f66", "f78", "f84"]),
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
  const json = await trackedJsonp<any>("个股行情", url);
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
    /** v9.60（V9-D1）：关键资金字段缺失（东财改字段）→ UI 显示"数据缺失"而非误导 0 */
    dataMissing: hasMissingKeyFields(d, ["f3", "f62", "f184", "f164", "f174", "f66", "f72", "f78", "f84"]),
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
    const json = await trackedJsonp<any>("个股公告", url, 10000);
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
    const json = await trackedJsonp<any>("龙虎榜", url, 12000, "callback");
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
    trackedJsonp<any>("龙虎榜席位", buyUrl, 10000, "callback"),
    trackedJsonp<any>("龙虎榜席位", sellUrl, 10000, "callback"),
  ]);
  return {
    buy: buyRes.status === "fulfilled" ? (buyRes.value?.result?.data ?? []).map(parseSeat).slice(0, 5) : [],
    sell: sellRes.status === "fulfilled" ? (sellRes.value?.result?.data ?? []).map(parseSeat).slice(0, 5) : [],
  };
}

// ============== 涨停池/炸板池/跌停池（共享数据获取） ==============
const ZT_UT = "7eea3edcaed734bea9cbfc24409ed989";

export function tradeDateStr(): string {
  // v9.60（V9-D3）：周末判定用北京时间（getBJDate），替代本机 getDay() 时区偏移
  // v9.63-fix（补丁）：显式 getBJWeekday
  const d = getBJDate();
  const day = getBJWeekday(d);
  if (day === 0) d.setDate(d.getDate() - 2);
  if (day === 6) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

// 涨停池也走全局队列（不再有独立JSONP实现绕过并发控制）
function ztJsonp<T = any>(url: string, timeout = 6000): Promise<T> {
  return queuedJsonp<T>(url, timeout, "cb", 2);
}

export interface LimitPoolSummary {
  limitUpCount: number;
  limitDownCount: number;
  blastedCount: number;
  blastedRate: number;
  boardCounts: Record<number, number>; // 连板数 -> 个数
  totalBoardStocks: number; // 2连板及以上总数
  /** 涨停池原始数组（供题材梯队等下游模块复用，避免重复请求） */
  rawZTPool: any[];
  /** v9.26.18：炸板池原始数据（字段：c/n/zdp/zbc 炸板次数/zf 炸板幅度/zttj.ct 连板数） */
  rawZBPool?: any[];
  /** v9.49（L4）：跌停池原始数据（字段：c/n/zdp/oc 开板次数/days），供 LimitBoard 复用 */
  rawDTPool?: any[];
  /** 接口返回的真实交易日（形如"20260729"），优先用于快照 key（兼容法定节假日） */
  qdate: string | null;
  /** v12-6（P1）：涨停池可能被截断的警告（返回长度恰为整数边界 100/200/300/400/500 时触发） */
  truncated?: string;
  /** v9.26.10：当日池总数（节假日回退判定用） */
  totalCount: number;
  /** v9.26.10：是否交易日（穷尽回退后仍空则 false） */
  isTradingDay?: boolean;
}

// 获取涨停池统计摘要（供多个模块共享）
// v9.26.10：节假日/非交易日空池时自动回退最近交易日（最多 10 天）
export async function fetchLimitPoolSummary(date?: string): Promise<LimitPoolSummary> {
  let d = date || tradeDateStr();
  let last: LimitPoolSummary | null = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    const summary = await fetchZTPoolForDate(d);
    if (summary.totalCount > 0 || attempt === 9) {
      return summary; // 有数据或穷尽回退 → 返回
    }
    // 空池（节假日）→ 往前一天再试
    const prev = new Date(`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`);
    prev.setDate(prev.getDate() - 1);
    d = `${prev.getFullYear()}${String(prev.getMonth()+1).padStart(2,"0")}${String(prev.getDate()).padStart(2,"0")}`;
  }
  return last ?? { limitUpCount: 0, limitDownCount: 0, blastedCount: 0, blastedRate: 0, boardCounts: {}, totalBoardStocks: 0, rawZTPool: [], qdate: null, totalCount: 0, isTradingDay: false };
}

async function fetchZTPoolForDate(d: string): Promise<LimitPoolSummary> {
  // v9.26.18：ZBPool/DT 改用 sort=fbt:asc（原 fund:asc 实际返回空数组，炸板率始终为 0）
  const ztUrl = `https://push2ex.eastmoney.com/getTopicZTPool?ut=${ZT_UT}&dpt=wz.ztzt&Pageindex=0&pagesize=500&sort=fbt:asc&date=${d}`;
  const zbUrl = `https://push2ex.eastmoney.com/getTopicZBPool?ut=${ZT_UT}&dpt=wz.ztzt&Pageindex=0&pagesize=500&sort=fbt:asc&date=${d}`;
  const dtUrl = `https://push2ex.eastmoney.com/getTopicDTPool?ut=${ZT_UT}&dpt=wz.ztzt&Pageindex=0&pagesize=500&sort=fbt:asc&date=${d}`;

  const [ztRes, zbRes, dtRes] = await Promise.allSettled([
    ztJsonp<any>(ztUrl), ztJsonp<any>(zbUrl), ztJsonp<any>(dtUrl),
  ]);

  const ztData = ztRes.status === "fulfilled" ? ztRes.value?.data : null;
  const zbData = zbRes.status === "fulfilled" ? zbRes.value?.data : null;
  const dtData = dtRes.status === "fulfilled" ? dtRes.value?.data : null;

  const ztPool: any[] = ztData?.pool ?? [];
  const zbPool: any[] = zbData?.pool ?? [];
  const dtPool: any[] = dtData?.pool ?? [];

  // 提取接口返回的真实交易日 qdate（优先涨停池，依次尝试炸板池、跌停池）
  const rawQdate = ztData?.qdate ?? zbData?.qdate ?? dtData?.qdate ?? null;
  const qdate: string | null = rawQdate ? String(rawQdate) : null;

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

  // v12-6（P1）：截断校验 —— pagesize=500 但接口可能实际截断（100/200 整数边界）→ 标"⚠ 可能截断"
  // push2ex/getTopicZTPool 与 clist/get 上限不同，运行时检测比注释靠谱
  const TRUNC_EDGES = [100, 200, 300, 400, 500];
  let truncated: string | undefined;
  for (const edge of TRUNC_EDGES) {
    if (ztPool.length === edge) {
      truncated = `⚠ 涨停池恰好 ${edge} 条（接口分页边界），可能被截断，请人工核对涨停数`;
      break;
    }
  }

  return { limitUpCount, limitDownCount, blastedCount, blastedRate, boardCounts, totalBoardStocks, rawZTPool: ztPool, rawZBPool: zbPool, rawDTPool: dtPool, qdate, truncated, totalCount: ztPool.length + zbPool.length + dtPool.length };
}

// ============== 两市历史日成交额（用于量能对比）==============
// 修复：beg=0 会返回 1990 年远古数据 + 限流 0% + 顺序请求降低并发
export interface TurnoverDay { date: string; amount: number; }

const turnoverCache = { data: null as TurnoverDay[] | null, ts: 0 };
const TURNOVER_TTL = 10 * 60 * 1000; // 10 分钟

function ymdPlus(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`;
}
export async function fetchTurnoverHistory(days = 10): Promise<TurnoverDay[]> {
  if (turnoverCache.data && Date.now() - turnoverCache.ts < TURNOVER_TTL) return turnoverCache.data;
  const fields2 = "f51,f52,f53,f54,f55,f56,f57";
  const beg = ymdPlus(-(days + 15));
  const end = ymdPlus(1);
  async function one(secid: string): Promise<Map<string, number>> {
    const url = `${PUSH2HIS}/stock/kline/get?secid=${secid}&fields1=f1,f2,f3&fields2=${fields2}&klt=101&fqt=0&beg=${beg}&end=${end}&ut=${EM_UT}`;
    for (let a = 0; a < 2; a++) {
      try {
        const json = await trackedJsonp<any>("成交额历史", url, 10000);
        const kl: string[] = json?.data?.klines ?? [];
        if (kl.length) {
          const m = new Map<string, number>();
          for (const line of kl) { const p = line.split(","); const amt = Number(p[6]); if (p[0] && Number.isFinite(amt)) m.set(p[0], amt); }
          if (m.size) return m;
        }
      } catch (e) { console.warn("[api] op failed", e); }
      await new Promise(r => setTimeout(r, 900 * (a + 1)));
    }
    return new Map();
  }
  try {
    const sh = await one("1.000001");
    const sz = await one("0.399001");
    const dates = new Set([...sh.keys(), ...sz.keys()]);
    const res = [...dates].map(date => ({ date, amount: (sh.get(date) ?? 0) + (sz.get(date) ?? 0) }));
    res.sort((a, b) => b.date.localeCompare(a.date));
    const sliced = res.slice(0, days);
    turnoverCache.data = sliced; turnoverCache.ts = Date.now();
    return sliced;
  } catch { return turnoverCache.data ?? []; }
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
    const json = await trackedJsonp<any>("解禁", url, 8000, "callback");
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

// ============== 全市场公告流（盘后公告淘金） ==============
// 同一接口去掉 stock_list 参数即为全市场公告流
// 为什么用 sr=-1：按时间倒序，最新公告在前
export interface MarketAnnouncement {
  artCode: string;     // 公告唯一标识
  stockCode: string;   // 股票代码
  stockName: string;   // 股票简称
  title: string;       // 公告标题
  columnName: string;  // 公告分类（如"临时公告"）
  time: string;        // 发布时间 "YYYY-MM-DD HH:mm:ss"
  url: string;         // 公告原文链接
}

export async function fetchMarketAnnouncements(pageSize = 100): Promise<MarketAnnouncement[]> {
  // 先尝试 page_size=100，失败降为 50
  for (const ps of [pageSize, 50]) {
    try {
      const url = `https://np-anotice-stock.eastmoney.com/api/security/ann?sr=-1&page_size=${ps}&page_index=1&ann_type=A&client_source=web&f_node=0&s_node=0`;
      const json = await trackedJsonp<any>("全市场公告", url, 15000);
      const list: any[] = json?.data?.list ?? [];
      if (list.length === 0 && ps === pageSize) continue; // 100 条空 → 降级尝试 50
      return list.map((item) => {
        const artCode = String(item.art_code ?? "");
        const codes: any[] = item.codes ?? [];
        const stockCode = codes.length > 0 ? String(codes[0].stock_code ?? "") : "";
        const stockName = codes.length > 0 ? String(codes[0].short_name ?? "") : "";
        const columns: any[] = item.columns ?? [];
        return {
          artCode,
          stockCode,
          stockName,
          title: String(item.title ?? ""),
          columnName: columns.length > 0 ? String(columns[0].column_name ?? "") : "",
          time: String(item.display_time ?? item.notice_date ?? ""),
          // 全市场公告链接：不带个股代码的通用格式
          url: stockCode
            ? `https://data.eastmoney.com/notices/detail/${stockCode}/${artCode}.html`
            : `https://data.eastmoney.com/notices/detail/-/${artCode}.html`,
        };
      });
    } catch {
      if (ps === 50) throw new Error("全市场公告接口不可用");
      // page_size=100 失败 → 降级重试
    }
  }
  throw new Error("全市场公告接口不可用");
}

// ============== 人气榜（散户关注度排行，用作反向指标） ==============
// POST 接口，JSONP 不适用；先 fetch 尝试，CORS 失败→抛异常由调用方显示"待接入"
export interface PopularityItem {
  code: string;
  name: string;
  rank: number;
  // 东财人气榜可能包含的字段（探测阶段按实际返回映射）
  market?: string;
}

export async function fetchPopularityRank(pageSize = 50): Promise<PopularityItem[]> {
  // v9.31：实测 emappdata.eastmoney.com **支持 CORS**（OPTIONS 预检 200 + Allow-Origin 回显任意 Origin），
  // 且不校验 Referer/Origin → **浏览器直连即可，线上线下均可用**。
  // 之前的 proxy 中转反而失败（emappdata 对 proxy 的 nodejs https.request 做 TLS 指纹 ban → 12s socket hang up）。
  const url = "https://emappdata.eastmoney.com/stockrank/getAllCurrentList";
  const body = {
    appId: "appId01",
    globalId: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    marketType: "",
    pageNo: 1,
    pageSize,
  };
  const start = Date.now();
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    recordApiCall("人气榜", true, Date.now() - start);
    const list: any[] = json?.data ?? [];
    return list.map((item, idx) => {
      const sc = String(item.sc ?? "");
      // sc 格式可能是 "SZ002173" 或 "SZ.002173" 或 "0.002173"
      const code = sc.replace(/^[A-Z]{2}\.?/, "").replace(/^\d+\./, "");
      // 名称字段探测：东财人气榜返回的字段名不确定，逐个尝试
      const name = String(item.name ?? item.sn ?? item.Name ?? item.SECURITY_NAME_ABBR ?? "");
      return {
        code: code || sc, // 如果解析失败就用原始值
        name,
        rank: idx + 1,
        market: sc.slice(0, 2),
      };
    });
  } catch (err) {
    recordApiCall("人气榜", false, Date.now() - start);
    throw new Error("人气榜接口不可用");
  }
}

// ============== 同花顺人气榜（v9.31：与东财双榜交叉比对） ==============
export interface THSPopularityItem {
  code: string;
  name: string;
  /** 同花顺榜内排名 */
  rank: number;
  /** 涨跌幅 % */
  riseAndFall: number;
  /** 热度值（字符串，大=热） */
  rate: string;
  /** 排名变化 */
  hotRankChg: number;
  /** 概念标签（如 ["光纤概念","第三代半导体"]） */
  concepts: string[];
  /** 人气标签（如 "2天2板"） */
  tag: string;
}

export async function fetchTHSPopularityRank(pageSize = 30): Promise<THSPopularityItem[]> {
  // 实测 dq.10jqka.com.cn 支持 CORS（OPTIONS 204 + Allow-Methods:* + Origin 回显）且不校验 Referer → 浏览器直连可用
  const url = "https://dq.10jqka.com.cn/fuyao/hot_list_data/out/hot_list/v1/stock?stock_type=a&type=hour&list_type=normal";
  const start = Date.now();
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    recordApiCall("同花顺人气榜", true, Date.now() - start);
    const list: any[] = json?.data?.stock_list ?? [];
    return list.slice(0, pageSize).map((s: any, i: number) => ({
      code: String(s.code ?? ""),
      name: String(s.name ?? ""),
      rank: Number(s.order) || i + 1,
      riseAndFall: num(s.rise_and_fall),
      rate: String(s.rate ?? ""),
      hotRankChg: num(s.hot_rank_chg),
      concepts: Array.isArray(s.tag?.concept_tag) ? s.tag.concept_tag : [],
      tag: String(s.tag?.popularity_tag ?? ""),
    }));
  } catch (err) {
    recordApiCall("同花顺人气榜", false, Date.now() - start);
    throw new Error("同花顺人气榜接口不可用");
  }
}

// ============== 批量查询个股行情（名称/价格/涨幅/成交额） ==============
// 为什么：人气榜接口只返回代码不返回名称，需要二次查询补全
export interface StockBrief {
  code: string;
  name: string;
  price: number;
  pct: number;
  amount: number; // 成交额(元)
  turnoverRate: number; // 换手率
  volumeRatio?: number; // 量比（f10，v9.24-P1-4 异动分级用）
}

export async function fetchStockBriefBatch(codes: string[]): Promise<Map<string, StockBrief>> {
  if (codes.length === 0) return new Map();
  // push2 ulist.np 单次最多约 100 只 secids；v9.26.17 自动分批支持 > 100 只
  const map = new Map<string, StockBrief>();
  for (let i = 0; i < codes.length; i += 100) {
    const chunk = codes.slice(i, i + 100);
    const secids = chunk.map(c => toSecid(c)).join(",");
    const url = `${PUSH2}/ulist.np/get?ut=${EM_UT}&fltt=2&fields=f2,f3,f6,f8,f10,f12,f14&secids=${secids}`;
    try {
      const json = await trackedJsonp<any>("人气榜行情", url, 10000);
      const diff = normalizeDiff(json?.data?.diff);
      for (const d of diff) {
        const code = String(d.f12 ?? "");
        if (code) {
          map.set(code, {
            code,
            name: String(d.f14 ?? ""),
            price: num(d.f2),
            pct: num(d.f3),
            amount: num(d.f6),
            turnoverRate: num(d.f8),
            volumeRatio: num(d.f10),
          });
        }
      }
    } catch { /* 单批失败跳过 */ }
  }
  return map;
}

/** 全市场 股票代码 -> 申万行业（f128=行业），分页拉取 */
export async function fetchStockIndustryMap(): Promise<Record<string, string>> {
  const fs = "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81";
  const fields = "f12,f14,f128";
  const out: Record<string, string> = {};
  for (let pn = 1; pn <= 10; pn++) {
    const url = `${PUSH2}/clist/get?ut=${EM_UT}&pn=${pn}&pz=2000&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${fs}&fields=${fields}`;
    const json = await jsonp<any>(url, 12000);
    const diff = normalizeDiff(json?.data?.diff);
    if (diff.length === 0) break;
    for (const d of diff) {
      const code = String(d.f12 ?? "");
      const ind = String(d.f128 ?? "").trim();
      if (code && ind) out[code] = ind;
    }
    if (diff.length < 2000) break;
  }
  return out;
}

/** 取个股近N日{日期:收盘价}，用于推荐命中率的真实T+1/T+3回填 */
export async function fetchStockDailyCloses(code: string, days = 40): Promise<Map<string, number>> {
  try {
    const url = `${PUSH2HIS}/stock/kline/get?secid=${toSecid(code)}&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55&klt=101&fqt=0&lmt=${days}&ut=${EM_UT}`;
    const json = await jsonp<any>(url, 10000);
    const kl: string[] = json?.data?.klines ?? [];
    const m = new Map<string, number>();
    for (const line of kl) {
      const p = line.split(",");
      const c = Number(p[2]);
      if (p[0] && Number.isFinite(c)) m.set(p[0], c);
    }
    return m;
  } catch {
    return new Map();
  }
}
