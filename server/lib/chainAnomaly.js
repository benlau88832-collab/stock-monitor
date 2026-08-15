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
// v9.148.2（A7 P2-1）：阈值已改 kv chain_anomaly_config 可配置（loadAnomalyConfig），以下为默认值兜底
const BATCH_THRESHOLD = 3;      // 批量涨停/大涨阈值
const PRICE_PCT_THRESHOLD = 3;  // 商品价格 ±3%
const SURGE_PCT = 5;            // 大涨阈值（未涨停）
const LIMIT_PCT = 9.8;          // 涨停近似（10% 板，688/300 用 19.8）
let checkBusy = false;          // v9.148.2（A7）：异动检测 busy 守卫（上一轮未完成跳过本轮）

/** 是否盘中（9:30-11:30 / 13:00-15:00 工作日）—— 大涨检测仅盘中有效（行情为实时）；
 *  v9.148.2（A7 P3）：午休 11:30-13:00 跳过（行情静止，避免无效轮询） */
function isIntraday() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const day = d.getDay();
  if (day === 0 || day === 6) return false;
  const t = d.getHours() * 60 + d.getMinutes();
  return (t >= 9 * 60 + 30 && t <= 11 * 60 + 30) || (t >= 13 * 60 && t <= 15 * 60);
}

/**
 * v9.148.1（T5 P1-3-1）：涨>5% 未涨停批量检测（腾讯批量行情，≤60/批）。
 * 返回 [{chainId, reason, detail}]；仅盘中执行，其余时段返回 []。
 * @param {object} [deps._isIntraday] 测试注入；[deps._requestRaw] 测试注入
 */
async function detectPctSurge(db, deps = {}) {
  const intraday = deps._isIntraday ? deps._isIntraday() : isIntraday();
  if (!intraday) return [];
  const cfg = await loadAnomalyConfig(db);
  const triggers = [];
  try {
    // 6 链集合去重（带命中权重：seed=种子×2，非 seed=概念/hybk×1）
    const byChain = new Map();
    const all = new Set();
    for (const chainId of Object.keys(CHAINS)) {
      const stocks = await getChainStocks(chainId, { limit: 300 }, { _pool: db });
      byChain.set(chainId, stocks);
      stocks.forEach((s) => all.add(s.code));
    }
    const codes = [...all];
    // 分批 60 请求腾讯（v9.148.2 A7：解析名称/涨跌幅/代码段 —— 名称用于 ST 阈值与涨停线分段）
    const quoteMap = new Map(); // code -> {name, pct}
    for (let i = 0; i < codes.length; i += 60) {
      const batch = codes.slice(i, i + 60);
      const q = batch.map((c) => (String(c).startsWith("6") ? "1." : "0.") + c).join(",");
      const requestRawFn = deps._requestRaw || requestRaw;
      const r = await requestRawFn(`https://qt.gtimg.cn/q=${q}`, { timeout: 6000, rawBuffer: true });
      const txt = Buffer.isBuffer(r.body) ? new TextDecoder("gbk").decode(r.body) : String(r.body ?? "");
      for (const m of txt.matchAll(/="([^"]*)"/g)) {
        const f = m[1].split("~");
        const code = String(f[2] ?? "");
        const pct = Number(f[32]);
        if (code && Number.isFinite(pct)) quoteMap.set(code, { name: String(f[1] ?? ""), pct });
      }
    }
    // 每链统计：涨>阈值 且 未涨停（涨停线按代码段：688/300=20cm 线 19.8；其余 9.8；ST 用 4.5 阈值）
    for (const [chainId, stocks] of byChain) {
      const hits = [];
      let weighted = 0;
      for (const s of stocks) {
        const q = quoteMap.get(s.code);
        if (!q || q.pct == null) continue;
        const isST = /ST|退/.test(q.name);
        const threshold = isST ? cfg.stockPctST : cfg.stockPct;
        const limitLine = /^(688|300)/.test(s.code) ? 19.8 : 9.8;
        const weight = s.seed ? 2 : 1; // 种子×2 / 概念·hybk×1
        if (q.pct >= threshold && q.pct < limitLine) {
          hits.push([s.code, q.pct]);
          weighted += weight;
        }
      }
      if (weighted >= cfg.batchThreshold && hits.length >= 2) {
        triggers.push({
          chainId,
          reason: `链内 ${hits.length} 只标的涨>${cfg.stockPct}%（未涨停，加权${weighted}）`,
          detail: hits.slice(0, 5).map(([c, p]) => `${c}(${p.toFixed(1)}%)`).join("、"),
        });
      }
    }
  } catch (e) {
    console.warn("[chainAnomaly] detectPctSurge 失败:", e.message);
  }
  return triggers;
}

