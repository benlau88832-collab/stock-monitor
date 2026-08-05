// ============================================================
// /api/proxy/*  东方财富接口转发（解决浏览器 CORS / JSONP 限制 / 限流）
// 用法：/api/proxy/<完整URL>?<query>  → 代理转发，带短 TTL 缓存
// v9.27（P0-2 卫生6）：新增 POST 支持（人气榜 emappdata 等 POST 接口 CORS 失效）
// ============================================================
const https = require("https");
const http = require("http");
const { URL } = require("url");

// v9.28（P2-3）：可选鉴权 —— server/.env 配置 LOCAL_TOKEN 后，
// 所有 /api/proxy 请求必须携带 header `x-local-token` 且匹配；未配置则放行（本地默认）。
// 防止部署到局域网/公网时被人白嫖成开放代理（虽已有 host 白名单）。
const LOCAL_TOKEN = process.env.LOCAL_TOKEN || null;
function checkAuth(req, res) {
  if (!LOCAL_TOKEN) return true;
  if (req.headers["x-local-token"] === LOCAL_TOKEN) return true;
  res.status(401).json({ error: "unauthorized: missing/invalid x-local-token" });
  return false;
}

// 短 TTL 缓存（5 秒），降低东财限流风险
const cache = new Map();
const TTL = 5000;

// v9.30.3：模拟浏览器 UA（node 默认 "node" 会被 emappdata 等接口 ban 导致 socket hang up）
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const ALLOWED_HOSTS = [
  "push2.eastmoney.com",
  "push2delay.eastmoney.com",
  "push2ex.eastmoney.com",
  "push2his.eastmoney.com",
  "datacenter-web.eastmoney.com",
  "np-anotice-stock.eastmoney.com",
  "np-weblist.eastmoney.com",
  "emappdata.eastmoney.com",
  "quote.eastmoney.com",
  // v9.26.12：腾讯/雪球行情（提供更稳定的今开/昨收/成交量/换手；批量接口无 CORS）
  "qt.gtimg.cn",
  "web.ifzq.gtimg.cn",
  "stock.gtimg.cn",
  // v9.26.17：东财 push2his（板块分钟 K 线，含主力净额分时 f60）
  "push2his.eastmoney.com",
  // v9.31：同花顺人气榜（dq.10jqka.com.cn 热度接口，GET JSON）
  "dq.10jqka.com.cn",
];

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
function forward(req, res, target, bodyBuf) {
  const { url: u } = checkTarget(target);
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
    r.on("data", c => chunks.push(c));
    r.on("end", () => {
      const body = Buffer.concat(chunks);
      const type = r.headers["content-type"] || "application/json";
      if (cacheKey) {
        cache.set(cacheKey, { ts: Date.now(), body, type });
        if (cache.size > 200) {
          const keys = [...cache.keys()].slice(0, 100);
          keys.forEach(k => cache.delete(k));
        }
      }
      done(() => {
        res.set("Content-Type", type);
        res.set("Access-Control-Allow-Origin", "*");
        res.send(body);
      });
    });
  });
  upstream.on("error", e => done(() => res.status(502).json({ error: e.message })));
  upstream.setTimeout(12000, () => { done(() => res.status(504).json({ error: "upstream timeout" })); upstream.destroy(); });
  if (bodyBuf) upstream.write(bodyBuf);
  upstream.end();
}

module.exports = function proxyRoutes(app) {
  app.get("/api/proxy", (req, res) => {
    if (!checkAuth(req, res)) return;
    const t = req.query.url;
    const c = checkTarget(t);
    if (!c.ok) {
      const code = c.err && c.err.startsWith("host") ? 403 : 400;
      return res.status(code).json({ error: c.err });
    }
    forward(req, res, t, null);
  });

  // v9.27：POST 转发（人气榜 emappdata POST 接口 CORS 失效，本地部署经此绕行）
  app.post("/api/proxy", (req, res) => {
    if (!checkAuth(req, res)) return;
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
