// ============================================================
// v9.98.0（批次 3）：基本面体检（investool checker 移植）
// - fetchFundamentals：东财 F10 财务（RPT_F10_FINANCE_MAINFINADATA 8 期）+ 估值（RPT_VALUEANALYSIS_DET）
// - checkFundamentals：阈值常量表 + 银行专项 + desc/ok 双字段（desc 人类可读直接喂 LLM）
// - 合理价：年报 EPS × (1+营收同比/100) × 基准 PE；空窗回退（最新报告期非年报 → 取最近年报）
// - 银行识别：SECURITY_NAME_ABBR 含"银行" → 负债率/ROE 豁免，资本充足率 NEWCAPITALADER 专项
// ============================================================
const { getJson } = require("./outbound");
const { persistFundamentalHistory, getFundamentalTrend, getPeerComparison } = require("./fundamentalTrend");
const { fetchResearchRatingTrendServer } = require("./researchData");

const DATACENTER = "https://datacenter-web.eastmoney.com/api/data/v1/get";

// ---------- 阈值常量表（investool DefaultCheckerOptions 对照，全部可配置覆盖） ----------
const DEFAULT_OPTIONS = {
  minROE: 8,             // 加权 ROE ≥ 8%
  maxDebtAssetRatio: 60, // 资产负债率 ≤ 60%（银行豁免）
  maxPEG: 1.5,           // PEG ≤ 1.5（PE/净利增速代理）
  minTotalMarketCap: 100e8, // 最小市值 100 亿
  minEPS: 0,             // EPS ≥ 0（不亏损）
  basePE: 20,            // 合理价基准 PE（中性）
  bankMinCapitalAdequacy: 8, // 银行资本充足率 ≥ 8
};

/** 判断是否银行股（名称含"银行"） */
function isBank(name) {
  return /银行/.test(String(name ?? ""));
}

// ---------- 数据获取 ----------
/** F10 财务主数据（近 8 期，含年报用于合理价）+ 估值快照 */
async function fetchFundamentals(code) {
  const finUrl = `${DATACENTER}?reportName=RPT_F10_FINANCE_MAINFINADATA&columns=ALL&filter=(SECURITY_CODE%3D%22${code}%22)&pageNumber=1&pageSize=8&source=HSF10&client=WEB`;
  const valUrl = `${DATACENTER}?reportName=RPT_VALUEANALYSIS_DET&columns=ALL&filter=(SECURITY_CODE%3D%22${code}%22)&pageNumber=1&pageSize=1&sortColumns=TRADE_DATE&sortTypes=-1&source=HSF10&client=WEB`;
  const [finRes, valRes] = await Promise.allSettled([
    getJson(finUrl, { timeout: 10000 }),
    getJson(valUrl, { timeout: 10000 }),
  ]);
  const finRows = finRes.status === "fulfilled" ? finRes.value?.data?.result?.data ?? [] : [];
  const valRows = valRes.status === "fulfilled" ? valRes.value?.data?.result?.data ?? [] : [];
  const latest = finRows[0] ?? null;
  // 年报行（最近一个 12-31 报告期，空窗回退 -1/-2 年）
  const annual = finRows.find(r => String(r.REPORT_DATE ?? "").includes("12-31")) ?? null;
  const valuation = valRows[0] ?? null;
  return { latest, annual, valuation, finRows, name: latest?.SECURITY_NAME_ABBR ?? null };
}

