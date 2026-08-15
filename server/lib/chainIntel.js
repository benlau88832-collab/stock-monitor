// ============================================================
// server/lib/chainIntel.js —— 每晚全链挖掘引擎（任务 07，v9.148.0）
// 链路：站内信号（industry_chain_signal）+ 外网搜索（webSearch 按变量/人物）
//       → 验证规则（≥2 独立来源且 ≥1 权威 → verified）→ 原始情报落库 chain_intel
// 消费方：任务 08 链简报生成（LLM 读 chain_intel 出简报）
// 触发：cron 每晚 21:00 runNightlyScan（幂等：同链同日覆盖）
// ============================================================
const { pool } = require("../db");
const { searchWeb } = require("./webSearch");
const { getChainStocks } = require("./chainStocks");
const { getChainVariables, getKeyPeople } = require("./chainVariables");
const { getCommodityPriceHistory } = require("./commodityPrice");

// v9.148.1（T1 P0-1）：新引擎链 ID → 既有 46 链 ID 映射（2026-08-16 实测数据库对齐；
//   此前 aiCompute 等 5 链按新 ID 查信号恒 0 → 站内信号从未进过 LLM 简报）
// v9.148.2（A7 P3）：robotics 补 machine-tool（谐波减速器/丝杠聚集地，58 条信号）
const CHAIN_SIGNAL_MAP = {
  semiconductor: ["semiconductor", "storage"],
  aiCompute:     ["ai-hardware", "compute-service", "liquid-cooling", "optical-comm"],
  aiPower:       ["grid", "power", "energy-storage"],
  nonferrous:    ["copper", "aluminum", "gold"],
  minorMetals:   ["rare-earth", "gold"],
  robotics:      ["robot", "machine-tool"],
};

