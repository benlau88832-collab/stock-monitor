// ============================================================
// v9.143.0 chain/context: stock -> industry chain context
// Shared chain KB now lives in src/shared/transmission-chain.js.
// v9.145.0（第二轮 P1-4）：加入 industry_chain_event 查询与手动推理触发。
// ============================================================
const { pool } = require("../db");
const { buildChainView } = require("../../src/shared/transmission-chain.js");
const { getChainDbContext } = require("../lib/chainDb");
const { runChainReasoning } = require("../lib/chainReasoning");
const { getChainSignals } = require("../lib/industryData");
// v9.148.0（任务04）：6 链 × 标的集合（概念校准产物，异动监控/简报复用）
const { getChainStocks, chainStockStats, CHAINS } = require("../lib/chainStocks");
// v9.148.0（任务05）：产业价格历史序列（30 天趋势，简报/前端走势图用）
const { getCommodityPriceHistory } = require("../lib/commodityPrice");
// v9.148.0（任务08）：链简报查询/生成
const { generateBriefing, generateAllBriefings } = require("../lib/chainBriefing");
// v9.148.2（A1）：POST /api/chain/* 的鉴权由 index.js 全局 /api 中间件统一负责（WRITE_AUTH_WHITELIST 之外
//   所有非 GET 强制 x-local-token）——此前 chain.js 内复制 checkAuth 属重复实现，已删除（真实 401 来自全局中间件）。

function bjDateStr() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

async function findBoardsForCode(code) {
  const candidates = [];
  const [conceptR, ztR] = await Promise.allSettled([
    pool.query(`SELECT concepts, all_boards, hybk, core_concept FROM stock_concepts WHERE code=$1`, [code]),
    pool.query(`SELECT data FROM zt_snapshot ORDER BY date DESC LIMIT 1`),
  ]);
  if (conceptR.status === "fulfilled" && conceptR.value.rows[0]) {
    const row = conceptR.value.rows[0];
    if (row.core_concept) candidates.push(String(row.core_concept));
    if (row.hybk) candidates.push(String(row.hybk));
    const boards = Array.isArray(row.all_boards) ? row.all_boards : [];
    for (const b of boards.slice(0, 6)) candidates.push(String(b));
    const concepts = Array.isArray(row.concepts) ? row.concepts : [];
    for (const c of concepts.slice(0, 6)) candidates.push(String(c));
  }
  if (ztR.status === "fulfilled" && ztR.value.rows[0]) {
    const raw = ztR.value.rows[0].data;
    const snap = typeof raw === "string" ? JSON.parse(raw) : raw;
    const poolArr = Array.isArray(snap) ? snap : snap?.pool ?? [];
    const hit = poolArr.find((p) => String(p.code ?? p.c ?? "") === code);
    if (hit?.hybk) candidates.push(String(hit.hybk));
    if (hit?.name) candidates.push(String(hit.name));
  }
  return [...new Set(candidates.filter(Boolean))];
}

async function findChainForBoards(candidates) {
  for (const b of candidates) {
    const chain = buildChainView(b);
    if (chain) return { chain, board: b };
  }
  return null;
}

async function enrichSignals(board) {
  const out = { fund: null, ztCount: null };
  try {
    const r = await pool.query(`SELECT value FROM kv_store WHERE key=$1`, [`fund_streak:${bjDateStr()}`]);
    const v = r.rows[0]?.value;
    const data = typeof v === "string" ? JSON.parse(v) : v;
    const items = Array.isArray(data?.items) ? data.items : [];
    const hit = items.find((x) => String(x.name ?? x.board ?? "") === board);
    if (hit) out.fund = { name: hit.name || board, mainNet: Number(hit.mainNet) || 0 };
  } catch { /* ignore */ }
  try {
    const r = await pool.query(`SELECT data FROM zt_snapshot ORDER BY date DESC LIMIT 1`);
    const raw = r.rows[0]?.data;
    const snap = typeof raw === "string" ? JSON.parse(raw) : raw;
    const arr = Array.isArray(snap) ? snap : snap?.pool ?? [];
    out.ztCount = arr.filter((p) => String(p.hybk ?? "") === board).length;
  } catch { /* ignore */ }
  return out;
}