// ---------- 体检（阈值表 + 银行专项 + desc/ok） ----------
function checkFundamentals(f, opts = {}) {
  const o = { ...DEFAULT_OPTIONS, ...opts };
  const checks = [];
  const latest = f.latest;
  const annual = f.annual;
  const val = f.valuation;
  const bank = isBank(f.name);

  if (!latest) return { checks: [], metrics: null, bank, error: "F10 财务数据不可用" };

  const roe = latest.ROEJQ;                       // 加权 ROE %
  const debt = latest.ZCFZL;                      // 资产负债率 %
  const eps = latest.EPSJB ?? annual?.EPSJB;      // 每股收益（最新期或年报）
  const revTz = latest.TOTALOPERATEREVETZ ?? 0;   // 营收同比 %
  const profitTz = latest.PARENTNETPROFITTZ ?? 0; // 净利同比 %
  const gross = latest.XSMLL;                     // 毛利率 %
  const cashPs = latest.MGJYXJJE;                 // 每股经营现金流
  const peTtm = val?.PE_TTM ?? null;              // PE(TTM)
  const marketCap = val?.TOTAL_MARKET_CAP ?? null;// 总市值（元）
  const capAdeq = latest.NEWCAPITALADER ?? null;  // 银行资本充足率 %

  const metrics = { roe, debt, eps, revTz, profitTz, gross, cashPs, peTtm, marketCap, capAdeq, reportDate: latest.REPORT_DATE, bank };

  // ---- ROE（银行豁免） ----
  if (roe == null) checks.push({ name: "净资产收益率(ROE)", desc: "ROE 数据缺失", ok: false });
  else if (bank) checks.push({ name: "净资产收益率(ROE)", desc: `ROE ${roe.toFixed(2)}%（银行豁免）`, ok: true });
  else checks.push({ name: "净资产收益率(ROE)", desc: `ROE ${roe.toFixed(2)}%（阈值≥${o.minROE}）`, ok: roe >= o.minROE });

  // ---- 资产负债率（银行豁免） ----
  if (bank) checks.push({ name: "资产负债率", desc: `负债率 ${debt?.toFixed(1) ?? "—"}%（银行豁免）`, ok: true });
  else if (debt == null) checks.push({ name: "资产负债率", desc: "负债率数据缺失", ok: false });
  else checks.push({ name: "资产负债率", desc: `负债率 ${debt.toFixed(1)}%（阈值≤${o.maxDebtAssetRatio}）`, ok: debt <= o.maxDebtAssetRatio });

  // ---- 银行专项：资本充足率 ----
  if (bank) {
    if (capAdeq == null) checks.push({ name: "资本充足率", desc: "数据缺失", ok: false });
    else checks.push({ name: "资本充足率", desc: `资本充足率 ${capAdeq.toFixed(2)}%（阈值≥${o.bankMinCapitalAdequacy}）`, ok: capAdeq >= o.bankMinCapitalAdequacy });
  }

  // ---- EPS（不亏损） ----
  if (eps == null) checks.push({ name: "每股收益(EPS)", desc: "EPS 数据缺失", ok: false });
  else checks.push({ name: "每股收益(EPS)", desc: `EPS ${eps}（${eps >= 0 ? "盈利" : "亏损"}）`, ok: eps >= o.minEPS });

  // ---- 成长（营收同比） ----
  checks.push({ name: "营收成长", desc: `营收同比 ${revTz?.toFixed(1) ?? "—"}%${profitTz != null ? ` · 净利同比 ${profitTz.toFixed(1)}%` : ""}`, ok: (revTz ?? -999) > 0 || (profitTz ?? -999) > 0 });

  // ---- PEG（PE/净利同比，净利增速≤0 时用营收增速代理） ----
  if (peTtm != null && peTtm > 0) {
    const g = profitTz != null && profitTz > 0 ? profitTz : (revTz > 0 ? revTz : null);
    const peg = g != null ? peTtm / g : null;
    checks.push({ name: "PEG", desc: peg != null ? `PE ${peTtm.toFixed(1)} / 增速 ${g.toFixed(1)} → PEG ${peg.toFixed(2)}（阈值≤${o.maxPEG}）` : `PE ${peTtm.toFixed(1)}（增速≤0，PEG 不适用）`, ok: peg != null ? peg <= o.maxPEG : peTtm < 60 });
  }

  // ---- 市值 ----
  if (marketCap == null) checks.push({ name: "总市值", desc: "市值数据缺失", ok: false });
  else checks.push({ name: "总市值", desc: `市值 ${(marketCap / 1e8).toFixed(1)} 亿（阈值≥${(o.minTotalMarketCap / 1e8).toFixed(0)} 亿）`, ok: marketCap >= o.minTotalMarketCap });

  // ---- 现金流 ----
  if (cashPs == null) checks.push({ name: "每股经营现金流", desc: "数据缺失", ok: false });
  else checks.push({ name: "每股经营现金流", desc: `经营现金流/股 ${cashPs}`, ok: cashPs >= 0 });

  return { checks, metrics, bank };
}

