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
  app.get("/api/db/kv/bulk", async (req, res) => {
    try {
      const keysRaw = String(req.query.keys || "");
      const keys = keysRaw.split(",").map(s => s.trim()).filter(Boolean);
      if (keys.length === 0) return res.json({ items: [] });
      const r = await pool.query("SELECT key, value FROM kv_store WHERE key = ANY($1::text[])", [keys]);
      res.json({ items: r.rows.map(x => ({ key: x.key, value: x.value })) });
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

  app.post("/api/db/news", async (req, res) => {
    try {
      const items = Array.isArray(req.body) ? req.body : [];
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const n of items) {
          if (!n.code) continue;
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
      const [conceptsR, newsR, annsR, reportsR, watchR, watchLogR, seatsR, ztR] = await Promise.allSettled([
        getConcepts(pool, [code]),
        pool.query("SELECT title,summary,boards,sentiment,stars,time,url FROM news WHERE code=$1", [code]),
        pool.query("SELECT art_code,stock_name,title,column_name,score,time,url FROM announcements WHERE stock_code=$1 ORDER BY time DESC LIMIT 20", [code]),
        pool.query("SELECT report_date,phase,summary_json,valuation_json,levels_json,full_text,created_at FROM research_reports WHERE code=$1 ORDER BY report_date DESC LIMIT 5", [code]),
        pool.query("SELECT code,name,buy_low,buy_high,stop_loss,trigger_pct,note,updated_at FROM price_watch WHERE code=$1 AND status='active'", [code]),
        pool.query("SELECT date,price,mid_price,deviation_pct,triggered,event_text FROM price_watch_log WHERE code=$1 ORDER BY date DESC LIMIT 30", [code]),
        pool.query("SELECT key,value FROM kv_store WHERE key LIKE 'seats:%' AND key >= $1 ORDER BY key DESC LIMIT 45", [daysAgo]),
        pool.query("SELECT date,data FROM zt_snapshot ORDER BY date DESC LIMIT 30"),
      ]);

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
        news: newsR.status === "fulfilled" ? newsR.value.rows : [],
        announcements: annsR.status === "fulfilled" ? annsR.value.rows : [],
        reports: reportsR.status === "fulfilled" ? reportsR.value.rows : [],
        watch: watchR.status === "fulfilled" ? watchR.value.rows : [],
        watchLog: watchLogR.status === "fulfilled" ? watchLogR.value.rows : [],
        seats,                                        // 近 45 天席位净买/卖记录
        ztHistory,                                    // 近 30 个交易日涨停记录
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
