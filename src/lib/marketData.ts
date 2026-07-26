import { emGet, toSecid, toSecuCode, marketPrefix } from "./em";
import type { FundFlowRow, IndexQuote, MarketBreadth } from "./types";

const PUSH2 = "https://push2.eastmoney.com/api/qt";
const DATACENTER = "https://datacenter-web.eastmoney.com/api/data/v1/get";
const ANN_API = "https://np-anotice-stock.eastmoney.com/api/security/ann";
const NEWS_API = "https://np-weblist.eastmoney.com/comm/web/getFastNewsList";

export const MAJOR_INDICES = [
  { secid: "1.000001", name: "上证指数" },
  { secid: "0.399001", name: "深证成指" },
  { secid: "0.399006", name: "创业板指" },
  { secid: "1.000688", name: "科创50" },
  { secid: "1.000300", name: "沪深300" },
];

// 全球主要市场指数 secid（东方财富全球市场）
export const GLOBAL_INDICES = [
  { secid: "100.NDX", name: "纳斯达克100", url: "https://www.nasdaq.com/" },
  { secid: "100.DJIA", name: "道琼斯工业指数", url: "https://www.marketwatch.com/investing/index/djia" },
  { secid: "100.SPX", name: "标普500", url: "https://www.marketwatch.com/investing/index/spx" },
  { secid: "100.HSI", name: "恒生指数", url: "https://www.hsi.com.hk/" },
  { secid: "100.N225", name: "日经225", url: "https://indexes.nikkei.co.jp/nkave/" },
  { secid: "100.GDAXI", name: "德国DAX", url: "https://www.deutsche-boerse.com/" },
  { secid: "100.FTSE", name: "英国富时100", url: "https://www.ft.com/" },
  { secid: "100.AS51", name: "澳洲标普200", url: "https://www.asx.com.au/" },
];

function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function fetchIndexOverview(): Promise<IndexQuote[]> {
  const secids = MAJOR_INDICES.map((i) => i.secid).join(",");
  const url = `${PUSH2}/ulist.np/get?fltt=2&fields=f2,f3,f4,f12,f14&secids=${secids}`;
  const json = await emGet(url);
  const diff = json?.data?.diff ?? [];
  return diff.map((d: any) => ({
    code: d.f12,
    name: d.f14,
    price: num(d.f2),
    pct: num(d.f3),
    change: num(d.f4),
  }));
}

// 全球市场指数实时数据
export async function fetchGlobalIndices(): Promise<Array<{
  name: string;
  price: number;
  pct: number;
  change: number;
  url: string;
}>> {
  try {
    const secids = GLOBAL_INDICES.map((i) => i.secid).join(",");
    const url = `${PUSH2}/ulist.np/get?fltt=2&fields=f2,f3,f4,f12,f14&secids=${secids}`;
    const json = await emGet(url, 10000);
    const diff: any[] = json?.data?.diff ?? [];
    const nameMap = new Map(GLOBAL_INDICES.map((g) => [g.secid.split(".")[1], g]));
    return diff.map((d: any) => {
      const code = d.f12;
      const match = GLOBAL_INDICES.find((g) => g.secid.includes(code));
      return {
        name: match?.name || d.f14 || code,
        price: num(d.f2),
        pct: num(d.f3),
        change: num(d.f4),
        url: match?.url || "https://quote.eastmoney.com/center/global.html",
      };
    });
  } catch {
    return [];
  }
}

