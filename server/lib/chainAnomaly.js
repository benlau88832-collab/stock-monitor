// ============================================================
// server/lib/chainAnomaly.js —— 异动补挖（任务 11，v9.148.0 / T5 修复 v9.148.1）
// 触发（用户 Q12 确认口径）：
//   1. 链内标的批量 ≥3 只涨幅 >5% 或涨停（概念集合=任务 04 校准产物）
//      v9.148.1（T5）：新增"涨>5% 未涨停"检测（腾讯批量行情，仅盘中 9:30-15:00）
//   2. 关联商品价格当日涨跌 ≥ ±3%（百川）
//   3. 链内重大公告（v9.148.1 T5：5 分钟增量窗口防重复推送）
// 动作：该链立即补挖（站内+外网一轮）→ 推送简讯（含"为什么挖"）→ 同链 30 分钟节流
//       （v9.148.1 T5：节流 kv 写时机移到推送成功后，dig 失败不占冷却）
// ============================================================
const { getChainStocks, CHAINS } = require("./chainStocks");
const { CHAIN_VARIABLES } = require("./chainVariables");
const { scanChain } = require("./chainIntel");
const { sendPushIfConfigured } = require("../routes/push");
const { pool } = require("../db");
const { requestRaw } = require("./outbound");

const THROTTLE_MS = 30 * 60 * 1000;
const BATCH_THRESHOLD = 3;      // 批量涨停/大涨阈值
const PRICE_PCT_THRESHOLD = 3;  // 商品价格 ±3%
const SURGE_PCT = 5;            // 大涨阈值（未涨停）
const LIMIT_PCT = 9.8;          // 涨停近似（10% 板）

/** 是否盘中（9:30-15:00 工作日）—— 大涨检测仅盘中有效（行情为实时） */
function isIntraday() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const day = d.getDay();
  if (day === 0 || day === 6) return false;
  const t = d.getHours() * 60 + d.getMinutes();
  return t >= 9 * 60 + 30 && t <= 15 * 60;
}

/**
 * v9.148.1（T5 P1-3-1）：涨>5% 未涨停批量检测（腾讯批量行情，≤60/批）。
 * 返回 [{chainId, reason, detail}]；仅盘中执行，其余时段返回 []。
 * @param {object} [deps._isIntraday] 测试注入；[deps._requestRaw] 测试注入
 */
async function detectPctSurge(db, deps = {}) {
  const intraday = deps._isIntraday ? deps._isIntraday() : isIntraday();
  if (!intraday) return [];
  const triggers = [];
  try {
    // 6 链集合去重
    const byChain = new Map();
    const all = new Set();
    for (const chainId of Object.keys(CHAINS)) {
      const stocks = await getChainStocks(chainId, { limit: 300 }, { _pool: db });
      byChain.set(chainId, new Set(stocks.map((s) => s.code)));
      stocks.forEach((s) => all.add(s.code));
    }
    const codes = [...all];
    // 分批 60 请求腾讯
    const pctMap = new Map();
    for (let i = 0; i < codes.length; i += 60) {
      const batch = codes.slice(i, i + 60);
      const q = batch.map((c) => (String(c).startsWith("6") ? "1." : "0.") + c).join(",");
      const { parseTencentQuotesBatch } = require("./stockSnapshot");
      const requestRawFn = deps._requestRaw || requestRaw;
      const r = await requestRawFn(`https://qt.gtimg.cn/q=${q}`, { timeout: 6000, rawBuffer: true });
      for (const [code, pct] of parseTencentQuotesBatch(r.body)) {
        if (code && pct != null) pctMap.set(code, pct);
      }
    }
    // 每链统计 pct ∈ [5, 9.8)（未涨停）≥3
    for (const [chainId, set] of byChain) {
      const hits = [];
      for (const code of set) {
        const pct = pctMap.get(code);
        if (pct != null && pct >= SURGE_PCT && pct < LIMIT_PCT) hits.push([code, pct]);
      }
      if (hits.length >= BATCH_THRESHOLD) {
        triggers.push({
          chainId,
          reason: `链内 ${hits.length} 只标的涨>5%（未涨停）`,
          detail: hits.slice(0, 5).map(([c, p]) => `${c}(${p.toFixed(1)}%)`).join("、"),
        });
      }
    }
  } catch (e) {
    console.warn("[chainAnomaly] detectPctSurge 失败:", e.message);
  }
  return triggers;
}

