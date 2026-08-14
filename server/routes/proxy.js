// ============================================================
// /api/proxy/*  东方财富接口转发（解决浏览器 CORS / JSONP 限制 / 限流）
// 用法：/api/proxy/<完整URL>?<query>  → 代理转发，带短 TTL 缓存
// v9.27（P0-2 卫生6）：新增 POST 支持（人气榜 emappdata 等 POST 接口 CORS 失效）
// ============================================================
const https = require("https");
const http = require("http");
const { URL } = require("url");
const { pool } = require("../db");

// v9.28（P2-3）：可选鉴权 —— server/.env 配置 LOCAL_TOKEN 后，
// 所有 /api/proxy 请求必须携带 header `x-local-token` 且匹配；未配置则放行（本地默认）。
// v9.84.3（5.4）：未配置 env 时读 kv local_token（index.js ensureLocalToken 自动生成）—— 与 ai.js 同口径
// v9.85.2（P1-1）：fail-closed —— 已初始化后读取失败拒绝放行（与 ai.js 同修复）
let storedTokenCache = { t: null, ts: 0 };
let tokenInitialized = false;
async function effectiveToken() {
  if (process.env.LOCAL_TOKEN) return process.env.LOCAL_TOKEN;
  if (storedTokenCache.t && Date.now() - storedTokenCache.ts < 30000) return storedTokenCache.t;
  try {
    const r = await pool.query("SELECT value FROM kv_store WHERE key='local_token'");
    const v = r.rows[0]?.value;
    const t = v && typeof v === "object" && "__raw" in v ? v.__raw : (typeof v === "string" ? v : v?.token);
    storedTokenCache = { t: t ? String(t) : null, ts: Date.now() };
    tokenInitialized = true;
    return storedTokenCache.t;
  } catch {
    return tokenInitialized ? storedTokenCache.t : null;
  }
}
async function checkAuth(req, res) {
  const token = await effectiveToken();
  if (!token) return true;
  if (req.headers["x-local-token"] === token) return true;
  res.status(401).json({ error: "unauthorized: missing/invalid x-local-token" });
  return false;
}

// 短 TTL 缓存（5 秒），降低东财限流风险
const cache = new Map();
const TTL = 30000;

// v9.30.3：模拟浏览器 UA（node 默认 "node" 会被 emappdata 等接口 ban 导致 socket hang up）
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ============== v9.99.0（批次 4，finshare SmartCooldown）：服务端分级冷却 + 成功率观测 ==============
// 与前端 src/lib/jsonpQueue.ts 同构（错误分类→冷却时长→倍率累积→按 host 分桶隔离）
const COOLDOWN_MS = {
  forbidden: 300_000,          // 403：WAF 拒绝
  rate_limit: 120_000,         // 429：限流
  service_unavailable: 30_000, // 503
  timeout: 5_000,              // 超时
  connection_error: 5_000,     // ECONNRESET/HTTP 000（v9.109.2 Q-3：10s→5s 短冷却——偶发抖动不被误判长断，半开探测兜底）
  default: 15_000,
};
// v9.99.1（批次 5-1）：ECONNRESET 显式分类 —— 词根与前端 jsonpQueue 完全同构（crewai http_utils 对照）：
//   ECONNRESET（WinError 10054 "远程主机强迫关闭连接"）/ HTTP 000 / TLS 断连（"Client network socket
//   disconnected"）均按 connection_error → 10s 起冷却，WAF 断流期间绝不重试加速被封
function classifyError(msg) {
  const s = String(msg || "").toLowerCase();
  if (s.includes("403") || s.includes("forbidden")) return "forbidden";
  if (s.includes("429") || s.includes("rate limit")) return "rate_limit";
  if (s.includes("503")) return "service_unavailable";
  if (s.includes("timeout") || s.includes("abort")) return "timeout";
  if (s.includes("reset") || s.includes("econnreset") || s.includes("hang up") || s.includes("load error")
    || s.includes("fetch fail") || s.includes("failed to fetch") || s.includes("network") || s.includes("socket")) return "connection_error";
  return "default";
}
const circuitBuckets = new Map(); // host -> { failCount, openUntil, halfOpen }
function getBucket(host) {
  let b = circuitBuckets.get(host);
  if (!b) { b = { failCount: 0, openUntil: 0, halfOpen: false }; circuitBuckets.set(host, b); }
  return b;
}
function isCircuitOpen(host) {
  const b = getBucket(host);
  if (b.openUntil === 0) return false;
  if (Date.now() < b.openUntil) return true;
  if (!b.halfOpen) { b.halfOpen = true; return false; } // 到期半开试探
  return true;
}
function recordFail(host, err) {
  const b = getBucket(host);
  b.failCount++;
  const coolMs = COOLDOWN_MS[classifyError(err?.message ?? err)] * Math.min(1 + Math.max(0, b.failCount - 1) * 0.5, 3.0);
  b.openUntil = Math.max(b.openUntil, Date.now() + coolMs);
  b.halfOpen = false;
  recordCall(host, false);
}
function recordSuccess(host) {
  const b = getBucket(host);
  b.failCount = b.halfOpen ? 0 : Math.floor(b.failCount / 2);
  b.openUntil = 0;
  b.halfOpen = false;
  recordCall(host, true);
}

