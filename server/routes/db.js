// ============================================================
// /api/db/*  前端数据读写 PostgreSQL
// 约定：
//   GET  /api/db/kv?key=xxx         → { key, value } | { value: null }
//   PUT  /api/db/kv                 → body { key, value }  upsert
//   POST /api/db/kv/bulk            → body [{ key, value }] 批量 upsert（迁移用）
//   GET  /api/db/news?since=YYYY-MM-DD → 快讯列表
//   POST /api/db/news               → body [newsItem] upsert
//   GET  /api/db/anns?since=YYYY-MM-DD → 公告列表
//   POST /api/db/anns               → body [annItem] upsert
//   GET  /api/db/zt?date=YYYY-MM-DD → 涨停快照
//   POST /api/db/zt                 → body { date, data }
// ============================================================
const { pool } = require("../db");

module.exports = function dbRoutes(app) {

  // ---------- 通用 kv ----------
  // v9.85.0（P0-2）：敏感 key 脱敏 —— local_token / 推送凭据等禁止通过通用 KV 读取
  // （审查报告：GET /api/db/kv?key=local_token 可直读鉴权 token、push_settings_v1 可读全部推送 webhook/key）
  const SENSITIVE_KV_RE = /^(local_token|push_settings_v1|.*(api[_-]?key|token|webhook|secret).*)$/i;
  app.get("/api/db/kv", async (req, res) => {
    try {
      const key = String(req.query.key || "");
      if (!key) return res.status(400).json({ error: "key required" });
      if (SENSITIVE_KV_RE.test(key)) {
        return res.json({ key, sensitive: true, value: null });
      }
      const r = await pool.query("SELECT value FROM kv_store WHERE key=$1", [key]);
      res.json({ key, value: r.rows.length ? r.rows[0].value : null });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // v9.85.0（P0-2）：keys 列表同样过滤敏感 key 名
  app.get("/api/db/kv/keys", async (req, res) => {
    try {
      const r = await pool.query("SELECT key, updated_at FROM kv_store ORDER BY key");
      res.json({ keys: r.rows.map(x => x.key).filter(k => !SENSITIVE_KV_RE.test(k)) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // v9.26.6：批量拉取多个 key（limit 防止过大响应；前端分批）
  // v9.100.0（P1-02，安全）：bulk 复用 SENSITIVE_KV_RE —— 原 GET 旁路可直读 local_token/push_settings_v1
  //   （GET 不经过写鉴权中间件 + CORS 放行任意 localhost 端口；单测覆盖）
  app.get("/api/db/kv/bulk", async (req, res) => {
    try {
      const keysRaw = String(req.query.keys || "");
      const keys = keysRaw.split(",").map(s => s.trim()).filter(Boolean).filter(k => !SENSITIVE_KV_RE.test(k));
      if (keys.length === 0) return res.json({ items: [] });
      const r = await pool.query("SELECT key, value FROM kv_store WHERE key = ANY($1::text[])", [keys]);
      res.json({ items: r.rows.map(x => ({ key: x.key, value: x.value })) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // v9.96.0（批次 1）：kv 前缀查询（历史报告列表等）—— prefix 按 key 前缀倒序取最新 N 条
  // v9.100.0（P1-02，安全）：结果同样过滤敏感 key（防 prefix 旁路，如 prefix=local_）
  app.get("/api/db/kv-prefix", async (req, res) => {
    try {
      const prefix = String(req.query.prefix || "");
      const limit = Math.max(1, Math.min(Number(req.query.limit) || 20, 100));
      if (!prefix) return res.status(400).json({ error: "prefix required" });
      const r = await pool.query(
        "SELECT key, value FROM kv_store WHERE key LIKE $1 ORDER BY key DESC LIMIT $2",
        [prefix + "%", limit],
      );
      res.json({ items: r.rows.map(x => ({ key: x.key, value: x.value })).filter(x => !SENSITIVE_KV_RE.test(x.key)) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put("/api/db/kv", async (req, res) => {
    try {
      const { key, value } = req.body || {};
      if (!key) return res.status(400).json({ error: "key required" });
      const v = typeof value === "string" ? { __raw: value } : (value ?? null);
      await pool.query(
        `INSERT INTO kv_store(key, value, updated_at) VALUES($1,$2,now())
         ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
        [key, JSON.stringify(v)],
      );
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/db/kv/bulk", async (req, res) => {
    try {
      // v9.64（V1 安全）：数组长度校验 ≤100 —— 防一次 10MB JSON 打满 PG（配合 index.js json limit 1mb）
      const items = Array.isArray(req.body) ? req.body.slice(0, 100) : [];
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const { key, value } of items) {
          if (!key) continue;
          const v = typeof value === "string" ? { __raw: value } : (value ?? null);
          await client.query(
            `INSERT INTO kv_store(key, value, updated_at) VALUES($1,$2,now())
             ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
            [key, JSON.stringify(v)],
          );
        }
        await client.query("COMMIT");
      } catch (e) { await client.query("ROLLBACK"); throw e; }
      finally { client.release(); }
      res.json({ ok: true, count: items.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ---------- 快讯 ----------
  app.get("/api/db/news", async (req, res) => {
    try {
      const since = String(req.query.since || "");
      const limit = Math.max(1, Math.min(Number(req.query.limit) || 200, 1000));
      const q = since
        ? "SELECT * FROM news WHERE time >= $1 ORDER BY time DESC LIMIT $2"
        : "SELECT * FROM news ORDER BY time DESC LIMIT $1";
      const r = since ? await pool.query(q, [since, limit]) : await pool.query(q, [limit]);
      res.json(r.rows.map(row => ({
        code: row.code, title: row.title, summary: row.summary,
        boards: row.boards ?? [], sentiment: row.sentiment,
        stars: row.stars, isOverseas: row.is_overseas, time: row.time, url: row.url,
      })));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // v9.104.0（第四批 C，T-C2）：新闻×主线×标的联动聚合 —— 标题命中概念白名单词根（主线）
  //   + 标题命中今日涨停池股票名（标的），新闻卡显示"影响主线/标的"标记（盘中 LLM 闭环的数据底座）
  app.get("/api/db/news-links", async (req, res) => {
    try {
      const limit = Math.max(1, Math.min(Number(req.query.limit) || 20, 50));
      const newsR = await pool.query("SELECT code, title, time FROM news ORDER BY time DESC LIMIT $1", [limit]);
      // 今日涨停池（zt_snapshot 最新一日）→ 股票名 + hybk 板块
      const ztR = await pool.query("SELECT date, data FROM zt_snapshot ORDER BY date DESC LIMIT 1");
      let poolArr = [];
      try {
        const ztData = ztR.rows[0]?.data;
        poolArr = Array.isArray(ztData) ? ztData : (ztData && typeof ztData === "object" && "pool" in ztData ? ztData.pool : []);
      } catch { poolArr = []; }
      const stockNames = new Set(poolArr.map(p => String(p.n ?? "")).filter(Boolean));
      // 概念白名单词根（shared ESM，require(ESM) Node 22+）
      const { CONCEPT_GROUPS } = require("../../src/shared/concept-groups.js");
      const roots = CONCEPT_GROUPS.flatMap(g => (g.roots ?? []).filter(r => String(r).length >= 2));
      const items = newsR.rows.map(n => {
        const title = String(n.title ?? "");
        const mainlines = roots.filter(r => title.includes(r)).slice(0, 3);
        const stocks = [...stockNames].filter(sn => sn && title.includes(sn)).slice(0, 3);
        return { code: n.code, title: title.slice(0, 80), time: n.time, mainlines, stocks };
      }).filter(x => x.mainlines.length > 0 || x.stocks.length > 0);
      res.json({ items, ztDate: ztR.rows[0]?.date ?? null });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ---------- v9.105.0（第五批 E）政策引擎端点 ----------
  // T-E2 首写候选（规则层 diff + LLM 裁决）：GET /api/policy/first-write
  // T-E3 政策关键词映射：GET /api/policy/map?kw=
  // T-E4 政策解读报告（LLM+降级）：POST /api/policy/interpret?docId=
  // T-E5 政策日历 + 联动统计：GET /api/policy/calendar
  const { findFirstWriteTerms, matchPolicyToBoards, POLICY_CALENDAR, policyImpactStats } = require("../lib/policyAnalysis");

  app.get("/api/policy/first-write", async (req, res) => {
    try {
      const r = await pool.query("SELECT id,title,content,doc_date FROM policy_docs ORDER BY doc_date");
      if (r.rows.length < 2) return res.json({ items: [], note: "语料不足（需 ≥2 篇）" });
      const newDoc = r.rows[r.rows.length - 1]; // 最新政策
      const hist = r.rows.slice(0, -1).map(d => d.content);
      const candidates = findFirstWriteTerms(hist, newDoc.content).slice(0, 40); // v9.105.0：放宽（低空经济/具身智能 实证低频在 20 名外）
      // LLM 裁决（policyFirstWrite，失败降级规则层——P1-06 教训）
      let verdicts = null;
      try {
        const { callModelText } = require("../lib/httpProxy");
        const text = await callModelText(
          `【政策文档】${newDoc.title}\n【候选术语】\n${candidates.map(c => c.term + "（" + c.freq + "次）").join("\n")}`,
          { system: "你是政策研究专家。从候选术语中裁决哪些是真正的首次写入/表述升级概念。只输出JSON数组：[{\"concept\":\"概念名\",\"firstWrite\":\"true|false\",\"upgrade\":\"无|表述升级|定位变化\",\"benefit\":\"受益行业/板块\"}]，最多8条。", maxTokens: 2000, temperature: 0.2 },
        );
        const m = text.match(/\[[\s\S]*\]/);
        if (m) verdicts = JSON.parse(m[0]);
      } catch { verdicts = null; }
      res.json({ doc: newDoc.title, docDate: newDoc.doc_date, candidates: candidates.slice(0, 40), llmVerdicts: Array.isArray(verdicts) ? verdicts : null, degraded: !Array.isArray(verdicts) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/policy/map", async (req, res) => {
    try {
      const kw = String(req.query.kw || "").trim();
      if (!kw) return res.status(400).json({ error: "kw required" });
      const { CONCEPT_GROUPS } = require("../../src/shared/concept-groups.js");
      const boards = matchPolicyToBoards(kw, CONCEPT_GROUPS);
      // 龙头：stock_concepts 匹配板块（hybk/core_concept）取最近抓取的标的
      let stocks = [];
      try {
        const sr = await pool.query(
          "SELECT code, hybk, core_concept FROM stock_concepts WHERE hybk ILIKE $1 OR core_concept ILIKE $1 LIMIT 20",
          [`%${kw}%`],
        );
        stocks = sr.rows.slice(0, 8).map(x => ({ code: x.code, hybk: x.hybk, core: x.core_concept }));
      } catch { stocks = []; }
      res.json({ kw, boards, stocks, note: boards.length === 0 && stocks.length === 0 ? "未命中（概念白名单 504 与股票概念库均无匹配）" : undefined });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/policy/interpret", async (req, res) => {
    try {
      const docId = Number(req.query.docId || req.body?.docId || 0);
      if (!docId) return res.status(400).json({ error: "docId required" });
      const r = await pool.query("SELECT id,title,content,doc_date FROM policy_docs WHERE id=$1", [docId]);
      const doc = r.rows[0];
      if (!doc) return res.status(404).json({ error: "doc not found" });
      let report = null, degraded = false;
      try {
        const { callModelText } = require("../lib/httpProxy");
        report = await callModelText(
          `【政策】${doc.title}\n${doc.content.slice(0, 5000)}`,
          { system: "你是券商级政策分析师。基于政策全文生成解读报告（Markdown，≤600字）：\n【核心要点】≤3 条\n【受益链】上中下游传导（引用原文概念，不编造）\n【历史对照】同领域历年表述变化\n【催化规律】首写概念后板块历史表现（样本不足明说）\n【参与建议】中性合规表述，不承诺收益", maxTokens: 3000, temperature: 0.3 },
        );
      } catch { degraded = true; report = `⚡ 解读降级（规则版，LLM 不可用）：\n${doc.content.slice(0, 300)}`; }
      const now = new Date(Date.now() + 8 * 3600 * 1000);
      const dateStr = now.toISOString().slice(0, 10);
      const val = { docId, title: doc.title, date: dateStr, report, degraded, ts: Date.now() };
      await pool.query(
        `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now())
         ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
        [`report:policy:${dateStr}`, JSON.stringify(val)],
      );
      res.json({ ok: true, degraded, report });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/policy/calendar", async (req, res) => {
    try {
      // 联动统计：政策日后 3/5 日涨停家数变化（zt_snapshot 聚合）
      const ztR = await pool.query("SELECT date, jsonb_array_length(data->'pool') AS pool_count FROM zt_snapshot ORDER BY date");
      const ztRows = ztR.rows.map(x => ({ date: x.date, pool_count: Number(x.pool_count ?? 0) }));
      const items = POLICY_CALENDAR.map(c => ({ ...c, impact: policyImpactStats(ztRows, c.date) }));
      res.json({ items });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // v9.106.0（第六批 B，T-B4）：主线级回测 —— zt_snapshot 多日板块涨停序列聚合 → 同主线历史胜率表
  app.get("/api/backtest/mainline", async (req, res) => {
    try {
      const ztR = await pool.query("SELECT date, data FROM zt_snapshot ORDER BY date");
      const rows = ztR.rows.map(r => {
        const d = r.data;
        const poolArr = Array.isArray(d) ? d : (d && typeof d === "object" && "pool" in d ? d.pool : []);
        const byBoard = new Map();
        for (const p of poolArr) {
          const b = String(p.hybk || "未分类");
          byBoard.set(b, (byBoard.get(b) ?? 0) + 1);
        }
        return { date: r.date, boards: [...byBoard.entries()].map(([hybk, count]) => ({ hybk, count })) };
      });
      const { runMainlineBacktest } = require("../lib/mainlineBacktest");
      const items = runMainlineBacktest(rows);
      res.json({ days: rows.length, items });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/db/news", async (req, res) => {
    try {
      const items = Array.isArray(req.body) ? req.body : [];
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const n of items) {          if (!n.code) continue;
          await client.query(
            `INSERT INTO news(code,title,summary,boards,sentiment,stars,is_overseas,time,url)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT(code) DO UPDATE SET title=$2,summary=$3,boards=$4,sentiment=$5,stars=$6,is_overseas=$7,time=$8,url=$9`,
            [n.code, n.title, n.summary ?? "", JSON.stringify(n.boards ?? []), n.sentiment ?? "neutral", n.stars ?? 1, !!n.isOverseas, n.time ?? "", n.url ?? ""],
          );
        }
        await client.query("COMMIT");
      } catch (e) { await client.query("ROLLBACK"); throw e; }
      finally { client.release(); }
      res.json({ ok: true, count: items.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ---------- 公告 ----------
  app.get("/api/db/anns", async (req, res) => {
    try {
      const since = String(req.query.since || "");
      const limit = Math.max(1, Math.min(Number(req.query.limit) || 200, 1000));
      const q = since
        ? "SELECT * FROM announcements WHERE time >= $1 ORDER BY time DESC LIMIT $2"
        : "SELECT * FROM announcements ORDER BY time DESC LIMIT $1";
      const r = since ? await pool.query(q, [since, limit]) : await pool.query(q, [limit]);
      res.json(r.rows.map(row => ({
        artCode: row.art_code, stockCode: row.stock_code, stockName: row.stock_name,
        title: row.title, columnName: row.column_name, boards: row.boards ?? [],
        score: row.score, logic: row.logic, time: row.time, url: row.url,
      })));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ---------- v13-4（P0）：新闻驱动作战管线手动触发 ----------
  // 前端"🔄 立即分析"按钮 → 立即跑一轮管线（不等 30 分钟 cron），复用 cron.runThemeAnalysis
  // v9.81（性能）：异步化 —— 原同步等待整个管线（2 次 LLM 各最长 40s → 前端按钮挂 80-120s）；
  // 现 202 立即返回，后台执行，前端轮询 kv theme_analysis:latest（key 变化即新结果）
  app.post("/api/theme-analysis/trigger", async (req, res) => {
    try {
      const cronMod = require("../cron");
      const { runThemeAnalysis } = cronMod;
      // v9.85.0（P1-4）：并发锁 —— 原手动触发绕过 themeRunning，重复点击可并发叠加多轮 LLM 管线（每轮 2 次 LLM 最长 30 分钟+）
      // v9.89.0（P2-4）：升级为 PG advisory lock（与 cron 的 3 个 themeAnalysis 点跨进程共用 LOCK_THEME）
      const { acquireLock, releaseLock, LOCK_THEME } = require("../lib/pgLock");
      const lockClient = await acquireLock(pool, LOCK_THEME);
      if (!lockClient) {
        return res.status(409).json({ error: "theme analysis already running", running: true });
      }
      res.json({ ok: true, started: true });
      runThemeAnalysis({ pool, label: "手动" })
        .catch(e => console.error("[api] theme-analysis 后台执行失败:", e.message))
        .finally(() => releaseLock(lockClient, LOCK_THEME));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // v9.94.0（第四段）：盘后复盘手动触发 —— 前端"📝 立即复盘"按钮 / 验收脚本
  app.post("/api/review/trigger", async (req, res) => {
    try {
      const cronMod = require("../cron");
      const { generateDailyReview } = cronMod;
      const { acquireLock, releaseLock, LOCK_REVIEW } = require("../lib/pgLock");
      const lockClient = await acquireLock(pool, LOCK_REVIEW);
      if (!lockClient) {
        return res.status(409).json({ error: "review already running", running: true });
      }
      res.json({ ok: true, started: true });
      generateDailyReview({ pool })
        .catch(e => console.error("[api] review 后台执行失败:", e.message))
        .finally(() => releaseLock(lockClient, LOCK_REVIEW));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // v9.98.0（批次 3）：基本面体检（investool：阈值表 + 银行专项 + desc/ok + 合理价；表缓存 24h）
  app.get("/api/db/fundamental/:code", async (req, res) => {
    try {
      const code = String(req.params.code || "").trim();
      if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: "invalid code" });
      const { getFundamentalCheck } = require("../lib/fundamentalChecker");
      const out = await getFundamentalCheck(pool, code);
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // v9.96.0（批次 1）：市场情绪叙事报告触发（VibeAlpha）—— 仿 review/trigger：advisory lock + 后台执行 + kv 落库
  app.post("/api/emotion/analyze", async (req, res) => {
    try {
      const { generateEmotionReport } = require("../lib/emotionAnalysis");
      const { acquireLock, releaseLock, LOCK_REVIEW } = require("../lib/pgLock");
      const lockClient = await acquireLock(pool, LOCK_REVIEW);
      if (!lockClient) {
        return res.status(409).json({ error: "emotion analysis already running", running: true });
      }
      res.json({ ok: true, started: true });
      generateEmotionReport(pool, new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10))
        .catch(e => console.error("[api] emotion 报告后台执行失败:", e.message))
        .finally(() => releaseLock(lockClient, LOCK_REVIEW));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/db/anns", async (req, res) => {
    try {
      const items = Array.isArray(req.body) ? req.body : [];
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const a of items) {
          if (!a.artCode) continue;
          await client.query(
            `INSERT INTO announcements(art_code,stock_code,stock_name,title,column_name,boards,score,logic,time,url)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             ON CONFLICT(art_code) DO UPDATE SET stock_code=$2,stock_name=$3,title=$4,column_name=$5,boards=$6,score=$7,logic=$8,time=$9,url=$10`,
            [a.artCode, a.stockCode ?? "", a.stockName ?? "", a.title ?? "", a.columnName ?? "",
             JSON.stringify(a.boards ?? []), a.score ?? null, a.logic ?? null, a.time ?? "", a.url ?? ""],
          );
        }
        await client.query("COMMIT");
      } catch (e) { await client.query("ROLLBACK"); throw e; }
      finally { client.release(); }
      res.json({ ok: true, count: items.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ---------- 涨停快照 ----------
  app.get("/api/db/zt", async (req, res) => {
    try {
      const date = String(req.query.date || "");
      const r = date
        ? await pool.query("SELECT date,data FROM zt_snapshot WHERE date=$1", [date])
        : await pool.query("SELECT date,data FROM zt_snapshot ORDER BY date DESC LIMIT 30");
      res.json(r.rows.map(x => ({ date: x.date, data: x.data })));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // v9.84（分类统一）：个股概念查询 —— 查 PG stock_concepts，未命中实时抓东财并落库
  app.get("/api/db/concepts", async (req, res) => {
    try {
      const codes = String(req.query.codes || "").split(",").filter(Boolean);
      // v9.91.0（概念地基）：hybk 可选参数（code:hybk,code:hybk）—— 涨停池自带的东财行业
      // 随概念一起落库，补全 stock_concepts.hybk（此前 INSERT 漏写该字段 → 单股全景行业为空）
      const hybkMap = new Map();
      const hybkRaw = String(req.query.hybk || "");
      for (const pair of hybkRaw.split(",")) {
        const [c, h] = pair.split(":");
        if (c && h) hybkMap.set(c.trim(), h.trim());
      }
      const { getConcepts } = require("../lib/stockConcepts");
      const out = await getConcepts(pool, codes, hybkMap);
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // v9.91.0（概念地基）：同花顺概念白名单 —— 前端 isThemeBoard 白名单化判定的数据源
  // 懒加载：表空或 >24h 自动重抓（服务端离线时前端回退旧兜底逻辑，渐进降级）
  app.get("/api/concepts/whitelist", async (req, res) => {
    try {
      const { ensureConceptWhitelist, getConceptWhitelist } = require("../lib/thsConcepts");
      const refresh = await ensureConceptWhitelist(pool);
      const concepts = await getConceptWhitelist(pool);
      res.json({ concepts, refreshed: refresh.refreshed, count: concepts.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // v9.84（分类统一）：单股全景端点 —— 一次聚合 概念/新闻/公告/调研/盯价/席位/涨停历史。
  // 前端个股详情页（AIConsole 上下文 / 个股雷达）一请求拿全，不再 N 个串行小接口。
  app.get("/api/db/stock/:code", async (req, res) => {
    try {
      const code = String(req.params.code || "").trim();
      if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: "invalid code" });
      const { getConcepts } = require("../lib/stockConcepts");
      // v9.85.0（P1-15）：北京时间日期（原 UTC 日期在凌晨 8 点前与北京日期错一天，seats 查询窗口偏移）
      const bjNow = new Date(Date.now() + 8 * 3600 * 1000);
      const todayStr = bjNow.toISOString().slice(0, 10);
      const daysAgo = new Date(bjNow.getTime() - 45 * 24 * 3600 * 1000).toISOString().slice(0, 10);

      // 各块并行且互不阻塞（某一源挂不影响其余）
      // v9.108.1（T-6c P2-5）：移除冗余死桩 —— 快讯已由 v9.97.0-fix 的 nameLike 真实匹配（:469-473）提供，
      //   原 newsR 占位（恒空桩）结果从未使用（返回组装用 newsRowsR，见 :524）
      const [conceptsR, nameR, annsR, reportsR, watchR, watchLogR, seatsR, ztR, policyR, indicatorsR] = await Promise.allSettled([
        getConcepts(pool, [code]),
        // v9.97.0-fix：news 表 code 是东财文章 ID 而非股票代码 → 快讯按"股票名/代码"标题匹配（zt_snapshot 取名称）
        (async () => {
          const r = await pool.query(`SELECT data FROM zt_snapshot ORDER BY date DESC LIMIT 1`);
          const snap = r.rows[0]?.data;
          const poolArr = Array.isArray(snap) ? snap : snap?.pool;
          const hit = (Array.isArray(poolArr) ? poolArr : []).find(p2 => String(p2?.c ?? p2?.code ?? "") === code);
          return hit?.name ?? hit?.n ?? null;
        })(),
        pool.query("SELECT art_code,stock_name,title,column_name,score,time,url FROM announcements WHERE stock_code=$1 ORDER BY time DESC LIMIT 20", [code]),
        pool.query("SELECT report_date,phase,summary_json,valuation_json,levels_json,full_text,created_at FROM research_reports WHERE code=$1 ORDER BY report_date DESC LIMIT 5", [code]),
        pool.query("SELECT code,name,buy_low,buy_high,stop_loss,trigger_pct,note,updated_at FROM price_watch WHERE code=$1 AND status='active'", [code]),
        pool.query("SELECT date,price,mid_price,deviation_pct,triggered,event_text FROM price_watch_log WHERE code=$1 ORDER BY date DESC LIMIT 30", [code]),
        pool.query("SELECT key,value FROM kv_store WHERE key LIKE 'seats:%' AND key >= $1 ORDER BY key DESC LIMIT 45", [daysAgo]),
        pool.query("SELECT date,data FROM zt_snapshot ORDER BY date DESC LIMIT 30"),
        // v9.95.3（第五段 P1）：个股聚合器补维度 —— 政策快讯（近3日泛市场政策）+ 舆情统计（news sentiment 聚合）
        pool.query(`SELECT title,time FROM news
          WHERE (title ILIKE '%国务院%' OR title ILIKE '%央行%' OR title ILIKE '%证监会%' OR title ILIKE '%发改委%' OR title ILIKE '%财政部%' OR title ILIKE '%国常会%' OR title ILIKE '%降准%' OR title ILIKE '%降息%' OR title ILIKE '%资本市场%')
          AND time >= $1 ORDER BY time DESC LIMIT 5`, [new Date(Date.now() + 8 * 3600 * 1000 - 3 * 24 * 3600 * 1000).toISOString().slice(0, 10)]),
        // v9.97.0（批次 2）：技术指标快照 + 日K（服务端腾讯 fqkline）+ 舆情窗口统计（词典打分 7/30 日）
        (async () => {
          const { computeIndicatorsFor } = require("../lib/indicators");
          return await computeIndicatorsFor(code);
        })(),
      ]);

      // v9.97.0-fix：股票名（zt_snapshot）→ 快讯按名称匹配（news.code 是文章 ID 非股票代码）
      const stockName = nameR.status === "fulfilled" ? nameR.value : null;
      const nameLike = stockName ? `%${stockName}%` : null;
      const newsRowsR = nameLike
        ? await pool.query(
            `SELECT title,summary,boards,sentiment,stars,time,url FROM news
             WHERE title ILIKE $1 OR summary ILIKE $1 ORDER BY time DESC LIMIT 30`, [nameLike]).catch(() => ({ rows: [] }))
        : { rows: [] };
      const sentRowsR = nameLike
        ? await pool.query(
            `SELECT sentiment, count(*)::int AS cnt FROM news WHERE (title ILIKE $1 OR summary ILIKE $1) AND sentiment IS NOT NULL GROUP BY sentiment`, [nameLike]).catch(() => ({ rows: [] }))
        : { rows: [] };
      const newsAllRowsR = nameLike
        ? await pool.query(
            `SELECT title,time FROM news WHERE title ILIKE $1 OR summary ILIKE $1 ORDER BY time DESC LIMIT 200`, [nameLike]).catch(() => ({ rows: [] }))
        : { rows: [] };

      // 概念
      const concepts = conceptsR.status === "fulfilled" && conceptsR.value[code]
        ? conceptsR.value[code] : null;

      // 席位（kv seats:YYYY-MM-DD → SeatRecord[]，兼容 {__raw} 字符串形态）
      const seats = [];
      if (seatsR.status === "fulfilled") {
        for (const row of seatsR.value.rows) {
          const v = row.value;
          const list = Array.isArray(v) ? v
            : (v && typeof v === "object" && "__raw" in v) ? safeParse(v.__raw) : [];
          if (!Array.isArray(list)) continue;
          const date = String(row.key).replace("seats:", "");
          for (const r of list) {
            if (r && String(r.stockCode ?? "") === code) {
              seats.push({ date, deptName: r.deptName, direction: r.direction, net: r.net,
                pctT1: r.pctT1 ?? null, pctT5: r.pctT5 ?? null });
            }
          }
        }
      }

      // 涨停历史（zt_snapshot data.pool → c === code）
      const ztHistory = [];
      if (ztR.status === "fulfilled") {
        for (const row of ztR.value.rows) {
          const poolArr = Array.isArray(row.data) ? row.data : row.data?.pool;
          if (!Array.isArray(poolArr)) continue;
          for (const p of poolArr) {
            // fetchZTPool 落库形态用 code，前端 limitPool 用 c —— 兼容两种
            if (String(p?.c ?? p?.code ?? "") === code) {
              ztHistory.push({ date: row.date, name: p.n ?? p.name, lbc: p.lbc ?? 1, hybk: p.hybk ?? "" });
              break;
            }
          }
        }
      }

      res.json({
        code,
        concepts,                                     // { themes, allBoards, hybk } | null
        news: newsRowsR.rows,
        announcements: annsR.status === "fulfilled" ? annsR.value.rows : [],
        reports: reportsR.status === "fulfilled" ? reportsR.value.rows : [],
        watch: watchR.status === "fulfilled" ? watchR.value.rows : [],
        watchLog: watchLogR.status === "fulfilled" ? watchLogR.value.rows : [],
        seats,                                        // 近 45 天席位净买/卖记录
        ztHistory,                                    // 近 30 个交易日涨停记录
        // v9.95.3（第五段 P1）：政策维度（近3日泛市场政策快讯）+ 舆情统计（news sentiment 聚合）
        policy: policyR.status === "fulfilled" ? policyR.value.rows : [],
        sentimentSummary: { bullish: 0, bearish: 0, neutral: 0, ...Object.fromEntries(sentRowsR.rows.map(r => [r.sentiment, r.cnt])) },
        // v9.97.0（批次 2）：技术指标快照 + 日K（K线卡用）+ 舆情词典窗口统计（7/30 日）
        indicators: indicatorsR.status === "fulfilled" ? indicatorsR.value : { signals: [], snapshot: null, error: "指标计算失败" },
        kline: indicatorsR.status === "fulfilled" ? indicatorsR.value.klines : [],
        sentimentWindows: (() => {
          const { sentimentWindowStats } = require("../lib/keywordSentiment");
          return { window7: sentimentWindowStats(newsAllRowsR.rows, 7), window30: sentimentWindowStats(newsAllRowsR.rows, 30) };
        })(),
        asOf: todayStr,
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

  // ============== v9.84.2（AI大脑层）：大脑快照 + PG 查询工具 ==============
  // /api/brain/context —— AIConsole 与决策 Agent 共享注入的全站快照（一次打包）
  app.get("/api/brain/context", async (req, res) => {
    try {
      const { buildBrainContext } = require("../lib/brainContext");
      const date = String(req.query.date || "");
      const ctx = await buildBrainContext(pool, date || undefined);
      res.json(ctx);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // /api/brain/pg —— Agent PG 查询工具组（阶段3.2）
  // 工具名白名单，入参仅透传原语，杜绝任意 SQL
  const PG_TOOLS = new Set([
    "newsByKeyword", "annsByStock", "ztHistory", "seatsByStock", "researchByStock", "marketDaily",
  ]);
  app.post("/api/brain/pg", async (req, res) => {
    try {
      const tool = String(req.body?.tool || "");
      const args = (req.body?.args && typeof req.body.args === "object") ? req.body.args : {};
      if (!PG_TOOLS.has(tool)) return res.status(403).json({ error: "tool not allowed: " + tool });
      const limit = Math.max(1, Math.min(Number(args.limit) || 20, 100));
      const keyword = String(args.keyword || "").slice(0, 60);

      switch (tool) {
        case "newsByKeyword": {
          // 快讯按关键词/板块检索（标题或摘要匹配）
          if (!keyword) return res.json({ items: [] });
          const r = await pool.query(
            `SELECT code,title,summary,boards,sentiment,stars,time,url FROM news
             WHERE title ILIKE '%'||$1||'%' OR summary ILIKE '%'||$1||'%' OR boards::text ILIKE '%'||$1||'%'
             ORDER BY time DESC LIMIT $2`, [keyword, limit]);
          return res.json({ items: r.rows });
        }
        case "annsByStock": {
          const code = String(args.code || "").replace(/[^0-9]/g, "");
          if (code.length !== 6) return res.json({ items: [] });
          const r = await pool.query(
            `SELECT art_code,stock_code,stock_name,title,column_name,score,time,url FROM announcements
             WHERE stock_code=$1 ORDER BY time DESC LIMIT $2`, [code, limit]);
          return res.json({ items: r.rows });
        }
        case "ztHistory": {
          // 历史涨停快照检索：按日期区间（近N日）或个股代码
          const code = String(args.code || "").replace(/[^0-9]/g, "");
          const days = Math.max(1, Math.min(Number(args.days) || 10, 60));
          const r = await pool.query(
            "SELECT date,data FROM zt_snapshot ORDER BY date DESC LIMIT $1", [days]);
          const out = [];
          for (const row of r.rows) {
            const poolArr = Array.isArray(row.data) ? row.data : row.data?.pool;
            if (!Array.isArray(poolArr)) continue;
            const rows = code
              ? poolArr.filter(p => String(p?.c ?? p?.code ?? "") === code)
              : poolArr;
            for (const p of rows.slice(0, 50)) {
              out.push({ date: row.date, code: p?.c ?? p?.code, name: p?.n ?? p?.name, lbc: p?.lbc ?? 1, hybk: p?.hybk ?? "" });
            }
            if (out.length >= 200) break;
          }
          return res.json({ items: out });
        }
        case "seatsByStock": {
          const code = String(args.code || "").replace(/[^0-9]/g, "");
          if (code.length !== 6) return res.json({ items: [] });
          const days = Math.max(1, Math.min(Number(args.days) || 30, 90));
          // v9.85.0（P1-15）：北京时间日期（seats key 为北京日期，UTC 计算会错一天）
          const from = new Date(Date.now() + 8 * 3600 * 1000 - days * 24 * 3600 * 1000).toISOString().slice(0, 10);
          const r = await pool.query(
            "SELECT key,value FROM kv_store WHERE key LIKE 'seats:%' AND key >= $1 ORDER BY key DESC", [from]);
          const items = [];
          for (const row of r.rows) {
            const v = row.value;
            const list = Array.isArray(v) ? v
              : (v && typeof v === "object" && "__raw" in v) ? safeParse(v.__raw) : [];
            if (!Array.isArray(list)) continue;
            const date = String(row.key).replace("seats:", "");
            for (const s of list) {
              if (s && String(s.stockCode ?? "") === code) {
                items.push({ date, deptName: s.deptName, direction: s.direction, net: s.net, pctT1: s.pctT1 ?? null, pctT5: s.pctT5 ?? null });
              }
            }
          }
          return res.json({ items: items.slice(0, limit) });
        }
        case "researchByStock": {
          const code = String(args.code || "").replace(/[^0-9]/g, "");
          if (code.length !== 6) return res.json({ items: [] });
          const r = await pool.query(
            `SELECT code,name,report_date,phase,summary_json,valuation_json,levels_json,full_text,created_at
             FROM research_reports WHERE code=$1 ORDER BY report_date DESC LIMIT $2`, [code, limit]);
          return res.json({ items: r.rows });
        }
        case "marketDaily": {
          // 市场日指标序列（涨停/炸板/溢价/最高板/情绪，信号回测与次日闸门用）
          const r = await pool.query(
            `SELECT key,value FROM kv_store
             WHERE (key LIKE 'market_daily:%' OR key LIKE 'sentiment:%')
               AND key ~ '^[a-z_]+:[0-9]{4}-[0-9]{2}-[0-9]{2}$'
             ORDER BY key DESC LIMIT $1`, [limit * 2]);
          const out = [];
          for (const row of r.rows) {
            const [kind, date] = String(row.key).split(":");
            const v = row.value && typeof row.value === "object" && "__raw" in row.value ? safeParse(row.value.__raw) : row.value;
            if (kind === "sentiment") out.push({ date, sentiment: typeof v === "number" ? v : v?.sentiment ?? null });
            else if (v && typeof v === "object") out.push({ date, ...v });
          }
          // 按日期归并（sentiment 与 market_daily 同日合并一行）
          const byDate = new Map();
          for (const item of out) {
            const row2 = byDate.get(item.date) ?? {};
            Object.assign(row2, item);
            byDate.set(item.date, row2);
          }
          const merged = [...byDate.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)));
          return res.json({ items: merged.slice(0, limit) });
        }
        default:
          return res.status(400).json({ error: "unhandled tool" });
      }
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/db/zt", async (req, res) => {
    try {
      const { date, data } = req.body || {};
      if (!date) return res.status(400).json({ error: "date required" });
      await pool.query(
        `INSERT INTO zt_snapshot(date,data) VALUES($1,$2)
         ON CONFLICT(date) DO UPDATE SET data=$2, created_at=now()`,
        [date, JSON.stringify(data ?? {})],
      );
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ---------- P0-1：人类拍板台账 ----------
  app.post("/api/db/decision_post", async (req, res) => {
    const p = req.body || {};
    if (!p.ticketId || !p.humanAction) return res.status(400).json({ error: "ticketId & humanAction required" });
    try {
      await pool.query(
        `INSERT INTO decision_post(date,ticket_id,mainline,code,human_action,confidence_at_post,price_at_post,executed,pnl,notes,decision_log_ref,ts)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
         ON CONFLICT (ticket_id) DO NOTHING`,
        [
          p.date, p.ticketId, p.mainline ?? null, p.code ?? null, p.humanAction,
          p.confidenceAtPost ?? null, p.priceAtPost ?? null, Boolean(p.executed), p.pnl ?? null,
          p.notes ?? "", p.decisionLogRef ?? null,
        ],
      );
      res.json({ ok: true, ticketId: p.ticketId });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/db/decision_post/:date?", async (req, res) => {
    try {
      const date = req.params.date;
      const r = date
        ? await pool.query("SELECT * FROM decision_post WHERE date=$1 ORDER BY ts DESC", [date])
        : await pool.query("SELECT * FROM decision_post ORDER BY ts DESC LIMIT 200");
      res.json({ ok: true, rows: r.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // P0-3：拍板盈亏回填
  app.post("/api/db/decision_post/pnl", async (req, res) => {
    const { ticketId, pnl, executed } = req.body || {};
    if (!ticketId) return res.status(400).json({ error: "ticketId required" });
    try {
      await pool.query("UPDATE decision_post SET pnl=$1, executed=$2 WHERE ticket_id=$3", [
        pnl ?? null, Boolean(executed), ticketId,
      ]);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ---------- P0-3：成交台账 ----------
  app.post("/api/db/trade_ledger", async (req, res) => {
    const t = req.body || {};
    if (!t.code || !t.action || typeof t.price !== "number") return res.status(400).json({ error: "code/action/price required" });
    try {
      await pool.query(
        `INSERT INTO trade_ledger(date,decision_post_ref,code,name,action,price,quantity,cost,pnl_pct,notes,ts)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())`,
        [t.date, t.decisionPostRef ?? null, t.code, t.name ?? null, t.action, t.price,
         t.quantity ?? 0, t.cost ?? null, t.pnlPct ?? null, t.notes ?? null],
      );
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/db/trade_ledger", async (req, res) => {
    try {
      const limit = Math.max(1, Math.min(Number(req.query.limit) || 200, 500));
      const r = await pool.query("SELECT * FROM trade_ledger ORDER BY ts DESC LIMIT $1", [limit]);
      res.json({ ok: true, rows: r.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
};