// 全市场涨跌家数 / 涨跌停家数，用于情绪温度计
// 涵盖沪深全部A股 fs: m:0+t:6 深主板 m:0+t:80 创业板 m:1+t:2 沪主板 m:1+t:23 科创板 m:0+t:81+s:2048 北证
export async function fetchMarketBreadth(): Promise<MarketBreadth> {
  const fs = "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048";
  const url = `${PUSH2}/clist/get?pn=1&pz=8000&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${fs}&fields=f2,f3,f12`;
  const json = await emGet(url, 15000);
  const total_count = num(json?.data?.total);
  const diff: any[] = json?.data?.diff ?? [];
  let up = 0,
    down = 0,
    flat = 0,
    limitUp = 0,
    limitDown = 0,
    sum = 0;
  for (const d of diff) {
    const pct = num(d.f3);
    sum += pct;
    if (pct > 0) up++;
    else if (pct < 0) down++;
    else flat++;
    if (pct >= 9.8) limitUp++;
    if (pct <= -9.8) limitDown++;
  }
  // Use the total from API if available, otherwise use diff.length
  const totalStocks = total_count > diff.length ? total_count : diff.length;
  return {
    total: totalStocks,
    up,
    down,
    flat,
    limitUp,
    limitDown,
    avgPct: diff.length ? sum / diff.length : 0,
  };
}