/** 表结构（幂等 ensure；已存在的表补 signals 列） */
async function ensureChainIntelTable(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS chain_intel (
    id SERIAL PRIMARY KEY,
    chain_id TEXT NOT NULL,
    intel_date TEXT NOT NULL,
    items JSONB NOT NULL DEFAULT '[]',
    people JSONB NOT NULL DEFAULT '[]',
    meta JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(chain_id, intel_date)
  )`);
  await db.query(`ALTER TABLE chain_intel ADD COLUMN IF NOT EXISTS signals JSONB NOT NULL DEFAULT '[]'`);
}

/** 标题归一化（去非字母数字，用于"同一事件多源"分组） */
function normTitle(t) {
  return String(t).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, "").slice(0, 60);
}

/**
 * 验证规则（纯函数，PRD 4.3）：≥2 个独立来源 且 ≥1 个权威源 → verified；否则 pending + 来源数。
 * 同一标题归一化的事件多源转载合并为一组；组内按 source 去重计独立来源。
 * @param {Array<{title,url,source,time,authoritative}>} items
 * @returns {Array<{title,urls,sources,sourceCount,authoritativeCount,verified,reason}>}
 */
function classifyItems(items) {
  const groups = new Map();
  for (const it of items) {
    const k = normTitle(it.title);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, { key: k, title: it.title, urls: [], sources: new Set(), authoritativeCount: 0, latest: it });
    const g = groups.get(k);
    g.urls.push(it.url);
    g.sources.add(String(it.source || ""));
    if (it.authoritative) g.authoritativeCount++;
    if (!g.latest.time || (it.time && it.time > g.latest.time)) g.latest = it;
  }
  return [...groups.values()].map((g) => {
    const sourceCount = g.sources.size;
    const verified = sourceCount >= 2 && g.authoritativeCount >= 1;
    return {
      title: g.title,
      urls: g.urls.slice(0, 5),
      sources: [...g.sources].slice(0, 5),
      sourceCount,
      authoritativeCount: g.authoritativeCount,
      verified,
      // v9.148.0：单源但权威 = 值得保留（事件级多源综合由简报 LLM 层做，规则层只做字符串级判定）
      singleAuthoritative: sourceCount === 1 && g.authoritativeCount >= 1,
      reason: verified ? "" : `仅 ${sourceCount} 个来源${g.authoritativeCount === 0 ? "，无权威源" : "，含权威源"}，小心`,
      time: g.latest.time,
    };
  });
}

/** 站内信号（最近 30 天 industry_chain_signal，按既有 46 链 ID 映射查询）
 * v9.148.2（A7 P3）：未映射链打 warn 防复发 */
async function localSignals(db, chainId) {
  const ids = CHAIN_SIGNAL_MAP[chainId];
  if (!ids) {
    console.warn(`[chainIntel] CHAIN_SIGNAL_MAP 未映射链: ${chainId}（直查自身 ID，若信号异常请补映射）`);
    return db.query(
      `SELECT s.signal_type, s.value, s.unit, s.direction, s.effective_date, n.name AS node_name, n.chain_id
       FROM industry_chain_signal s JOIN industry_chain_node n ON n.id = s.node_id
       WHERE n.chain_id = ANY($1::text[]) AND s.effective_date >= CURRENT_DATE - 30
       ORDER BY s.effective_date DESC LIMIT 50`,
      [[chainId]],
    ).then((r) => r.rows);
  }
  const r = await db.query(
    `SELECT s.signal_type, s.value, s.unit, s.direction, s.effective_date, n.name AS node_name, n.chain_id
     FROM industry_chain_signal s JOIN industry_chain_node n ON n.id = s.node_id
     WHERE n.chain_id = ANY($1::text[]) AND s.effective_date >= CURRENT_DATE - 30
     ORDER BY s.effective_date DESC LIMIT 50`,
    [ids],
  );
  return r.rows;
}

/** 单链扫描：站内信号 + 外网（变量中英 + 关联人物）→ 验证 → 原始情报 */
async function scanChain(db, chainId, { withWeb = true } = {}) {
  const cfg = getChainVariables(chainId);
  if (!cfg) throw new Error(`unknown chain: ${chainId}`);
  const people = (await getKeyPeople(db)).filter((p) => p.chains.includes(chainId));

  // 1) 站内
  const signals = await localSignals(db, chainId);
  const stocks = await getChainStocks(chainId, {}, { _pool: db });
  const prices = await getCommodityPriceHistory(db, { days: 30 }).catch(() => null);

  // 2) 外网搜索（变量 × en+enAlt+zh 交叉召回 → 多源验证；人物按语言），失败单项降级不阻塞
  const webItems = [];
  const searchLog = [];
  if (withWeb) {
    for (const v of cfg.variables) {
      const kws = [[v.en, "en"], [v.enAlt || v.en, "en"], [v.zh, "zh"]];
      for (const [kw, lang] of kws) {
        try {
          const hits = await searchWeb(kw, { days: 7, lang });
          webItems.push(...hits.slice(0, 10));
          searchLog.push({ variable: v.key, lang, kw: kw.slice(0, 24), count: hits.length });
        } catch (e) {
          searchLog.push({ variable: v.key, lang, error: e.message });
        }
      }
    }
    for (const p of people) {
      const lang = /[\u4e00-\u9fa5]/.test(p.name) ? "zh" : "en";
      try {
        const hits = await searchWeb(p.search, { days: 7, lang });
        webItems.push(...hits.slice(0, 5).map((h) => ({ ...h, person: p.name })));
        searchLog.push({ person: p.name, lang, count: hits.length });
      } catch (e) {
        searchLog.push({ person: p.name, error: e.message });
      }
    }
  }

  // 3) 验证 + 按人/普通分组
  const items = classifyItems(webItems.filter((x) => !x.person));
  const peopleIntel = people.map((p) => ({
    name: p.name,
    zh: p.zh,
    note: p.note,
    items: classifyItems(webItems.filter((x) => x.person === p.name)),
  }));

  return {
    chainId,
    chainName: cfg.name,
    signals: signals.slice(0, 20),
    stockCount: stocks.length,
    priceDays: prices?.dates?.length ?? 0,
    items,
    people: peopleIntel,
    searchLog,
  };
}

/** 落库（幂等：同链同日覆盖；v9.148.1 T1：signals 列落库） */
async function saveChainIntel(db, chainId, intel) {
  await ensureChainIntelTable(db);
  const dateStr = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const { items, people, signals, meta } = intel;
  await db.query(
    `INSERT INTO chain_intel(chain_id, intel_date, items, people, signals, meta)
     VALUES($1,$2,$3,$4,$5,$6)
     ON CONFLICT(chain_id, intel_date) DO UPDATE SET items=$3, people=$4, signals=$5, meta=$6, created_at=now()`,
    [chainId, dateStr, JSON.stringify(items), JSON.stringify(people), JSON.stringify(signals ?? []), JSON.stringify(meta)],
  );
  return dateStr;
}

/** 每晚全链扫描（cron 21:00）：逐链扫描落库，一条失败不阻塞其他
 * v9.148.1（T8 P1-6）：开头探测外网代理 —— 失败标记 webDegraded 进 meta（简报层注入降级提示） */
async function runNightlyScan(db = pool, { chains = Object.keys(require("./chainVariables").CHAIN_VARIABLES), withWeb = true } = {}) {
  await ensureChainIntelTable(db);
  // 代理探测（不阻塞扫描）
  let webDegraded = false;
  if (withWeb) {
    try {
      const { requestRaw } = require("./outbound");
      await requestRaw("https://news.google.com/rss/search?q=probe", { timeout: 8000, viaProxy: true });
    } catch {
      webDegraded = true;
      console.warn("[chainIntel] 外网代理探测失败 → webDegraded（简报将标注降级）");
    }
  }
  const results = [];
  for (const chainId of chains) {
    const t0 = Date.now();
    try {
      const intel = await scanChain(db, chainId, { withWeb });
      const dateStr = await saveChainIntel(db, chainId, { ...intel, meta: { durationMs: Date.now() - t0, at: new Date().toISOString(), webDegraded } });
      results.push({ chainId, ok: true, date: dateStr, items: intel.items.length, signals: intel.signals.length, webDegraded, people: intel.people.filter(p => p.items.length).map(p => p.name), ms: Date.now() - t0 });
    } catch (e) {
      results.push({ chainId, ok: false, error: e.message, ms: Date.now() - t0 });
    }
  }
  return results;
}

module.exports = { ensureChainIntelTable, classifyItems, scanChain, saveChainIntel, runNightlyScan, localSignals, CHAIN_SIGNAL_MAP };
