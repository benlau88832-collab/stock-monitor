// ============================================================
// P0-4：外部推送服务端中转
// 渠道：Server酱 / 企业微信机器人 Webhook / Bark
// 设置来源：读 PG kv_store:push_settings_v1（前端写），或环境变量
//   PUSH_CHANNEL + PUSH_SERVERCHAN_KEY / PUSH_WECHATBOT_KEY / PUSH_BARK_KEY
// 优先级：DB 设置 > 环境变量
// 导出：函数接收 app（与 db.js 同模式，index.js 调用 require("./routes/push")(app)）
//       + sendPushIfConfigured（供 watch.js/cron.js 复用）
// ============================================================
const express = require("express");
const https = require("https");
const http = require("http");
const { pool } = require("../db");

// ---- 加载推送设置（PG or env） ----
async function loadPushConfig(poolArg) {
  const p = poolArg ?? pool;
  try {
    const r = await p.query("SELECT value FROM kv_store WHERE key=$1", ["push_settings_v1"]);
    if (r.rows.length && r.rows[0].value) {
      const v = r.rows[0].value;
      // PG JSONB 可能包含 {__raw: "..."} 包装 or 直接对象
      const obj = v && typeof v === "object" && !Array.isArray(v)
        ? v
        : (v && typeof v.__raw === "string" ? JSON.parse(v.__raw) : v);
      if (obj && obj.enabled && obj.channel) return obj;
    }
  } catch { /* skip */ }
  // env fallback
  const channel = process.env.PUSH_CHANNEL;
  if (!channel) return null;
  return {
    enabled: true,
    channel,
    serverchanSctKey: process.env.PUSH_SERVERCHAN_KEY,
    wechatbotKey: process.env.PUSH_WECHATBOT_KEY,
    barkKey: process.env.PUSH_BARK_KEY,
    minSeverity: process.env.PUSH_MIN_SEVERITY || "warning",
  };
}

// ---- 通用 HTTP request ----
function httpRequest(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const data = opts.body ?? "";
    const reqOpts = {
      method: opts.method || "GET",
      headers: opts.headers || {},
    };
    if (data) reqOpts.headers["Content-Length"] = Buffer.byteLength(data);
    const req = lib.request(u, reqOpts, r => {
      const chunks = [];
      r.on("data", c => chunks.push(c));
      r.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        resolve({ status: r.statusCode, body });
      });
    });
    req.on("error", reject);
    req.setTimeout(opts.timeout || 8000, () => req.destroy(new Error("timeout")));
    if (data) req.write(data);
    req.end();
  });
}

/**
 * P1-6：供 watch.js 等 cron 任务复用的推送发送（不依赖 express req/res）
 * @param p { title, body, severity }
 * @param poolArg 可选 pool（watch.js 传自己的）
 * 返回 { ok, status }；未配置/失败静默返回 { ok:false }
 */
async function sendPushIfConfigured(p, poolArg) {
  const cfg = await loadPushConfig(poolArg);
  if (!cfg) return { ok: false, skipped: true };
  let result = null;
  const titleEnc = encodeURIComponent(p.title);
  const bodyEnc = encodeURIComponent(p.body);
  if (cfg.channel === "serverchan" && cfg.serverchanSctKey) {
    result = await httpRequest(`https://sctapi.ftqq.com/${cfg.serverchanSctKey}.send`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `title=${titleEnc}&desp=${bodyEnc}`,
      timeout: 8000,
    });
  } else if (cfg.channel === "wechatbot" && cfg.wechatbotKey) {
    result = await httpRequest(`https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${cfg.wechatbotKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ msgtype: "text", text: { content: `${p.title}\n\n${p.body}` } }),
      timeout: 8000,
    });
  } else if (cfg.channel === "bark" && cfg.barkKey) {
    result = await httpRequest(`https://api.day.app/${cfg.barkKey}/${titleEnc}/${bodyEnc}`, {
      method: "GET",
      timeout: 8000,
    });
  } else {
    return { ok: false, skipped: true, reason: "channel misconfigured" };
  }
  const ok = result && result.status >= 200 && result.status < 300;
  // 写推送日志（防重复，可审计）
  try {
    const today = new Date().toISOString().slice(0, 10);
    await (poolArg ?? pool).query(
      `INSERT INTO kv_store(key, value, updated_at) VALUES($1,$2,now())
       ON CONFLICT (key) DO UPDATE SET value=kv_store.value || $2, updated_at=now()`,
      [`push_log:${today}`, JSON.stringify([{ ts: Date.now(), title: p.title, severity: p.severity, status: result?.status, ok }])],
    );
  } catch { /* log 失败不影响主链 */ }
  return { ok, status: result?.status };
}

function pushRoutes(app) {
  const router = express.Router();
  app.use("/api/push", router);

  router.post("/send", async (req, res) => {
    const p = req.body || {};
    if (!p.title || !p.body) return res.status(400).json({ error: "title & body required" });
    try {
      const r = await sendPushIfConfigured(p);
      if (r.skipped) return res.json({ ok: false, skipped: true, reason: r.reason ?? "no push config" });
      res.json(r);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}

module.exports = pushRoutes;
module.exports.sendPushIfConfigured = sendPushIfConfigured;