/** 取最新涨停池（zt_snapshot 最新，pool 数组含 code/pct/name） */
async function latestLimitPool(db) {
  const r = await db.query("SELECT data FROM zt_snapshot ORDER BY date DESC LIMIT 1");
  if (!r.rows[0]) return [];
  const d = r.rows[0].data;
  const obj = typeof d === "string" ? JSON.parse(d) : d;
  return Array.isArray(obj?.pool) ? obj.pool : [];
}

/** 检测异动：返回 [{chainId, reason, detail}] */
async function checkAnomalies(db) {
  const triggers = [];

  // 1) 链内批量涨停/大涨（≥3 只）
  const poolArr = await latestLimitPool(db);
  if (poolArr.length > 0) {
    for (const [chainId] of Object.entries(CHAINS)) {
      const stocks = await getChainStocks(chainId, {}, { _pool: db });
      const set = new Set(stocks.map((s) => s.code));
      const hits = poolArr.filter((x) => set.has(String(x.code)) && Number(x.pct) >= 5);
      if (hits.length >= BATCH_THRESHOLD) {
        triggers.push({
          chainId,
          reason: `链内 ${hits.length} 只标的涨停/大涨(≥5%)`,
          detail: hits.slice(0, 5).map((x) => `${x.name}(${Number(x.pct).toFixed(1)}%)`).join("、"),
        });
      }
    }
  }

  // 2) 关联商品价格 ±3%（百川今日快照；dir + pct 或对昨日对比）
  try {
    const kvR = await db.query(`SELECT value FROM kv_store WHERE key LIKE 'commodity_price:%' ORDER BY key DESC LIMIT 2`);
    if (kvR.rows.length >= 1) {
      const parse = (v) => { const o = typeof v === "string" ? JSON.parse(v) : v; return Array.isArray(o?.items) ? o.items : []; };
      const today = parse(kvR.rows[0].value);
      const prev = kvR.rows.length > 1 ? parse(kvR.rows[1].value) : [];
      const prevMap = new Map(prev.map((x) => [x.name, x]));
      const byChain = new Map();
      for (const [chainId, cfg] of Object.entries(CHAIN_VARIABLES)) {
        for (const v of cfg.variables) {
          if (!v.commodity) continue;
          if (!byChain.has(chainId)) byChain.set(chainId, []);
          byChain.get(chainId).push(v.commodity);
        }
      }
      for (const [chainId, commodities] of byChain) {
        for (const name of commodities) {
          const it = today.find((x) => String(x.name).includes(name) || name.includes(String(x.name)));
          if (!it) continue;
          let pct = Number(it.pct) || 0;
          if (!pct) {
            const p = prevMap.get(it.name);
            if (p?.price && it.price) pct = ((Number(it.price) - Number(p.price)) / Number(p.price)) * 100;
          }
          if (Math.abs(pct) >= PRICE_PCT_THRESHOLD) {
            triggers.push({
              chainId,
              reason: `商品「${it.name}」${pct > 0 ? "涨" : "跌"} ${Math.abs(pct).toFixed(1)}%（阈值±${PRICE_PCT_THRESHOLD}%）`,
              detail: `${it.name}: ${it.price}${it.unit || ""}`,
            });
          }
        }
      }
    }
  } catch { /* 价格检测失败不阻塞 */ }

  // 3) 链内重大公告（v9.148.1 T5：10 分钟增量窗口 —— cron 每 5 分钟跑，覆盖上一轮；
  //    旧 24h 窗口会让同一批新闻在节流过期后反复触发）
  try {
    const newsR = await db.query(`SELECT title, time FROM news WHERE time >= now() - interval '10 minutes' ORDER BY time DESC LIMIT 80`);
    const hitsByChain = new Map();
    for (const row of newsR.rows) {
      const t = String(row.title || "");
      for (const [chainId, cfg] of Object.entries(CHAINS)) {
        if (t.includes(cfg.name)) {
          if (!hitsByChain.has(chainId)) hitsByChain.set(chainId, []);
          hitsByChain.get(chainId).push(t.slice(0, 50));
        }
      }
    }
    for (const [chainId, titles] of hitsByChain) {
      triggers.push({ chainId, reason: `链内消息命中 ${titles.length} 条`, detail: titles.slice(0, 3).join("；") });
    }
  } catch { /* 公告检测失败不阻塞 */ }

  // v9.148.1（T5 P1-3-1）：涨>5% 未涨停检测（仅盘中）
  triggers.push(...(await detectPctSurge(db)));

  return triggers;
}

