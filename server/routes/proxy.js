// ============================================================
// /api/proxy/*  东方财富接口转发（解决浏览器 CORS / JSONP 限制 / 限流）
// 用法：/api/proxy/<完整URL>?<query>  → 代理转发，带短 TTL 缓存
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

module.exports = function proxyRoutes(app) {
  app.get("/api/proxy", async (req, res) => {
    const target = req.query.url;
    if (!target) return res.status(400).json({ error: "url param required" });

    let u;
    try { u = new URL(target); }
    catch { return res.status(400).json({ error: "bad url" }); }

    if (!ALLOWED_HOSTS.includes(u.hostname)) {
      return res.status(403).json({ error: `host not allowed: ${u.hostname}` });
    }

    // 缓存命中（v9.26.10：剔除 req_trace/时间戳类动态参数，否则缓存永不命中）
    let cacheKey = target;
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

    const lib = u.protocol === "https:" ? https : http;
    let sent = false; // v9.26.10：防 502/504 双重发送（destroy 触发 error → 二次 res）
    const done = (fn) => { if (!sent) { sent = true; fn(); } };
    const req2 = lib.get(u, r => {
      const chunks = [];
      r.on("data", c => chunks.push(c));
      r.on("end", () => {
        const body = Buffer.concat(chunks);
        const type = r.headers["content-type"] || "application/json";
        cache.set(cacheKey, { ts: Date.now(), body, type });
        if (cache.size > 200) { // 简单 LRU：清掉最老一半
          const keys = [...cache.keys()].slice(0, 100);
          keys.forEach(k => cache.delete(k));
        }
        done(() => {
          res.set("Content-Type", type);
          res.set("Access-Control-Allow-Origin", "*");
          res.send(body);
        });
      });
    });
    req2.on("error", e => done(() => res.status(502).json({ error: e.message })));
    req2.setTimeout(12000, () => { done(() => res.status(504).json({ error: "upstream timeout" })); req2.destroy(); });
  });
};