// 成功率观测：60s 滑动窗口（每源保留时间戳数组）
const callLog = new Map(); // host -> number[]（ms 时间戳，成功用正数、失败用负数）
function recordCall(host, ok) {
  const now = Date.now();
  let arr = callLog.get(host);
  if (!arr) { arr = []; callLog.set(host, arr); }
  arr.push(ok ? now : -now);
  // 只保留 60s 窗口
  const cutoff = now - 60_000;
  while (arr.length > 0 && Math.abs(arr[0]) < cutoff) arr.shift();
  if (arr.length > 500) arr.splice(0, arr.length - 500); // 防无限增长
}
/** 各源健康状态（OpsPanel/观测端点用）：状态/冷却剩余/成功率/最近命中 */
function getSourceHealth() {
  const now = Date.now();
  const out = [];
  for (const [host, b] of circuitBuckets) {
    const arr = callLog.get(host) ?? [];
    const total = arr.length;
    const ok = arr.filter(t => t > 0).length;
    const rate = total > 0 ? Math.round(ok / total * 100) : null;
    out.push({
      host,
      // v9.100.0（P2-09）：冷却结束但 60s 窗口内全失败（≥3 次调用 0% 成功率）→ 标 "failed"（断源）
      //   原实现冷却到期即回 "ok"，与"0%"成功率同屏矛盾（OpsPanel 显示"push2 ok 0%"）
      // v9.101.0（P2-09 返工）：阈值 total>=3 → total>=1 —— 断源低流量下 60s 调用数恒 1-2（验收实测 calls60s=2），
      //   "failed" 不可达；任一失败调用且 0% 成功率即判断源（保留 half-open 语义）
      state: b.openUntil > now ? "cooling" : b.halfOpen ? "half-open" : (rate === 0 && total >= 1 ? "failed" : "ok"),
      cooldownRemainSec: b.openUntil > now ? Math.ceil((b.openUntil - now) / 1000) : 0,
      failCount: b.failCount,
      successRate: rate,
      calls60s: total,
    });
  }
  // 有调用但从未失败过的 host 也补录（观察态）
  for (const [host, arr] of callLog) {
    if (!circuitBuckets.has(host)) {
      const total = arr.length;
      const ok = arr.filter(t => t > 0).length;
      out.push({ host, state: "ok", cooldownRemainSec: 0, failCount: 0, successRate: total > 0 ? Math.round(ok / total * 100) : null, calls60s: total });
    }
  }
  return out;
}

// v9.86.0（P1-16）：转发白名单从数据源注册表派生（只放行行情/新闻类，AI/推送域不放行给浏览器；
//   废弃的 search-api-web 与无调用的 stock.gtimg.cn 已随注册表移除）
const { proxyAllowedHosts } = require("../lib/sources");
const ALLOWED_HOSTS = proxyAllowedHosts();

