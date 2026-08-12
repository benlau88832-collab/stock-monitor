// ============================================================
// server/lib/stockSnapshot.js —— 个股快照（v9.123.0，卓越审查 P0-1）
// 决策直达服务端装配个股数据（name/pct/price/turnoverRate/limitUp 判定）——
//   v9.116.0 装配层只传 {code}，tactics 三件（买点/梯队位置/诱多个股）在生产名存实亡。
// 数据源：push2delay qt/stock/get（延迟行情，hostGuard 白名单，服务端直连；实测 ulist.np 字段
//   错位不可用 → 用 stock/get）+ 腾讯 qt.gtimg.cn（GBK 原始字节）兜底；
//   两源皆失败返回 null（调用方降级 {code}，诚实缺数据，永不崩）。
// mainNet：stock/get 无可靠个股主力净额字段 → 恒 null（detectTrap 个股资金检查诚实跳过，
//   前端 kernel 路径由 fetchStockOne 全字段装配，双端各就近取数）。
// 注意：relay（连板高度）不在此取——由 decisionLayer 查 PG zt_snapshot 今日池（PG-first）。
// 纯函数解析部分（parseStockGet/parseTencentText）可单测。
// ============================================================
const { getJson, requestRaw } = require("./outbound");

// 个股行情 ut（fa5f…；与涨停池 ut 7eea… 不同，混用会返回错位字段——实测教训）
const STOCK_UT = "fa5fd1943c7b386f172d6893dbfba10b";
// 字段：f57 代码 f58 名称 f43 现价 f170 涨跌幅 f168 换手率
const FIELDS = "f57,f58,f43,f170,f168";

/** 代码 → secid（沪 1. / 深京 0.） */
function toSecid(code) { return (String(code).startsWith("6") ? "1." : "0.") + code; }

const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v))) ? null : Number(v);

/** qt/stock/get 响应 → 快照（纯函数；实测响应 {data:{rc…,data:{f43…}}} 双层） */
function parseStockGet(json) {
  const d = json?.data?.data ?? json?.data;
  if (!d || typeof d.f43 === "undefined") return null;
  return {
    code: String(d.f57 ?? ""), name: String(d.f58 ?? ""),
    price: num(d.f43), pct: num(d.f170), turnoverRate: num(d.f168), mainNet: null,
  };
}

/**
 * 腾讯 qt.gtimg.cn 文本解析（纯函数；入参为原始 GBK Buffer —— utf8 字符串版已不可逆，勿用）
 * 字段映射（~ 分隔，实测样例，与 src/lib/api.ts parseTencentQuote 同源）：
 *   [1]名称 [2]代码 [3]现价 [31]涨跌额 [32]涨跌幅 [37]成交额(万元) [38]换手率%
 */
function parseTencentText(body, code) {
  try {
    const txt = Buffer.isBuffer(body)
      ? new TextDecoder("gbk").decode(body)
      : String(body ?? "");
    const m = txt.match(/="([^"]*)"/);
    if (!m) return null;
    const p = m[1].split("~");
    return {
      code: String(p[2] ?? code), name: String(p[1] ?? ""),
      price: num(p[3]), pct: num(p[32]), turnoverRate: num(p[38]), mainNet: null,
    };
  } catch { return null; }
}

/** 个股快照入口：push2delay stock/get → 腾讯 → null（失败降级） */
async function fetchStockSnapshotServer(code) {
  const secid = toSecid(code);
  try {
    const j = await getJson(
      `https://push2delay.eastmoney.com/api/qt/stock/get?ut=${STOCK_UT}&fltt=2&secid=${secid}&fields=${FIELDS}`,
      { timeout: 4000, source: "eastmoney" },
    );
    const snap = parseStockGet(j);
    if (snap && snap.name) return snap;
  } catch { /* push2delay 失败 → 腾讯兜底 */ }
  try {
    const { body } = await requestRaw(`https://qt.gtimg.cn/q=${toSecid(code)}`, { timeout: 4000, rawBuffer: true }); // GBK → rawBuffer
    return parseTencentText(body, code);
  } catch { return null; }
}

module.exports = { fetchStockSnapshotServer, parseStockGet, parseTencentText, toSecid };