/** 节流检查（v9.148.1 T5：只读不写 —— 写时机移到 runAnomalyDig 推送成功后，dig 失败不占冷却） */
async function throttled(db, chainId) {
  const r = await db.query(`SELECT value FROM kv_store WHERE key=$1`, [`chain_anomaly_push:${chainId}`]);
  const v = r.rows[0]?.value;
  let ts = 0;
  if (v) {
    if (typeof v === "string") { try { ts = Number(JSON.parse(v).ts) || 0; } catch { ts = Number(v) || 0; } }
    else ts = Number(v?.ts) || 0;
  }
  return !!(ts && Date.now() - ts < THROTTLE_MS);
}

/** 推送成功后写节流（v9.148.1 T5） */
async function markPushed(db, chainId) {
  await db.query(
    `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now())
     ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
    [`chain_anomaly_push:${chainId}`, JSON.stringify({ ts: Date.now() })],
  );
}

/** 异动补挖：单链立即扫描 + 简讯推送（含"为什么挖"）；返回 {chainId, reason, pushed} */
async function runAnomalyDig(db, chainId, trigger, { withWeb = true } = {}) {
  const intel = await scanChain(db, chainId, { withWeb });
  const top = intel.items.filter((i) => i.verified).concat(intel.items.filter((i) => i.singleAuthoritative)).slice(0, 3);
  const body = [
    `⚡ ${trigger.reason}`,
    `   ${trigger.detail}`,
    ``,
    ...top.map((i) => `• ${i.title.slice(0, 70)}（${i.sources.join("/").slice(0, 24)}）`),
    top.length === 0 ? "• 补挖未发现已验证新信号（详见简报）" : "",
    ``,
    `📋 完整简报：#briefing（驾驶舱顶部 / 手机扫码）`,
  ].filter(Boolean).join("\n");
  const out = await sendPushIfConfigured({ title: `⚡ 产业链异动：${CHAINS[chainId].name}`, body, severity: "warn" }, db);
  // v9.148.1（T5）：推送成功后才写节流（未配置渠道 skipped 也写 —— 防未绑定期间反复补挖烧外网搜索）
  if (out.ok || out.skipped) await markPushed(db, chainId);
  return { chainId, reason: trigger.reason, pushed: out.ok, skipped: out.skipped };
}

/** 盘中入口：检测 → 逐触发补挖（节流过滤） */
async function runAnomalyCheck(db = pool) {
  const triggers = await checkAnomalies(db);
  const results = [];
  for (const t of triggers) {
    if (await throttled(db, t.chainId)) { results.push({ chainId: t.chainId, reason: t.reason, throttled: true }); continue; }
    try {
      results.push(await runAnomalyDig(db, t.chainId, t));
    } catch (e) {
      results.push({ chainId: t.chainId, reason: t.reason, error: e.message });
    }
  }
  return results;
}

module.exports = { checkAnomalies, runAnomalyDig, runAnomalyCheck, throttled, markPushed, latestLimitPool, detectPctSurge };
