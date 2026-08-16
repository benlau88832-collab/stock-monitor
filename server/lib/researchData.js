// ============================================================
// v9.144.0 个股投研数据：研报一致预期 / 机构调研 / 股东户数 / 限售解禁
// 数据源：东财 reportapi + datacenter-web；服务端直连，失败返回空数组。
// ============================================================
const { getJson } = require("./outbound");

const DATACENTER = "https://datacenter-web.eastmoney.com/api/data/v1/get";
const REPORT = "https://reportapi.eastmoney.com/report/list";

const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v))) ? null : Number(v);

async function fetchResearchReportsServer(code, limit = 10, _getJson = getJson) {
  const url = `${REPORT}?industryCode=*&pageSize=${limit}&industry=*&rating=*&ratingChange=*&beginTime=2024-01-01&endTime=2030-12-31&pageNo=1&fields=&qType=0&orgCode=&code=${code}`;
  try {
    const r = await _getJson(url, { timeout: 6000, source: "reportapi", headers: { Referer: "https://data.eastmoney.com/" } });
    const list = Array.isArray(r.data?.data) ? r.data.data : [];
    return list.slice(0, limit).map((d) => ({
      title: String(d.title ?? ""),
      orgName: String(d.orgSName || d.orgName || ""),
      publishDate: String(d.publishDate ?? "").slice(0, 10),
      rating: String(d.emRatingName || d.sRatingName || ""),
      ratingChange: num(d.ratingChange),
      predictThisYearEps: num(d.predictThisYearEps),
      predictThisYearPe: num(d.predictThisYearPe),
      predictNextYearEps: num(d.predictNextYearEps),
      predictNextYearPe: num(d.predictNextYearPe),
      author: Array.isArray(d.author) ? d.author.map(String).join("、") : String(d.researcher ?? ""),
      url: d.encodeUrl ? `https://data.eastmoney.com/report/zw_industry.jshtml?encodeUrl=${encodeURIComponent(String(d.encodeUrl))}` : "",
    }));
  } catch {
    return [];
  }
}

// v9.150.0（P2-1）：研报覆盖/评级数量趋势（东财 reportapi 真实研报列表按月聚合）
async function fetchResearchRatingTrendServer(code, limit = 200, _getJson = getJson) {
  const reports = await fetchResearchReportsServer(code, limit, _getJson);
  const byMonth = new Map();
  for (const r of reports) {
    const month = String(r.publishDate || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    const bucket = byMonth.get(month) || { month, total: 0, ratings: {} };
    bucket.total++;
    const rating = String(r.rating || "未评级");
    bucket.ratings[rating] = (bucket.ratings[rating] || 0) + 1;
    byMonth.set(month, bucket);
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-6);
}

async function fetchInstitutionSurveysServer(code, limit = 10) {
  const url = `${DATACENTER}?reportName=RPT_ORG_SURVEYNEW&columns=ALL&filter=(SECURITY_CODE%3D%22${code}%22)&pageNumber=1&pageSize=${limit}&sortColumns=NOTICE_DATE&sortTypes=-1&source=WEB&client=WEB`;
  try {
    const r = await getJson(url, { timeout: 6000, source: "datacenter" });
    const list = Array.isArray(r.data?.result?.data) ? r.data.result.data : [];
    return list.slice(0, limit).map((d) => ({
      noticeDate: String(d.NOTICE_DATE ?? "").slice(0, 10),
      receiveDate: String(d.RECEIVE_START_DATE ?? d.RECEIVE_END_DATE ?? "").slice(0, 10),
      receiveWay: String(d.RECEIVE_WAY_EXPLAIN ?? ""),
      receiveObject: String(d.RECEIVE_OBJECT ?? ""),
      investigators: String(d.INVESTIGATORS ?? ""),
      receptionist: String(d.RECEPTIONIST ?? ""),
      num: num(d.NUM),
      source: String(d.SOURCE ?? ""),
    }));
  } catch {
    return [];
  }
}

async function fetchHolderCountServer(code) {
  const url = `${DATACENTER}?reportName=RPT_HOLDERNUMLATEST&columns=ALL&filter=(SECURITY_CODE%3D%22${code}%22)&pageNumber=1&pageSize=1&sortColumns=END_DATE&sortTypes=-1&source=WEB&client=WEB`;
  try {
    const r = await getJson(url, { timeout: 6000, source: "datacenter" });
    const d = r.data?.result?.data?.[0];
    if (!d) return null;
    return {
      endDate: String(d.END_DATE ?? "").slice(0, 10),
      holderNum: num(d.HOLDER_NUM),
      preHolderNum: num(d.PRE_HOLDER_NUM),
      holderNumChange: num(d.HOLDER_NUM_CHANGE),
      holderNumRatio: num(d.HOLDER_NUM_RATIO),
      avgHoldNum: num(d.AVG_HOLD_NUM),
      closePrice: num(d.CLOSE_PRICE),
    };
  } catch {
    return null;
  }
}

async function fetchLiftBanServer(code, limit = 5) {
  const url = `${DATACENTER}?reportName=RPT_LIFT_STAGE&columns=ALL&filter=(SECURITY_CODE%3D%22${code}%22)&pageNumber=1&pageSize=${limit}&sortColumns=FREE_DATE&sortTypes=1&source=WEB&client=WEB`;
  try {
    const r = await getJson(url, { timeout: 6000, source: "datacenter" });
    const list = Array.isArray(r.data?.result?.data) ? r.data.result.data : [];
    return list.slice(0, limit).map((d) => ({
      freeDate: String(d.FREE_DATE ?? "").slice(0, 10),
      liftMarketCap: num(d.LIFT_MARKET_CAP),
      freeRatio: num(d.FREE_RATIO),
      holder: String(d.HOLDER_NAME ?? ""),
    }));
  } catch {
    return [];
  }
}

module.exports = { fetchResearchReportsServer, fetchResearchRatingTrendServer, fetchInstitutionSurveysServer, fetchHolderCountServer, fetchLiftBanServer };