/** v9.148.2（A7 P2-1）：异动阈值配置（kv chain_anomaly_config，可被前端/运维调整） */
async function loadAnomalyConfig(db) {
  const def = { batchThreshold: 3, pricePct: 3, stockPct: 5, stockPctST: 4.5 };
  try {
    const r = await db.query(`SELECT value FROM kv_store WHERE key='chain_anomaly_config'`);
    const v = r.rows[0]?.value;
    const obj = v && typeof v === "object" && !Array.isArray(v) ? v : (typeof v === "string" ? JSON.parse(v) : null);
    if (obj) {
      if (Number.isFinite(Number(obj.batchThreshold))) def.batchThreshold = Number(obj.batchThreshold);
      if (Number.isFinite(Number(obj.pricePct))) def.pricePct = Number(obj.pricePct);
      if (Number.isFinite(Number(obj.stockPct))) def.stockPct = Number(obj.stockPct);
      if (Number.isFinite(Number(obj.stockPctST))) def.stockPctST = Number(obj.stockPctST);
    }
  } catch { /* 配置读取失败用默认 */ }
  return def;
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
  // v9.148.2（A7）：busy 守卫 —— 上一轮未跑完（腾讯批量慢/补挖中）跳过本轮，防超时叠加
  if (checkBusy) { console.warn("[chainAnomaly] busy 守卫：上一轮未完成，本轮跳过"); return []; }
  checkBusy = true;
  try {
    return await doCheckAnomalies(db);
  } finally {
    checkBusy = false;
  }
}

async function doCheckAnomalies(db) {
  const cfg = await loadAnomalyConfig(db);
  const triggers = [];

  // 1) 链内批量涨停（≥3 只，加权：种子×2/概念×1）
  const poolArr = await latestLimitPool(db);
  if (poolArr.length > 0) {
    for (const [chainId] of Object.entries(CHAINS)) {
      const stocks = await getChainStocks(chainId, {}, { _pool: db });
      const byCode = new Map(stocks.map((s) => [s.code, s]));
      const hits = poolArr.filter((x) => byCode.has(String(x.code)) && Number(x.pct) >= cfg.stockPct);
      const weighted = hits.reduce((acc, x) => acc + (byCode.get(String(x.code))?.seed ? 2 : 1), 0);
      if (weighted >= cfg.batchThreshold && hits.length >= 2) {
        triggers.push({
          chainId,
          reason: `链内 ${hits.length} 只标的涨停/大涨(≥${cfg.stockPct}%，加权${weighted})`,
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
          if (Math.abs(pct) >= cfg.pricePct) {
            triggers.push({
              chainId,
              reason: `商品「${it.name}」${pct > 0 ? "涨" : "跌"} ${Math.abs(pct).toFixed(1)}%（阈值±${cfg.pricePct}%）`,
              detail: `${it.name}: ${it.price}${it.unit || ""}`,
            });
          }
        }
      }
    }
  } catch { /* 价格检测失败不阻塞 */ }

  // 3) 链内重大公告（v9.148.2 A2 P0-2：修复恒死 SQL + seen 去重）
  //    原 SQL 对 TEXT 列 news.time 与 timestamptz 比较 → "操作符不存在"被 catch 吞，分支从上线起从未生效
  //    窗口恢复 2 小时（10 分钟窗口与新闻入库延迟冲突会永久漏检）；防重复用 kv chain_anomaly_seen:<标题hash>
  try {
    const newsR = await db.query(
      `SELECT title, time FROM news WHERE time >= to_char(now() - interval '2 hours', 'YYYY-MM-DD HH24:MI:SS') ORDER BY time DESC LIMIT 80`,
    );
    const hitsByChain = new Map();
    for (const row of newsR.rows) {
      const t = String(row.title || "");
      // 标题归一化 hash → 已触发过的不再触发（替代"靠窗口防重"的错误思路）
      const hash = require("crypto").createHash("sha1").update(t.replace(/[^\w\u4e00-\u9fa5]/g, "")).digest("hex").slice(0, 16);
      const seenR = await db.query(`SELECT value FROM kv_store WHERE key=$1`, [`chain_anomaly_seen:${hash}`]);
      if (seenR.rows[0]) continue;
      for (const [chainId, cfg] of Object.entries(CHAINS)) {
        if (t.includes(cfg.name)) {
          if (!hitsByChain.has(chainId)) hitsByChain.set(chainId, []);
          hitsByChain.get(chainId).push(t.slice(0, 50));
        }
      }
    }
    for (const [chainId, titles] of hitsByChain) {
      triggers.push({ chainId, reason: `链内消息命中 ${titles.length} 条`, detail: titles.slice(0, 3).join("；"), newsTitles: titles });
    }
  } catch (e) { console.warn("[chainAnomaly] 公告检测失败:", e.message); }

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
  // v9.148.2（A7 P2-5）：尝试过发送（ok 或 非 skipped 的失败）都写节流 —— 发送失败不每 5 分钟重挖烧外网
  if (out.skipped !== true) await markPushed(db, chainId);
  // v9.148.2（A2 P0-2）：公告触发后标记 seen（防同一批旧新闻跨节流反复推）
  if (trigger.newsTitles) {
    for (const t of trigger.newsTitles) {
      const hash = require("crypto").createHash("sha1").update(String(t).replace(/[^\w\u4e00-\u9fa5]/g, "")).digest("hex").slice(0, 16);
      await db.query(
        `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now())
         ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
        [`chain_anomaly_seen:${hash}`, JSON.stringify({ ts: Date.now(), title: String(t).slice(0, 80) })],
      );
    }
  }
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

module.exports = { checkAnomalies, runAnomalyDig, runAnomalyCheck, throttled, markPushed, latestLimitPool, detectPctSurge, loadAnomalyConfig };