// 沪深两市主力资金净流入合计（以沪深指数资金流作为两市代理，行业通用做法）
export async function fetchMarketMainFund() {
  const url = `${PUSH2}/ulist.np/get?fltt=2&fields=f2,f3,f12,f14,f62,f66,f69,f72,f75,f78,f81,f84,f87,f164,f165,f174,f175,f184&secids=1.000001,0.399001`;
  const json = await emGet(url);
  const diff: any[] = json?.data?.diff ?? [];
  const agg = {
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

// 北向资金：东财官方接口自 2024 年 8 月起该字段普遍返回 0/空（行业性数据断供），
// 这里如实返回原始值，并在上层标注数据可信度，绝不编造数值。
export async function fetchNorthbound(): Promise<{ available: boolean; net: number; note: string }> {
  try {
    const url = `${PUSH2}/kamt.kline/get?fields1=f1,f3,f5&fields2=f51,f52&klt=101&lmt=1`;
    const json = await emGet(url, 6000);
    const s2n: string[] = json?.data?.s2n ?? [];
    if (!s2n.length) {
      return { available: false, net: 0, note: "东方财富北向资金接口暂无返回，数据不完整" };
    }
    const last = s2n[s2n.length - 1];
    const val = num(last.split(",")[1]);
    if (val === 0) {
      return {
        available: false,
        net: 0,
        note: "东方财富北向资金字段当前返回 0（已知官方接口自 2024 年 8 月起间歇性断供），仅供参考不计入决策",
      };
    }
    return { available: true, net: val * 10000, note: "数据源：东方财富沪深港通资金流" };
  } catch {
    return { available: false, net: 0, note: "北向资金接口请求失败，数据不完整" };
  }
}

const BOARD_FS: Record<"industry" | "concept" | "region", string> = {
  region: "m:90+t:1",
  industry: "m:90+t:2",
  concept: "m:90+t:3",
};

export async function fetchBoardFundFlow(
  boardType: "industry" | "concept" | "region",
  limit = 15,
) {
  const fs = BOARD_FS[boardType];
  const fields = "f12,f14,f3,f62,f66,f72,f78,f84,f164,f165,f174,f175,f184";
  const url = `${PUSH2}/clist/get?pn=1&pz=${limit}&po=1&np=1&fltt=2&invt=2&fid=f62&fs=${fs}&fields=${fields}`;
  const json = await emGet(url);
  const diff: any[] = json?.data?.diff ?? [];
  return diff.map((d) => ({
    code: d.f12,
    name: d.f14,
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

export async function fetchBoardConstituents(boardCode: string, limit = 10): Promise<FundFlowRow[]> {
  const fields = "f12,f14,f2,f3,f62,f66,f72,f78,f84,f184,f8,f9,f10";
  const url = `${PUSH2}/clist/get?pn=1&pz=${limit}&po=1&np=1&fltt=2&invt=2&fid=f62&fs=b:${boardCode}&fields=${fields}`;
  const json = await emGet(url);
  const diff: any[] = json?.data?.diff ?? [];
  return diff.map((d) => ({
    code: d.f12,
    name: d.f14,
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

export async function fetchStockBatch(codes: string[]): Promise<FundFlowRow[]> {
  if (!codes.length) return [];
  const secids = codes.map(toSecid).join(",");
  const fields =
    "f2,f3,f12,f14,f8,f9,f10,f62,f66,f69,f72,f75,f78,f81,f84,f87,f164,f165,f174,f175,f184";
  const url = `${PUSH2}/ulist.np/get?fltt=2&fields=${fields}&secids=${secids}`;
  const json = await emGet(url);
  const diff: any[] = json?.data?.diff ?? [];
  return diff.map((d) => ({
    code: d.f12,
    name: d.f14,
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
  }));
}

export async function fetchStockOne(code: string): Promise<FundFlowRow | null> {
  const rows = await fetchStockBatch([code]);
  return rows[0] ?? null;
}

// 股权质押比例（东方财富数据中心 RPT_CSDC_LIST，取该股最近一次披露记录）
export async function fetchPledgeRatio(code: string): Promise<{ ratio: number | null; date: string | null }> {
  try {
    const url = `${DATACENTER}?sortColumns=TRADE_DATE&sortTypes=-1&pageSize=1&pageNumber=1&reportName=RPT_CSDC_LIST&columns=ALL&source=WEB&client=WEB&filter=(SECURITY_CODE%3D%22${code}%22)`;
    const json = await emGet(url, 8000);
    const row = json?.result?.data?.[0];
    if (!row) return { ratio: null, date: null };
    return { ratio: num(row.PLEDGE_RATIO), date: String(row.TRADE_DATE).slice(0, 10) };
  } catch {
    return { ratio: null, date: null };
  }
}

// 核心财务指标（现金流 / 偿债能力），用于风险雷达
export async function fetchFinanceIndicator(code: string) {
  try {
    const secu = toSecuCode(code);
    const url = `${DATACENTER}?reportName=RPT_F10_FINANCE_MAINFINADATA&columns=ALL&filter=(SECUCODE%3D%22${secu}%22)&pageSize=1&pageNumber=1&sortColumns=REPORT_DATE&sortTypes=-1`;
    const json = await emGet(url, 8000);
    const row = json?.result?.data?.[0];
    if (!row) return null;
    return {
      reportDate: String(row.REPORT_DATE ?? "").slice(0, 10),
      debtRatio: row.ZCFZL != null ? num(row.ZCFZL) : null, // 资产负债率 %
      currentRatio: row.LD != null ? num(row.LD) : null, // 流动比率
      quickRatio: row.SD != null ? num(row.SD) : null, // 速动比率
      cashFlowPerShare: row.MGJYXJJE != null ? num(row.MGJYXJJE) : null, // 每股经营现金流
      cashFlowToRevenue: row.JYXJLYYSR != null ? num(row.JYXJLYYSR) : null, // 经营现金流/营收
      netProfitGrowth: row.PARENTNETPROFITTZ != null ? num(row.PARENTNETPROFITTZ) : null,
      roe: row.ROEJQ != null ? num(row.ROEJQ) : null,
      revenueGrowth: row.YYZSRTBZZ != null ? num(row.YYZSRTBZZ) : null,
    };
  } catch {
    return null;
  }
}

const REDUCTION_KEYWORDS = ["减持", "权益变动", "清仓", "股份变动计划", "拟减持", "简式权益"];
const REGULATORY_KEYWORDS = [
  "问询函",
  "关注函",
  "监管函",
  "立案",
  "警示函",
  "处分",
  "违规",
  "退市风险",
  "监管工作函",
  "调查通知书",
];
const POSITIVE_KEYWORDS = [
  "利好",
  "中标",
  "重大合同",
  "业绩预增",
  "业绩快报",
  "分红",
  "回购",
  "增持",
  "战略合作",
  "产能扩张",
  "新产品",
  "获批",
  "入选",
  "政策支持",
  "补贴",
  "突破",
];
const INDUSTRY_POLICY_KEYWORDS = [
  "行业政策",
  "产业政策",
  "国家标准",
  "规划",
  "指导意见",
  "实施方案",
  "行动计划",
  "扶持",
  "鼓励",
  "发展",
];

export async function fetchAnnouncementRisk(code: string) {
  try {
    const url = `${ANN_API}?sr=-1&page_size=50&page_index=1&ann_type=A&client_source=web&stock_list=${code}&f_node=0&s_node=0`;
    const json = await emGet(url, 8000);
    const list: any[] = json?.data?.list ?? [];
    const reduction = list.filter((it) => REDUCTION_KEYWORDS.some((k) => (it.title || "").includes(k)));
    const regulatory = list.filter((it) => REGULATORY_KEYWORDS.some((k) => (it.title || "").includes(k)));
    const positive = list.filter((it) => POSITIVE_KEYWORDS.some((k) => (it.title || "").includes(k)));
    const industryPolicy = list.filter((it) => INDUSTRY_POLICY_KEYWORDS.some((k) => (it.title || "").includes(k)));
    return {
      available: true,
      reduction: reduction.slice(0, 3).map((it) => ({ date: it.notice_date?.slice(0, 10), title: it.title })),
      regulatory: regulatory.slice(0, 3).map((it) => ({ date: it.notice_date?.slice(0, 10), title: it.title })),
      positive: positive.slice(0, 5).map((it) => ({ date: it.notice_date?.slice(0, 10), title: it.title })),
      industryPolicy: industryPolicy.slice(0, 3).map((it) => ({ date: it.notice_date?.slice(0, 10), title: it.title })),
    };
  } catch {
    return { available: false, reduction: [], regulatory: [], positive: [], industryPolicy: [] };
  }
}

export async function fetchGlobalNews(size = 15) {
  try {
    const url = `${NEWS_API}?client=web&biz=web_724&fastColumn=102&sortEnd=&pageSize=${size}&req_trace=${Date.now()}`;
    const json = await emGet(url, 8000);
    const list: any[] = json?.data?.fastNewsList ?? [];
    return list.map((it) => ({
      title: it.title || it.summary?.slice(0, 60) || "",
      summary: it.summary,
      time: it.showTime || it.senTime || "",
      url: it.url || "",
    }));
  } catch {
    return [];
  }
}

// 沪深两市成交额（from index data f20 总市值 f21 成交额）
export async function fetchMarketTurnover(): Promise<{ amount: number; available: boolean }> {
  try {
    const url = `${PUSH2}/ulist.np/get?fltt=2&fields=f2,f3,f12,f14,f6&secids=1.000001,0.399001`;
    const json = await emGet(url, 6000);
    const diff: any[] = json?.data?.diff ?? [];
    let totalAmount = 0;
    for (const d of diff) {
      totalAmount += num(d.f6);
    }
    return { amount: totalAmount, available: totalAmount > 0 };
  } catch {
    return { amount: 0, available: false };
  }
}

// 融资融券余额
export async function fetchMarginBalance(): Promise<{ rzBalance: number; rqBalance: number; available: boolean }> {
  try {
    const url = `${DATACENTER}?sortColumns=TRADE_DATE&sortTypes=-1&pageSize=1&pageNumber=1&reportName=RPTA_WEB_RZRQ_GGMX&columns=ALL&source=WEB&client=WEB`;
    const json = await emGet(url, 8000);
    const row = json?.result?.data?.[0];
    if (!row) return { rzBalance: 0, rqBalance: 0, available: false };
    return {
      rzBalance: num(row.RZYE),
      rqBalance: num(row.RQYE),
      available: true,
    };
  } catch {
    return { rzBalance: 0, rqBalance: 0, available: false };
  }
}

export { marketPrefix };