/** 校验目标 URL 是否在白名单内，返回 { ok, url?, err? } */
function checkTarget(target) {
  if (!target) return { ok: false, err: "url param required" };
  let u;
  try { u = new URL(target); }
  catch { return { ok: false, err: "bad url" }; }
  if (!ALLOWED_HOSTS.includes(u.hostname)) {
    return { ok: false, err: `host not allowed: ${u.hostname}` };
  }
  return { ok: true, url: u };
}

/** 核心转发（GET/POST 共用） */
// v9.85.0（P1-3）：响应上限 5MB + 缓存按字节估算裁剪 —— 防单条大响应/大量缓存耗尽进程内存；
//   移除显式 ACAO:*（交由 index.js 统一 CORS 收敛，任意 Origin 不再可读代理结果）
const MAX_RESP_BYTES = 5 * 1024 * 1024;
const CACHE_MAX_BYTES = 40 * 1024 * 1024;
let cacheBytes = 0;
function degradePush2his(res) {
  res.set("X-Data-Source", "push2his-degraded");
  res.status(204).end();
}
function forward(req, res, target, bodyBuf, fallbackDepth = 0) {
  const { url: u } = checkTarget(target);
  const fallbackHost = u.hostname === "push2.eastmoney.com" ? "push2delay.eastmoney.com" : null;
  const fallbackTarget = fallbackHost ? target.replace(u.hostname, fallbackHost) : null;
  // v9.99.0：分级冷却快速失败 —— WAF 断流(403/ECONNRESET)期间不再逐请求重试加速被封
  if (isCircuitOpen(u.hostname)) {
    if (!bodyBuf) {
      try {
        const cu = new URL(target);
        cu.searchParams.delete("req_trace");
        cu.searchParams.delete("_");
        const stale = cache.get(cu.toString());
        if (stale) {
          res.set("X-Data-Source", "circuit-stale");
          res.set("Content-Type", stale.type);
          return res.send(stale.body);
        }
      } catch { /* fallthrough */ }
    }
    res.set("X-Data-Source", "circuit-open");
    if (fallbackTarget && fallbackDepth === 0) {
      return forward(req, res, fallbackTarget, bodyBuf, 1);
    }
    if (u.hostname === "push2his.eastmoney.com" && !bodyBuf) return degradePush2his(res);
    return res.status(502).json({ error: "circuit open (source cooling)" });
  }
  res.set("X-Data-Source", u.hostname); // v9.99.0：data_source 标记（实际供数源，前端可观测）
  // 缓存命中（v9.26.10：剔除 req_trace/时间戳类动态参数；POST 不缓存）
  let cacheKey = null;
  if (!bodyBuf) {
    cacheKey = target;
    try {
      const cu = new URL(target);
      cu.searchParams.delete("req_trace");
      cu.searchParams.delete("_");
      cacheKey = cu.toString();
    } catch { /* keep raw */ }
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.ts < TTL) {
      res.set("Content-Type", hit.type);
      return res.send(hit.body);
    }
  }

  const lib = u.protocol === "https:" ? https : http;
  let sent = false; // v9.26.10：防 502/504 双重发送
  const done = (fn) => { if (!sent) { sent = true; fn(); } };
  // v9.31：改用 options 对象（hostname/path/servername）而非 URL 对象 ——
  //   实测 emappdata 对 `lib.request(urlObject)` 的请求永远 socket hang up（HTTP 000），
  //   而 `https.request({hostname, path, ...})` 正常返回 200。同花顺 dq.10jqka.com.cn 需 Referer。
  const upstream = lib.request({
    hostname: u.hostname,
    port: u.port || undefined,
    path: u.pathname + u.search,
    method: bodyBuf ? "POST" : "GET",
    headers: bodyBuf
      ? { "Content-Type": "application/json", "User-Agent": BROWSER_UA, "Referer": `https://${u.hostname}/` }
      : { "User-Agent": BROWSER_UA, "Referer": `https://${u.hostname}/` },
    servername: u.hostname, // TLS SNI（HTTPS 必须，避免证书校验失败）
  }, r => {
    const chunks = [];
    let total = 0;
    let overLimit = false;
    r.on("data", c => {
      total += c.length;
      if (total > MAX_RESP_BYTES) { overLimit = true; upstream.destroy(); return; }
      chunks.push(c);
    });
    r.on("end", () => {
      if (overLimit) { done(() => res.status(502).json({ error: "upstream response too large" })); return; }
      const body = Buffer.concat(chunks);
      const type = r.headers["content-type"] || "application/json";
      if (r.statusCode >= 400) {
        recordFail(u.hostname, new Error("upstream http " + r.statusCode));
        if (fallbackTarget && fallbackDepth === 0) return done(() => forward(req, res, fallbackTarget, bodyBuf, 1));
        if (u.hostname === "push2his.eastmoney.com" && !bodyBuf) return done(() => degradePush2his(res));
        return done(() => res.status(502).json({ error: "upstream http " + r.statusCode }));
      }
      if (cacheKey) {
        const old = cache.get(cacheKey);
        if (old) cacheBytes -= old.body.length;
        cache.set(cacheKey, { ts: Date.now(), body, type });
        cacheBytes += body.length;
        // 按总字节裁剪（超出 40MB 删最旧一半）
        if (cacheBytes > CACHE_MAX_BYTES || cache.size > 200) {
          const keys = [...cache.keys()].slice(0, Math.ceil(cache.size / 2));
          for (const k of keys) {
            const v = cache.get(k);
            if (v) { cacheBytes -= v.body.length; cache.delete(k); }
          }
        }
      }
      done(() => {
        res.set("Content-Type", type);
        recordSuccess(u.hostname); // v9.99.0：成功率观测
        // v9.85.0（P1-3）：不再设置 ACAO:* —— 统一由 index.js CORS 中间件管控（仅 localhost）
        res.send(body);
      });
    });
  });
  upstream.on("error", e => {
    recordFail(u.hostname, e);
    if (fallbackTarget && fallbackDepth === 0) return done(() => forward(req, res, fallbackTarget, bodyBuf, 1));
    if (u.hostname === "push2his.eastmoney.com" && !bodyBuf) return done(() => degradePush2his(res));
    done(() => res.status(502).json({ error: e.message }));
  });
  // v9.81（性能）：上游超时 12s→6s —— 东财断源时前端不再挂 12s 等 504
  upstream.setTimeout(6000, () => {
    const e = new Error("upstream timeout");
    recordFail(u.hostname, e);
    upstream.destroy();
    if (fallbackTarget && fallbackDepth === 0) return done(() => forward(req, res, fallbackTarget, bodyBuf, 1));
    if (u.hostname === "push2his.eastmoney.com" && !bodyBuf) return done(() => degradePush2his(res));
    done(() => res.status(504).json({ error: "upstream timeout" }));
  });
  if (bodyBuf) upstream.write(bodyBuf);
  upstream.end();
}

