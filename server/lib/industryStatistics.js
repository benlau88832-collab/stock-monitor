// ============================================================
// v9.150.0（P2-4）：外部统计口径/协会数据真实接入
// 数据源：非凸数据网关（底层整理自国家统计局/海关总署等公开统计口径）
// 落库：industry_macro_signal —— 不再只有“适配器注释”，而是真实可查询的本地 SQL。
// ============================================================
const { getJson } = require("./outbound");

const GATEWAY = "https://market.ft.tech/gateway/api/v1/market/data/economic";
const HEADERS = { "X-Client-Name": "ft-claw" };

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toPeriod(month) {
  const m = String(month || "").replace(/[年月日份]/g, "-").replace(/-+$/, "");
  return /^\d{4}-\d{2}$/.test(m) ? m : null;
}

const PROVIDERS = [
  {
    endpoint: "china-pmi",
    label: "中国PMI",
    map(row) {
      return [
        { indicator: "pmi_manufacturing", label: "制造业PMI", period: toPeriod(row.month), value: num(row.manufacturing_pmi), yoy: num(row.manufacturing_yoy), mom: num(row.manufacturing_mom), unit: "指数" },
        { indicator: "pmi_non_manufacturing", label: "非制造业PMI", period: toPeriod(row.month), value: num(row.non_manufacturing_pmi), yoy: num(row.non_manufacturing_yoy), mom: num(row.non_manufacturing_mom), unit: "指数" },
      ];
    },
  },
  {
    endpoint: "china-customs-trade",
    label: "海关进出口",
    map(row) {
      return [
        { indicator: "customs_export", label: "出口金额", period: toPeriod(row.month), value: num(row.export_current), yoy: num(row.export_yoy), mom: num(row.export_mom), unit: "亿美元" },
        { indicator: "customs_import", label: "进口金额", period: toPeriod(row.month), value: num(row.import_current), yoy: num(row.import_yoy), mom: num(row.import_mom), unit: "亿美元" },
      ];
    },
  },
  {
    endpoint: "china-industrial-added-value",
    label: "工业增加值",
    map(row) {
      return [{ indicator: "industrial_added_value", label: "工业增加值同比", period: toPeriod(row.month), value: null, yoy: num(row.yoy), mom: null, unit: "%" }];
    },
  },
  {
    endpoint: "china-fixed-asset-investment",
    label: "城镇固定资产投资",
    map(row) {
      return [{ indicator: "fixed_asset_investment", label: "固定资产投资", period: toPeriod(row.month), value: num(row.investment), yoy: num(row.yoy), mom: num(row.mom), unit: "亿元" }];
    },
  },
  {
    endpoint: "china-cpi",
    label: "全国CPI",
    map(row) {
      return [{ indicator: "cpi_national", label: "全国CPI", period: toPeriod(row.month), value: num(row.national_cpi), yoy: num(row.national_yoy), mom: num(row.national_mom), unit: "指数" }];
    },
  },
  {
    endpoint: "china-ppi",
    label: "全国PPI",
    map(row) {
      return [{ indicator: "ppi", label: "工业品出厂价格指数", period: toPeriod(row.month), value: num(row.ppi), yoy: num(row.yoy), mom: num(row.mom), unit: "指数" }];
    },
  },
];

async function fetchProvider(pool, provider, json = getJson) {
  const url = `${GATEWAY}/${provider.endpoint}`;
  const r = await json(url, { timeout: 12000, viaProxy: true, headers: HEADERS, source: `ftshareGateway:${provider.endpoint}` });
  const rows = Array.isArray(r.data?.data) ? r.data.data : [];
  let inserted = 0;
  for (const row of rows) {
    for (const item of provider.map(row)) {
      if (!item.period) continue;
      try {
        await pool.query(
          `INSERT INTO industry_macro_signal(indicator,indicator_label,period,value,unit,yoy,mom,source,source_url,fetched_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
           ON CONFLICT(indicator,period) DO UPDATE SET
             indicator_label=EXCLUDED.indicator_label,value=EXCLUDED.value,unit=EXCLUDED.unit,
             yoy=EXCLUDED.yoy,mom=EXCLUDED.mom,source=EXCLUDED.source,source_url=EXCLUDED.source_url,fetched_at=now()`,
          [item.indicator, item.label, item.period, item.value, item.unit, item.yoy, item.mom, `ftshareGateway:${provider.label}`, url],
        );
        inserted++;
      } catch { /* 单条写入失败不阻塞整批 */ }
    }
  }
  return { endpoint: provider.endpoint, rows: rows.length, inserted };
}

async function syncIndustryMacroSignals(pool, opts = {}) {
  const json = opts._getJson || getJson;
  const results = await Promise.allSettled(PROVIDERS.map((p) => fetchProvider(pool, p, json)));
  const ok = [];
  const failed = [];
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === "fulfilled") ok.push(results[i].value);
    else failed.push({ endpoint: PROVIDERS[i].endpoint, error: String(results[i].reason?.message ?? results[i].reason).slice(0, 80) });
  }
  return { ok, failed, at: new Date().toISOString() };
}

async function getIndustryMacroSignals(pool, limit = 12) {
  try {
    const r = await pool.query(
      `SELECT indicator,indicator_label,period,value,unit,yoy,mom,source,source_url,fetched_at
       FROM industry_macro_signal ORDER BY period DESC LIMIT $1`,
      [Math.max(6, Math.min(36, Number(limit) || 12))],
    );
    return r.rows;
  } catch {
    return [];
  }
}

module.exports = { syncIndustryMacroSignals, getIndustryMacroSignals, PROVIDERS };
