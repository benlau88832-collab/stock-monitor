// ============================================================
// P0-4：外部推送服务端中转
// 渠道：Server酱 / 企业微信机器人 Webhook / Bark / 飞书 webhook / QQ（Qmsg 酱）
// v9.84.2（4.4）：多通道并发 —— 前端可同时配置多个 key，服务端全部已配置渠道并发推送
// 设置来源：读 PG kv_store:push_settings_v1（前端写），或环境变量
//   PUSH_CHANNEL + PUSH_SERVERCHAN_KEY / PUSH_WECHATBOT_KEY / PUSH_BARK_KEY / PUSH_FEISHU_WEBHOOK / PUSH_QMSG_KEY
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
      if (obj && obj.enabled) return obj;
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
    feishuWebhook: process.env.PUSH_FEISHU_WEBHOOK,
    qmsgKey: process.env.PUSH_QMSG_KEY,
    minSeverity: process.env.PUSH_MIN_SEVERITY || "warning",
  };
}

// ---- 通用 HTTP request ----
function httpRequest(url, opts = {}) {
  return new Promise((resolve, reject) => {
    // v9.81（安全加固）：出站 host 白名单（推送网关固定域名，防 SSRF）
    try { require("../lib/hostGuard").assertHostAllowed(url); } catch (e) { reject(e); return; }
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
 * v9.84.2（4.4）：从配置推导全部已配置渠道（兼容旧单 channel 语义 + 多 key 并存）
 */
function channelsOf(cfg) {
  const out = [];
  const single = Array.isArray(cfg.channels) ? cfg.channels : (cfg.channel ? [cfg.channel] : []);
  // 显式 channels 数组优先（内部调用可指定）；否则按已配置 key 推导
  if (Array.isArray(cfg.channels) && cfg.channels.length > 0) return cfg.channels;
  if (cfg.serverchanSctKey && (single.includes("serverchan") || single.length === 0)) out.push("serverchan");
  if (cfg.wechatbotKey && (single.includes("wechatbot") || single.length === 0)) out.push("wechatbot");
  if (cfg.barkKey && (single.includes("bark") || single.length === 0)) out.push("bark");
  if (cfg.feishuWebhook && (single.includes("feishu") || single.length === 0)) out.push("feishu");
  if (cfg.qmsgKey && (single.includes("qq") || single.length === 0)) out.push("qq");
  // 兼容：只有 channel 无任何 key（旧配置异常态）→ 按 channel 直推（可能失败，由调用方兜底）
  if (out.length === 0 && single.length > 0 && single[0] !== "") return single;
  return out;
}

/** 单渠道发送实现（返回 {status, body}） */
async function sendOneChannel(cfg, channel, title, body) {
  const titleEnc = encodeURIComponent(title);
  const bodyEnc = encodeURIComponent(body);
  switch (channel) {
    case "serverchan":
      return await httpRequest(`https://sctapi.ftqq.com/${cfg.serverchanSctKey}.send`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `title=${titleEnc}&desp=${bodyEnc}`,
        timeout: 8000,
      });
    case "wechatbot":
      return await httpRequest(`https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${cfg.wechatbotKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ msgtype: "text", text: { content: `${title}\n\n${body}` } }),
        timeout: 8000,
      });
    case "bark":
      return await httpRequest(`https://api.day.app/${cfg.barkKey}/${titleEnc}/${bodyEnc}`, {
        method: "GET",
        timeout: 8000,
      });
    case "feishu":
      // 飞书自定义机器人：POST JSON 到完整 webhook URL（host 白名单 open.feishu.cn）
      return await httpRequest(cfg.feishuWebhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ msg_type: "text", content: { text: `${title}\n${body}` } }),
        timeout: 8000,
      });
    case "qq":
      // Qmsg 酱：POST form 到 https://qmsg.zndx.net/send/{key}?msg=...
      return await httpRequest(`https://qmsg.zndx.net/send/${cfg.qmsgKey}?msg=${titleEnc}%0A%0A${bodyEnc}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `msg=${titleEnc}%0A%0A${bodyEnc}`,
        timeout: 8000,
      });
    default:
      return null;
  }
}

/**
 * P1-6：供 watch.js 等 cron 任务复用的推送发送（不依赖 express req/res）
 * v9.84.2（4.4）：多通道并发 —— 全部已配置渠道同时发送，任一成功即 ok
 * @param p { title, body, severity, channels? } channels 可选（如只推 QQ 等指定渠道）
 * @param poolArg 可选 pool（watch.js 传自己的）
 * 返回 { ok, status, results }；未配置/失败静默返回 { ok:false }
 */
async function sendPushIfConfigured(p, poolArg) {
  const cfg = await loadPushConfig(poolArg);
  if (!cfg) return { ok: false, skipped: true };
  const channels = p.channels && p.channels.length > 0 ? p.channels : channelsOf(cfg);
  if (channels.length === 0) return { ok: false, skipped: true, reason: "no channel configured" };
  const title = String(p.title ?? "");
  const body = String(p.body ?? "");
  const results = await Promise.allSettled(channels.map(ch => sendOneChannel(cfg, ch, title, body)));
  const okResults = results
    .filter(r => r.status === "fulfilled" && r.value && r.value.status >= 200 && r.value.status < 300 && businessOk(r.value, channels[results.indexOf(r)]))
    .length;
  const ok = okResults > 0;
  // 写推送日志（防重复，可审计）
  try {
    // v9.85.0（P1-15）：日志日期用北京时间（原 UTC 日期在凌晨 8 点前归档到前一天）
    const bjNow = new Date(Date.now() + 8 * 3600 * 1000);
    const today = bjNow.toISOString().slice(0, 10);
    await (poolArg ?? pool).query(
      `INSERT INTO kv_store(key, value, updated_at) VALUES($1,$2,now())
       ON CONFLICT (key) DO UPDATE SET value=kv_store.value || $2, updated_at=now()`,
      [`push_log:${today}`, JSON.stringify([{
        ts: Date.now(), title, severity: p.severity ?? "info",
        channels: channels.map((c, i) => {
          const r = results[i];
          return { channel: c, status: r.status === "fulfilled" ? r.value?.status : null, ok: r.status === "fulfilled" && r.value?.status >= 200 && r.value?.status < 300 };
        }),
        ok,
      }])],
    );
  } catch { /* log 失败不影响主链 */ }
  return { ok, status: okResults > 0 ? 200 : 500, results };
}

/**
 * v9.80（A3-P1-5 修复）：渠道业务码校验 —— HTTP 2xx 不代表推送成功
 * Server酱：返回 JSON {code, message}，code!==0 为失败
 * 企业微信机器人：返回 JSON {errcode, errmsg}，errcode!==0 为失败
 * 飞书：返回 JSON {code, msg}，code!==0 为失败
 * Qmsg 酱：返回 JSON {success:true|false} 或 {"status":"ok"} 兼容
 * Bark：200 + 空/JSON 视为成功（无业务错误码）
 */
function businessOk(result, channel) {
  if (!result || !result.body) return false;
  const body = result.body.trim();
  if (!body) return true; // 空 body（Bark 成功通常无 body 或空）
  try {
    const j = JSON.parse(body);
    if (channel === "serverchan") {
      // 成功: {"code":0,"message":"","data":{...}}
      return j.code === 0;
    }
    if (channel === "wechatbot") {
      // 成功: {"errcode":0,"errmsg":"ok"}
      return j.errcode === 0;
    }
    if (channel === "feishu") {
      // 成功: {"code":0,"msg":"success"}（飞书约定 code===0）
      return j.code === 0 || j.code === undefined;
    }
    if (channel === "qq") {
      // Qmsg 酱：成功 {"success":true,"reason":...} 或 {"status":"ok"}
      return j.success !== false && j.status !== "failed";
    }
    // bark/其他：无业务码 → HTTP 2xx 即成功
    return true;
  } catch {
    return true; // body 非 JSON（如 Bark 的明文）→ 视为成功
  }
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
module.exports.loadPushConfig = loadPushConfig; // v9.148.1（T8）：push-state 复用