async function loadEvents(chainId) {
  if (!chainId) return [];
  try {
    const r = await pool.query(
      `SELECT id, chain_id, title, summary, impact_path, impacted_nodes, confidence, published_at
       FROM industry_chain_event WHERE chain_id=$1 ORDER BY published_at DESC LIMIT 5`,
      [chainId],
    );
    return r.rows.map((row) => ({
      id: row.id,
      chainId: row.chain_id,
      title: row.title,
      summary: row.summary,
      impactPath: typeof row.impact_path === "string" ? JSON.parse(row.impact_path) : row.impact_path,
      impactedNodes: Array.isArray(row.impacted_nodes) ? row.impacted_nodes : (typeof row.impacted_nodes === "string" ? JSON.parse(row.impacted_nodes) : []),
      confidence: row.confidence,
      publishedAt: row.published_at,
    }));
  } catch { return []; }
}

module.exports = function chainRoutes(app) {
  app.get("/api/chain/context", async (req, res) => {
    const code = String(req.query.code || "").trim();
    const board = String(req.query.board || "").trim();
    try {
      if (code && !/^\d{6}$/.test(code)) return res.status(400).json({ error: "invalid code" });
      if (code) {
        const dbCtx = await getChainDbContext(pool, code);
        if (dbCtx.mapped) {
          const events = await loadEvents(dbCtx.chain.chainId);
          return res.json({ code, board: dbCtx.chain.boardName, boards: dbCtx.boards, chain: dbCtx.chain, signals: { fund: null, ztCount: null }, events, source: "db" });
        }
      }
      const candidates = code ? await findBoardsForCode(code) : (board ? [board] : []);
      if (candidates.length === 0) {
        return res.json({ code, board, chain: null, reason: "未收录，待补充" });
      }
      const found = await findChainForBoards(candidates);
      if (!found) {
        return res.json({ code, board, chain: null, boards: candidates.slice(0, 10), reason: "未收录，待补充" });
      }
      const signals = await enrichSignals(found.board);
      const events = await loadEvents(found.chain.chainId);
      res.json({ code, board: found.board, boards: candidates.slice(0, 10), chain: found.chain, signals, events });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/chain/reasoning/run", async (req, res) => {
    try {
      const chainId = String(req.body?.chainId || "").trim();
      if (!chainId) return res.status(400).json({ error: "chainId required" });
      const out = await runChainReasoning(pool, chainId);
      res.json(out);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/chain/signals", async (req, res) => {
    try {
      const chainId = String(req.query.chainId || "").trim();
      const days = Math.max(7, Math.min(365, Number(req.query.days) || 90));
      if (!chainId) return res.status(400).json({ error: "chainId required" });
      res.json({ ok: true, chainId, days, items: await getChainSignals(pool, chainId, days) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // v9.148.0（任务04）：6 链 × 标的集合查询（概念命中 + hybk + 种子兜底）
  // GET /api/chain/stocks?chain=semiconductor → { chain, name, count, stocks }
  // GET /api/chain/stocks → 6 链标的数统计（校准报告用）
  app.get("/api/chain/stocks", async (req, res) => {
    try {
      const chain = String(req.query.chain || "").trim();
      if (chain) {
        if (!CHAINS[chain]) return res.status(400).json({ error: `unknown chain: ${chain}` });
        const stocks = await getChainStocks(chain);
        res.json({ ok: true, chain, name: CHAINS[chain].name, count: stocks.length, stocks });
      } else {
        res.json({ ok: true, chains: await chainStockStats() });
      }
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // v9.148.0（任务05）：产业价格历史序列（30 天）
  // GET /api/chain/prices?days=30 → { dates, byDate, byName }
  app.get("/api/chain/prices", async (req, res) => {
    try {
      const days = Math.max(7, Math.min(120, Number(req.query.days) || 30));
      res.json({ ok: true, days, ...(await getCommodityPriceHistory(pool, { days })) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // v9.148.0（任务08）：链简报查询/生成
  // GET /api/chain/briefings?chain=semiconductor → 最新简报；GET /api/chain/briefings → 6 链最新
  // POST /api/chain/briefings/generate → 手动触发（body: {chainId?} 缺省全部）
  app.get("/api/chain/briefings", async (req, res) => {
    try {
      const chain = String(req.query.chain || "").trim();
      if (chain) {
        const r = await pool.query(
          `SELECT chain_id, briefing_date, content, model, created_at FROM chain_briefing WHERE chain_id=$1 ORDER BY briefing_date DESC LIMIT 7`,
          [chain],
        );
        res.json({ ok: true, chain, items: r.rows.map((x) => ({ date: x.briefing_date, content: x.content, model: x.model })) });
      } else {
        const r = await pool.query(
          `SELECT DISTINCT ON (chain_id) chain_id, briefing_date, content, model FROM chain_briefing ORDER BY chain_id, briefing_date DESC`,
        );
        res.json({ ok: true, items: r.rows.map((x) => ({ chain: x.chain_id, date: x.briefing_date, content: x.content, model: x.model })) });
      }
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/chain/briefings/generate", async (req, res) => {
    try {
      // v9.148.1（T2 P1-1）：烧钱操作强制 token（0.0.0.0 后防局域网白嫖 LLM 配额）

      const chainId = String(req.body?.chainId || "").trim();
      const out = chainId ? await generateBriefing(pool, chainId) : await generateAllBriefings(pool);
      res.json({ ok: true, out });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // v9.148.1（T7 P1-5）：人物自扩散 —— 建议池查询 / 采纳
  app.get("/api/chain/people/suggestions", async (req, res) => {
    try {
      const { getPeopleSuggestions } = require("../lib/chainVariables");
      res.json({ ok: true, items: await getPeopleSuggestions(pool) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/chain/people/confirm", async (req, res) => {
    try {

      const { confirmPeopleSuggestion } = require("../lib/chainVariables");
      const name = String(req.body?.name || "").trim();
      if (!name) return res.status(400).json({ error: "name required" });
      res.json(await confirmPeopleSuggestion(pool, name));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // v9.148.1（T8 P1-6）：推送配置状态（前端黄条引导用；不返回 key 明文）
  app.get("/api/chain/push-state", async (req, res) => {
    try {
      const { loadPushConfig } = require("./push");
      const cfg = await loadPushConfig(pool);
      const configured = !!(cfg && cfg.enabled);
      const channels = [];
      if (configured) {
        const ch = String(cfg.channel || "");
        if (ch) channels.push(...ch.split(",").map((s) => s.trim()).filter(Boolean));
        if (cfg.serverchanSctKey) channels.push("serverchan");
        if (cfg.wechatbotKey) channels.push("wechatbot");
        if (cfg.barkKey) channels.push("bark");
        if (cfg.feishuWebhook) channels.push("feishu");
        if (cfg.qmsgKey) channels.push("qmsg");
      }
      res.json({ ok: true, configured, channels: [...new Set(channels)] });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // v9.148.0（任务09）：简报页二维码（手机扫码直连）—— 内容=局域网 IP 的 #briefing URL
  // GET /api/chain/briefings/qr → image/png
  app.get("/api/chain/briefings/qr", async (req, res) => {
    try {
      const os = require("os");
      const port = process.env.PORT || 8080;
      const ifaces = os.networkInterfaces();
      let lan = null;
      for (const list of Object.values(ifaces)) {
        for (const it of list || []) {
          if (it.family === "IPv4" && !it.internal) { lan = it.address; break; }
        }
        if (lan) break;
      }
      const host = lan || "127.0.0.1";
      const url = `http://${host}:${port}/#briefing`;
      const QRCode = require("qrcode");
      const buf = await QRCode.toBuffer(url, { width: 280, margin: 1, errorCorrectionLevel: "M" });
      res.set("Content-Type", "image/png");
      res.set("Cache-Control", "no-store");
      res.send(buf);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
};