module.exports = proxyRoutes;
// v9.114.0（T5-2 D-10）：导出数据源健康快照，供 /api/health 统一聚合端点复用
module.exports.getSourceHealth = getSourceHealth;

function proxyRoutes(app) {
  app.get("/api/proxy", async (req, res) => {
    // v9.85.0（P0-1）：async 鉴权必须 await
    if (!(await checkAuth(req, res))) return;
    const t = req.query.url;
    const c = checkTarget(t);
    if (!c.ok) {
      const code = c.err && c.err.startsWith("host") ? 403 : 400;
      return res.status(code).json({ error: c.err });
    }
    forward(req, res, t, null);
  });

  // v9.99.0（批次 4）：数据源健康观测（各源状态/冷却剩余/成功率 60s 窗口）
  app.get("/api/proxy/health", async (req, res) => {
    if (!(await checkAuth(req, res))) return;
    res.json({ sources: getSourceHealth(), at: new Date().toISOString() });
  });

  // v9.138.0（波段重构·阶段一）：行业板块指数日K（90.BKxxxx，波段主线引擎数据源）
  // GET /api/proxy/board-kline?secid=90.BK0478&days=60 → { klines: ["date,open,close,high,low,...", ...] }
  // v9.138.0 实测修正：push2his 仅 https 对 node TLS ban（socket hang up），http 直连稳定；
  // 腾讯 fqkline/kline 不支持 bk 前缀（param error）—— 故主源 = push2his http，无腾讯兜底。
  // v9.140.0：push2his 偶发整域 IP 短时 ban（http/https 全挂，实测 1-2h 恢复）→ 加 retries:1（网络错退避重试）
  //   + 失败落日志（原 catch 吞掉真实错误，无从区分 ban/空数据）
  app.get("/api/proxy/board-kline", async (req, res) => {
    if (!(await checkAuth(req, res))) return;
    const secid = String(req.query.secid ?? "");
    const days = Math.min(120, Number(req.query.days) || 60);
    if (!/^90\.BK\d{4}$/.test(secid)) return res.status(400).json({ error: "invalid secid (90.BKxxxx)" });
    try {
      const { getJson } = require("../lib/outbound");
      const url = `http://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=0&lmt=${days}&end=20500101&ut=7eea3edcaed734bea9cbfc24409ed989`;
      const r = await getJson(url, { timeout: 8000, retries: 1, source: "push2his" });
      const klines = r.data?.data?.klines ?? [];
      if (!Array.isArray(klines) || klines.length === 0) throw new Error("push2his empty");
      res.json({ secid, klines });
    } catch (e) {
      console.warn(`[proxy] board-kline ${secid} 失败（push2his ${e?.type ?? ""} ${e?.message ?? e}）`);
      res.status(502).json({ error: "板块K线获取失败" });
    }
  });

  // v9.138.0（波段重构·阶段一）：个股日K（波段决策卡数据源，60-70 根）
  // GET /api/proxy/stock-kline?code=600001&days=70 → { klines: [...] }
  // v9.138.0 实测修正：主源 = push2his http（https 对 node TLS ban）；腾讯 fqkline 兜底（仅个股支持，板块不支持）。
  app.get("/api/proxy/stock-kline", async (req, res) => {
    if (!(await checkAuth(req, res))) return;
    const code = String(req.query.code ?? "");
    const days = Math.min(120, Number(req.query.days) || 70);
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: "invalid code" });
    const secid = /^(60|68|5)/.test(code) ? `1.${code}` : `0.${code}`;
    try {
      const { getJson } = require("../lib/outbound");
      const url = `http://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&lmt=${days}&end=20500101&ut=7eea3edcaed734bea9cbfc24409ed989`;
      const r = await getJson(url, { timeout: 8000, retries: 1, source: "push2his" });
      const klines = r.data?.data?.klines ?? [];
      if (!Array.isArray(klines) || klines.length === 0) throw new Error("push2his empty");
      res.json({ code, secid, klines });
    } catch (e) {
      console.warn(`[proxy] stock-kline ${code} 主源失败（push2his ${e?.type ?? ""} ${e?.message ?? e}），走腾讯兜底`);
      // 腾讯 fqkline 兜底（个股可用；push2his 双失败才到这里）
      try {
        const { getJson } = require("../lib/outbound");
        const q = /^(60|68|5)/.test(code) ? `sh${code}` : `sz${code}`;
        const txUrl = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${q},day,,,${days},qfq`;
        const tj = await getJson(txUrl, { timeout: 8000, source: "tencent" });
        const rows = tj.data?.data?.[q]?.qfqday ?? tj.data?.data?.[q]?.day ?? [];
        const klines = Array.isArray(rows) ? rows.map((r) => (Array.isArray(r) ? r.join(",") : String(r))) : [];
        res.json({ code, secid: q, klines: klines.length ? klines : [] });
      } catch {
        res.status(502).json({ error: "个股K线获取失败" });
      }
    }
  });

  // v9.27：POST 转发（人气榜 emappdata POST 接口 CORS 失效，本地部署经此绕行）
  app.post("/api/proxy", async (req, res) => {
    // v9.85.0（P0-1）：async 鉴权必须 await
    if (!(await checkAuth(req, res))) return;
    const t = req.query.url;
    const c = checkTarget(t);
    if (!c.ok) {
      const code = c.err && c.err.startsWith("host") ? 403 : 400;
      return res.status(code).json({ error: c.err });
    }
    const chunks = [];
    req.on("data", ck => chunks.push(ck));
    req.on("end", () => forward(req, res, t, Buffer.concat(chunks)));
  });
};
