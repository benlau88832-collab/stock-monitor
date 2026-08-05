// ============================================================
// /api/proxy/*  东方财富接口转发（解决浏览器 CORS / JSONP 限制 / 限流）
// 用法：/api/proxy/<完整URL>?<query>  → 代理转发，带短 TTL 缓存
// v9.27（P0-2 卫生6）：新增 POST 支持（人气榜 emappdata 等 POST 接口 CORS 失效）
// ============================================================
const https = require("https");
const http = require("http");
const { URL } = require("url");

// 短 TTL 缓存（5 秒），降低东财限流风险
const cache = new Map();
const TTL = 5000;

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
  const upstream = lib.request(u, { method: bodyBuf ? "POST" : "GET", headers: bodyBuf ? { "Content-Type": "application/json" } : {} }, r => {
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
