// ============================================================
// server/lib/chainAnomaly.js —— 异动补挖（任务 11，v9.148.0）
// 触发（用户 Q12 确认口径）：
//   1. 链内标的批量 ≥3 只涨幅 >5% 或涨停（概念集合=任务 04 校准产物）
//   2. 关联商品价格当日涨跌 ≥ ±3%（百川）
//   3. 链内重大公告（news 标题命中链名/变量词）
// 动作：该链立即补挖（站内+外网一轮）→ 推送简讯（含"为什么挖"）→ 同链 30 分钟节流
// ============================================================
const { getChainStocks, CHAINS } = require("./chainStocks");
const { CHAIN_VARIABLES } = require("./chainVariables");
const { scanChain } = require("./chainIntel");
const { sendPushIfConfigured } = require("../routes/push");
const { pool } = require("../db");

const THROTTLE_MS = 30 * 60 * 1000;
const BATCH_THRESHOLD = 3;      // 批量涨停/大涨阈值
const PRICE_PCT_THRESHOLD = 3;  // 商品价格 ±3%

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

  // 3) 链内重大公告（news 标题命中链名）
  try {
    const newsR = await db.query(`SELECT title, time FROM news WHERE time >= now() - interval '24 hours' ORDER BY time DESC LIMIT 80`);
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

  return triggers;
}

/** 节流检查：同链 30 分钟内不重复推送（kv chain_anomaly_push:chainId = ts） */
async function throttled(db, chainId) {
  const r = await db.query(`SELECT value FROM kv_store WHERE key=$1`, [`chain_anomaly_push:${chainId}`]);
  const v = r.rows[0]?.value;
  let ts = 0;
  if (v) {
    if (typeof v === "string") { try { ts = Number(JSON.parse(v).ts) || 0; } catch { ts = Number(v) || 0; } }
    else ts = Number(v?.ts) || 0;
  }
  if (ts && Date.now() - ts < THROTTLE_MS) return true;
  await db.query(
    `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now())
     ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
    [`chain_anomaly_push:${chainId}`, JSON.stringify({ ts: Date.now() })],
  );
  return false;
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

module.exports = { checkAnomalies, runAnomalyDig, runAnomalyCheck, throttled, latestLimitPool };
