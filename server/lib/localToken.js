// ============================================================
// server/lib/localToken.js —— LOCAL_TOKEN 统一读取与安全比较（v9.148.2 A1）
// 背景：effectiveToken 在 index.js / routes/ai.js / routes/chain.js 三份复制，
//   且 token 比较用普通 !==（时序侧信道）。本模块收敛为单一实现 + timingSafeEqual。
// 用法：effectiveToken(db) → token 字符串或 null；safeEqual(a,b) → 常量时间比较
// ============================================================
const crypto = require("crypto");

let cache = { t: null, ts: 0 };
let initialized = false;

/** 读取 LOCAL_TOKEN（env 优先 → kv local_token，30s 缓存；fail-closed：曾成功读取后失败用最后已知值） */
async function effectiveToken(db) {
  if (process.env.LOCAL_TOKEN) return process.env.LOCAL_TOKEN;
  if (cache.t && Date.now() - cache.ts < 30000) return cache.t;
  try {
    const r = await db.query("SELECT value FROM kv_store WHERE key='local_token'");
    const v = r.rows[0]?.value;
    const t = v && typeof v === "object" && "__raw" in v ? v.__raw : (typeof v === "string" ? v : v?.token);
    cache = { t: t ? String(t) : null, ts: Date.now() };
    initialized = true;
    return cache.t;
  } catch {
    return initialized ? cache.t : null;
  }
}

/** 常量时间比较（长度不等直接 false，避免 timingSafeEqual 抛错） */
function safeEqual(a, b) {
  const ba = Buffer.from(String(a ?? ""));
  const bb = Buffer.from(String(b ?? ""));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** 是否环回地址（127.0.0.1 / ::1 / ::ffff:127.0.0.1） */
function isLoopback(addr) {
  const a = String(addr || "");
  return a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1" || a === "::ffff:127.0.0.1:8080";
}

module.exports = { effectiveToken, safeEqual, isLoopback };
