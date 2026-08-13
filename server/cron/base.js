// ============================================================
// server/cron/base.js —— 领域模块（v9.139.0 阶段二 #16，split-cron.js 自动拆分）
// 行为与原 cron.js 逐字一致；原文件已只留调度注册
// ============================================================
// 共享基础设施：EM_UT/contentKey/sealPrevMap+detectSealDecayServer/httpsGet/统一 require/
// bjDate/bjDateStr/checkpoint(markCronStep/hasCronStep)/busy 标志/交易日历

const EM_UT = "7eea3edcaed734bea9cbfc24409ed989";

let sealPrevMap = new Map();


const { getJson, getJsonWithFallback, requestRaw } = require("../lib/outbound"); // v9.127.0：requestRaw（腾讯 GBK 批量行情）
const { parseLLMJSON, SCHEMAS } = require("../lib/llmJson");
const { withPgLock, LOCK_CRON_MAIN, LOCK_THEME, LOCK_WATCH, LOCK_INTRADAY } = require("../lib/pgLock");

// ---------- v9.26.5：自动 LLM 分析调用（.cn 直连优先，失败走代理） ----------
// v9.38.1（V3-P0）：抽公共层 server/lib/httpProxy.js（惰性 require + 容错，消除重复实现）
const { callModelText: callLLM } = require("../lib/httpProxy");
// v9.42：因子 IC 服务端评估（幻方"因子失效"监测权威落库端）
const { saveFactorIc } = require("../lib/factorIc");

// ---------- 启动定时任务 ----------
// v9.89.0（P2-4）：15:40 链 checkpoint —— 每步成功后落 kv cron_cp:日期，
//   重启后启动补抓跳过已完成步骤（防重复执行/重复计费）
const CRON_CP_KEY = "cron_cp";

// v9.54（V7-15）：A股交易日历 —— 节假日休市判定（与前端 tradeCalendar.ts 口径一致）
// v9.137.0（审查 P3-07）：休市区间单源化 —— 改用 src/shared/trade-holidays.js（ESM，Node 22+ require 互操作，
//   与 concept-groups.js 同机制），删除本文件内联 2026 硬编码表（曾与前端双源漂移；2027+ 只改 shared 一处）
const TRADE_HOLIDAYS = (() => {
  try {
    const mod = require("../../src/shared/trade-holidays.js");
    return { set: mod.buildHolidaySet(), ranges: mod.TRADE_HOLIDAY_RANGES };
  } catch (e) {
    console.warn("[cron] trade-holidays 加载失败（回退空表，仅周末判定）:", e.message);
    return { set: new Set(), ranges: {} };
  }
})();

function contentKey(seed) {
  const crypto = require("crypto");
  const h = crypto.createHash("sha256").update(String(seed)).digest("hex").slice(0, 16);
  return `fb_${h}`;
}

function detectSealDecayServer(poolArr) {
  const now = Date.now();
  const alerts = [];
  const current = new Map();
  const STALE_MS = 120000;
  for (const s of poolArr) {
    const code = String(s?.c ?? s?.code ?? "");
    const fund = Number(s?.fund ?? 0);
    if (!code) continue;
    const prev = sealPrevMap.get(code);
    if (!prev || now - prev.ts > STALE_MS || prev.fund <= 0) {
      current.set(code, { fund, ts: now, base: fund });
      continue;
    }
    const base = fund > prev.base ? fund : prev.base;
    const changePct = fund > 0 ? (fund - base) / base : -1;
    let alert = null;
    if (fund <= 0) {
      alert = { code, name: String(s?.n ?? s?.name ?? code), prevFund: prev.fund, nowFund: 0, changePct: -100, level: "red", boardCount: Number(s?.lbc ?? 1) };
    } else if (changePct <= -0.8 && fund < Math.max(5e6, base * 0.1)) {
      alert = { code, name: String(s?.n ?? s?.name ?? code), prevFund: prev.fund, nowFund: fund, changePct: Math.round(changePct * 100), level: "red", boardCount: Number(s?.lbc ?? 1) };
    } else if (changePct <= -0.5) {
      alert = { code, name: String(s?.n ?? s?.name ?? code), prevFund: prev.fund, nowFund: fund, changePct: Math.round(changePct * 100), level: "yellow", boardCount: Number(s?.lbc ?? 1) };
    }
    if (alert) { alerts.push(alert); current.set(code, { fund, ts: now, base: fund }); }
    else current.set(code, { fund, ts: now, base });
  }
  sealPrevMap = current;
  return alerts;
}


// ---------- 通用 https GET ----------
// v9.81（性能）：默认超时 15s→6s —— 东财断源时服务端外部等待快速失败，不再占连接池
// v9.86.0（P2-7）：改为统一出站客户端 outbound.getJson 薄封装 —— 签名不变（返回 Promise<JSON>，
//   15+ 调用点零改动），内部统一 hostGuard 白名单校验 + 错误分类（timeout/http/parse/network）。
function httpsGet(url, timeout = 6000) {
  return getJson(url, { timeout, headers: { Referer: "https://data.eastmoney.com/" }, source: "eastmoney" }).then(r => r.data);
}


function bjDate(offset = 0) {  const d = new Date(Date.now() + 8 * 3600 * 1000 + offset * 86400000);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

function bjDateStr(offset = 0) {  const d = new Date(Date.now() + 8 * 3600 * 1000 + offset * 86400000);
  return d.toISOString().slice(0, 10);
}

async function markCronStep(pool, dateStr, step) {
  try {
    const k = await pool.query("SELECT value FROM kv_store WHERE key=$1", [`${CRON_CP_KEY}:${dateStr}`]);
    const v = k.rows[0]?.value;
    const steps = (typeof v === "string" ? JSON.parse(v) : v)?.steps ?? {};
    steps[step] = new Date().toISOString();
    await pool.query(
      `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now())
       ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
      [`${CRON_CP_KEY}:${dateStr}`, JSON.stringify({ date: dateStr, steps })],
    );
  } catch { /* checkpoint 失败不影响主流程 */ }
}

async function hasCronStep(pool, dateStr, step) {
  try {
    const k = await pool.query("SELECT value FROM kv_store WHERE key=$1", [`${CRON_CP_KEY}:${dateStr}`]);
    const v = k.rows[0]?.value;
    const steps = (typeof v === "string" ? JSON.parse(v) : v)?.steps ?? {};
    return Boolean(steps[step]);
  } catch { return false; }
}

function isTradingDayCN(d = new Date()) {
  const day = d.getDay();
  if (day === 0 || day === 6) return false;
  // 北京时间日期串
  const bj = new Date(d.getTime() + d.getTimezoneOffset() * 60000 + 8 * 3600000);
  const ds = `${bj.getUTCFullYear()}-${String(bj.getUTCMonth() + 1).padStart(2, "0")}-${String(bj.getUTCDate()).padStart(2, "0")}`;
  return !TRADE_HOLIDAYS.set.has(ds);
}
module.exports = { contentKey, httpsGet, bjDate, bjDateStr, EM_UT, detectSealDecayServer, markCronStep, hasCronStep, isTradingDayCN, getJson, getJsonWithFallback, requestRaw, parseLLMJSON, SCHEMAS, withPgLock, LOCK_CRON_MAIN, LOCK_THEME, LOCK_WATCH, LOCK_INTRADAY, callLLM, saveFactorIc };