// ---------- 合理价模型（investool 对照：年报 EPS × (1+营收增速) × 基准 PE，空窗回退） ----------
function computeRightPrice(f, opts = {}) {
  const o = { ...DEFAULT_OPTIONS, ...opts };
  const annual = f.annual ?? f.latest;
  if (!annual) return { rightPrice: null, priceSpace: null, note: "无年报数据" };
  const eps = annual.EPSJB ?? f.latest?.EPSJB;
  const revTz = annual.TOTALOPERATEREVETZ ?? f.latest?.TOTALOPERATEREVETZ ?? 0;
  const price = f.valuation?.CLOSE_PRICE ?? null;
  if (eps == null || eps <= 0) return { rightPrice: null, priceSpace: null, note: "EPS 缺失或亏损，合理价不适用" };
  const rightPrice = eps * (1 + revTz / 100) * o.basePE;
  const priceSpace = price != null && price > 0 ? ((rightPrice - price) / price) * 100 : null;
  return {
    rightPrice: +rightPrice.toFixed(2),
    priceSpace: priceSpace != null ? +priceSpace.toFixed(1) : null,
    annualDate: String(annual.REPORT_DATE ?? "").slice(0, 10),
    note: `简化模型：年报EPS ${eps} × (1+营收同比 ${revTz.toFixed(1)}%) × 基准PE ${o.basePE}`,
  };
}

// ---------- 主入口：拉数据（表缓存 24h）→ 体检 + 合理价 ----------
async function getFundamentalCheck(pool, code, force = false) {
  // 表缓存（24h TTL）
  try {
    const cached = await pool.query("SELECT name, data, updated_at FROM stock_fundamentals WHERE code=$1", [code]);
    if (!force && cached.rows.length > 0) {
      const ageMs = Date.now() - new Date(cached.rows[0].updated_at).getTime();
      if (ageMs < 24 * 3600 * 1000) {
        let base = cached.rows[0].data;
        if (!Array.isArray(base.researchRatingTrend)) {
          base = { ...base, researchRatingTrend: await fetchResearchRatingTrendServer(code) };
          try {
            await pool.query(
              `UPDATE stock_fundamentals SET data=$1, updated_at=now() WHERE code=$2`,
              [JSON.stringify(base), code],
            );
          } catch { /* 缓存补写失败不阻塞 */ }
        }
        const { getCatalystCalendar } = require("./catalystCalendar");
        return { ...base, history: await getFundamentalTrend(pool, code), peerComparison: await getPeerComparison(pool, code), catalysts: await getCatalystCalendar(pool, code, 180) };
      }
    }
  } catch { /* 缓存读失败继续实时拉 */ }

  let f;
  try {
    f = await fetchFundamentals(code);
  } catch (e) {
    return { error: "F10 数据拉取失败: " + e.message };
  }
  const body = checkFundamentals(f);
  if (body.error) return body;
  const rp = computeRightPrice(f);
  const out = { ...body, rightPrice: rp, asOf: new Date().toISOString() };
  await persistFundamentalHistory(pool, code, f);
  out.history = await getFundamentalTrend(pool, code);
  out.peerComparison = await getPeerComparison(pool, code);
  const { getCatalystCalendar } = require("./catalystCalendar");
  out.catalysts = await getCatalystCalendar(pool, code, 180);
  out.researchRatingTrend = await fetchResearchRatingTrendServer(code);

  // 落表缓存（失败不阻塞）
  try {
    await pool.query(
      `INSERT INTO stock_fundamentals(code, name, data, updated_at) VALUES($1,$2,$3,now())
       ON CONFLICT(code) DO UPDATE SET name=$2, data=$3, updated_at=now()`,
      [code, f.name, JSON.stringify(out)],
    );
  } catch { /* 落库失败静默 */ }
  return out;
}

module.exports = { checkFundamentals, computeRightPrice, fetchFundamentals, getFundamentalCheck, DEFAULT_OPTIONS, isBank };
