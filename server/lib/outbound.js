// ============================================================
// server/lib/outbound.js —— 统一出站客户端（P2-7）
// 背景：此前 cron.js httpsGet / watch.js fetchPrices / stockConcepts.js fetch / push.js httpRequest
// 各自实现 deadline（4s/6s/8s 三种）、重试、UA，hostGuard 校验时有时无 —— 新增模块易漏超时/白名单。
// 本模块收敛为两个入口：
//   getJson(url, {timeout, retries, headers, viaProxy, source}) → {data, source, asOf, duration}
//   getJsonWithFallback(primaryUrl, fallbackUrl, {primarySource, fallbackSource, ...}) → 主源失败自动降级
// 语义约定（与 P1-17 一致）：
//   - 仅"网络失败"（超时/连接错）才重试 —— 4xx/5xx/坏 JSON 不重试（防重复计费/无意义重试）
//   - 所有出站统一过 hostGuard 白名单（SSRF 防线）
//   - source 字段随结果返回：fallback 命中时记录实际 provider（P1-16 数据可追溯）
// ============================================================
const https = require("https");
const http = require("http");
const { assertHostAllowed } = require("./hostGuard");
const { isNetworkErr, PROXY_AGENT } = require("./httpProxy");

// v9.30.3：模拟浏览器 UA（node 默认 "node" 会被 emappdata 等接口 ban 导致 socket hang up）
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** 低层请求：返回 {status, body}；超时/连接错误 reject。
 *  v9.123.0（卓越审查 P0-1）：rawBuffer=true 时 body 返回原始 Buffer（GBK 等非 utf8 源用，
 *  默认 utf8 字符串——GBK 字节经 utf8 解码后为不可逆 U+FFFD，腾讯行情中文名必需 rawBuffer） */
function requestRaw(url, { timeout = 6000, headers = {}, viaProxy = false, method = "GET", body, rawBuffer = false } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const opts = {
      method,
      headers: { "User-Agent": BROWSER_UA, ...headers },
      ...(viaProxy && PROXY_AGENT ? { agent: PROXY_AGENT } : {}),
    };
    const req = lib.request(u, opts, r => {
      const chunks = [];
      r.on("data", c => chunks.push(c));
      r.on("end", () => {
        const buf = Buffer.concat(chunks);
        resolve({ status: r.statusCode, body: rawBuffer ? buf : buf.toString("utf8") });
      });
    });
    req.on("error", reject);
    req.setTimeout(timeout, () => { req.destroy(new Error("upstream timeout")); });
    if (body) req.write(body);
    req.end();
  });
}

/** 错误分类：timeout | http | parse | network（调用方可按类型决定降级/重试/告警） */
function classifyErr(e) {
  const msg = String(e?.message ?? "");
  const err = e instanceof Error ? e : new Error(msg);
  if (/timeout/i.test(msg)) err.type = "timeout";
  else if (/http \d{3}/i.test(msg)) err.type = "http";
  // JSON.parse 抛的是 SyntaxError（"Unexpected token..."）—— 归类 parse
  else if (/bad json|Unexpected token|Unexpected end of JSON|JSON\.parse/i.test(msg)) err.type = "parse";
  else err.type = "network";
  return err;
}

/**
 * GET JSON 统一入口。
 * @param {string} url 目标 URL（必须过 hostGuard 白名单）
 * @param {object} opts
 *   timeout  超时毫秒（默认 6000）
 *   retries  网络错重试次数（默认 0，行为与旧 httpsGet 等价；关键链路可显式 1）
 *   headers  附加请求头（如 Referer）
 *   viaProxy 走代理（默认 false，行情直连）
 *   source   provider 标记（默认 "unknown"，fallback 命中时会换成实际 provider）
 * @returns {Promise<{data:any, source:string, asOf:string, duration:number}>}
 */
async function getJson(url, opts = {}) {
  const { timeout = 6000, retries = 0, headers = {}, viaProxy = false, source = "unknown" } = opts;
  // VITEST_ALLOW_ANY_HOST：仅单测用（本地 HTTP 服务器不在生产白名单）；生产环境该 env 不存在
  if (!process.env.VITEST_ALLOW_ANY_HOST) assertHostAllowed(url);
  const asOf = new Date().toISOString();
  const start = Date.now();
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await requestRaw(url, { timeout, headers, viaProxy });
      if (r.status && (r.status < 200 || r.status >= 300)) {
        throw new Error(`http ${r.status}`);
      }
      const data = JSON.parse(r.body);
      return { data, source, asOf, duration: Date.now() - start };
    } catch (e) {
      lastErr = classifyErr(e);
      if (lastErr.type === "network" && attempt < retries) {
        // 指数退避 + 抖动（防东财限流）
        await new Promise(r2 => setTimeout(r2, 300 * Math.pow(2, attempt) + Math.random() * 150));
        continue;
      }
      throw lastErr;
    }
  }
  throw lastErr;
}

/**
 * 主源 → 备用源 自动降级（fallback 链）。
 * 主源网络失败/超时/坏 JSON → 请求 fallbackUrl；source 记录实际命中的 provider。
 * 主源 HTTP 4xx/5xx（业务拒绝）同样降级 —— 与旧行为（静默空数据）相比更可追溯。
 * @returns {Promise<{data, source, asOf, duration, fallback?:boolean, primaryError?:string}>}
 */
async function getJsonWithFallback(primaryUrl, fallbackUrl, opts = {}) {
  const { primarySource = "primary", fallbackSource = "fallback", ...rest } = opts;
  try {
    return await getJson(primaryUrl, { ...rest, source: primarySource });
  } catch (e) {
    if (!fallbackUrl) throw e;
    try {
      const r = await getJson(fallbackUrl, { ...rest, source: fallbackSource });
      r.fallback = true;
      r.primaryError = e.type ?? String(e.message ?? "").slice(0, 60);
      return r;
    } catch (e2) {
      // 双源都失败：抛主源错误（调用方按既有降级路径处理）
      throw e;
    }
  }
}

module.exports = { getJson, getJsonWithFallback, requestRaw, classifyErr };
