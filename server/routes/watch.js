// ============================================================
// v9.66：个股盯价监控后端 —— price_watch 清单 CRUD + 触发事件
// 接口：
//   GET  /api/watch/list          监控清单（含每只最近偏离度）
//   POST /api/watch/add           录入 { code, name, buy_low, buy_high, stop_loss, trigger_pct, note }
//   POST /api/watch/update        更新 { code, ... }（或 status: paused/done）
//   POST /api/watch/remove        删除 { code }
//   GET  /api/watch/trend?code=   价格走势（price_watch_log 序列）
//   GET  /api/watch/events        未读触发事件（前端轮询 → alertBus 强提示）
//   POST /api/watch/events/read   标记事件已读
// ============================================================
const { pool } = require("../db");

/** 批量拉现价（东财 push2 ulist，单请求多 code） */
async function fetchPrices(codes) {
  const secids = codes.map(c => (c.startsWith("6") ? "1." : "0.") + c).join(",");
  const https = require("https");
  const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&fields=f2,f12&secids=${secids}`;
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: 8000 }, (r) => {
      let data = "";
      r.on("data", d => data += d);
      r.on("end", () => {
        try {
          const j = JSON.parse(data);
          const diff = j?.data?.diff;
          const rows = Array.isArray(diff) ? diff : (diff && typeof diff === "object" ? Object.values(diff) : []);
          const m = {};
          for (const x of rows) { const p = Number(x?.f2); if (Number.isFinite(p) && p > 0) m[String(x?.f12 ?? "")] = p; }
          resolve(m);
        } catch { resolve({}); }
      });
    });
    req.on("error", () => resolve({}));
    req.on("timeout", () => { req.destroy(); resolve({}); });
  });
}

module.exports = function watchRoutes(app) {
  // ---------- 清单 ----------
  app.get("/api/watch/list", async (req, res) => {
    try {
      const r = await pool.query(`SELECT * FROM price_watch ORDER BY created_at`);
      const rows = r.rows;
      // 批量带现价/偏离度（active 才拉价）
      const active = rows.filter(w => w.status === "active");
      let prices = {};
      if (active.length > 0) prices = await fetchPrices(active.map(w => w.code));
      const out = rows.map(w => {
        const price = prices[w.code] ?? null;
        const mid = (Number(w.buy_low) + Number(w.buy_high)) / 2;
        let deviation = null;
        if (price != null && mid > 0) deviation = Math.round((price - mid) / mid * 1000) / 10;
        return { ...w, price, mid, deviation };
      });
      res.json({ ok: true, items: out });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/watch/add", async (req, res) => {
    try {
      const { code, name, buy_low, buy_high, stop_loss, trigger_pct, note } = req.body ?? {};
      if (!code || buy_low == null || buy_high == null) return res.status(400).json({ error: "code/buy_low/buy_high required" });
      const r = await pool.query(
        `INSERT INTO price_watch(code,name,buy_low,buy_high,stop_loss,trigger_pct,note)
         VALUES($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name,buy_low=EXCLUDED.buy_low,buy_high=EXCLUDED.buy_high,
           stop_loss=EXCLUDED.stop_loss,trigger_pct=EXCLUDED.trigger_pct,note=EXCLUDED.note,status='active',updated_at=now()
         RETURNING *`,
        [String(code).trim(), name ?? "", buy_low, buy_high, stop_loss ?? null, trigger_pct ?? 5, note ?? ""],
      );
      res.json({ ok: true, item: r.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/watch/update", async (req, res) => {
    try {
      const { code, status, buy_low, buy_high, stop_loss, trigger_pct, note } = req.body ?? {};
      if (!code) return res.status(400).json({ error: "code required" });
      const r = await pool.query(
        `UPDATE price_watch SET
           status=COALESCE($2,status), buy_low=COALESCE($3,buy_low), buy_high=COALESCE($4,buy_high),
           stop_loss=COALESCE($5,stop_loss), trigger_pct=COALESCE($6,trigger_pct), note=COALESCE($7,note),
           updated_at=now() WHERE code=$1 RETURNING *`,
        [code, status ?? null, buy_low ?? null, buy_high ?? null, stop_loss ?? null, trigger_pct ?? null, note ?? null],
      );
      res.json({ ok: true, item: r.rows[0] ?? null });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/watch/remove", async (req, res) => {
    try {
      const { code } = req.body ?? {};
      if (!code) return res.status(400).json({ error: "code required" });
      await pool.query(`DELETE FROM price_watch WHERE code=$1`, [code]);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ---------- 走势 ----------
  app.get("/api/watch/trend", async (req, res) => {
    try {
      const code = String(req.query.code || "");
      if (!code) return res.status(400).json({ error: "code required" });
      const r = await pool.query(
        `SELECT date, price, deviation_pct, triggered, event_text FROM price_watch_log WHERE code=$1 ORDER BY date`, [code],
      );
      res.json({ ok: true, items: r.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ---------- 触发事件（前端轮询 → alertBus） ----------
  app.get("/api/watch/events", async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT id, code, name, price, mid_price, deviation_pct, event_text, created_at
         FROM price_watch_events WHERE read_at IS NULL ORDER BY created_at DESC LIMIT 20`,
      );
      res.json({ ok: true, items: r.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/watch/events/read", async (req, res) => {
    try {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
      if (ids.length > 0) await pool.query(`UPDATE price_watch_events SET read_at=now() WHERE id = ANY($1)`, [ids]);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
};

// ============== 供 cron 复用的盯价核心 ==============
/** 北京时间日期串（YYYY-MM-DD，避免 UTC 在凌晨落错天） */
function bjDateStr() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** 对 active 清单拉价 → 算偏离 → 写 log + 触发事件。返回触发列表 */
async function runWatchCheck(poolArg) {
  const p = poolArg ?? pool;
  try {
    const r = await p.query(`SELECT * FROM price_watch WHERE status='active'`);
    const watches = r.rows;
    if (watches.length === 0) return { checked: 0, triggered: [] };
    // v9.77（P0-9）：price_watch_log 增加 event_type 列 —— 破止损(stop) / 进买入区(zone) 独立去重
    await p.query(`ALTER TABLE price_watch_log ADD COLUMN IF NOT EXISTS event_type TEXT`).catch(() => {});
    const prices = await fetchPrices(watches.map(w => w.code));
    const triggered = [];
    for (const w of watches) {
      const price = prices[w.code];
      if (price == null) continue;
      const mid = (Number(w.buy_low) + Number(w.buy_high)) / 2;
      const dev = Math.round((price - mid) / mid * 1000) / 10;
      const tp = Number(w.trigger_pct) || 5;
      const inZone = Math.abs(dev) <= tp;
      // v9.77（P0-9）：stop_loss 真正参与触发 —— 现价 ≤ 止损价 → "已破止损"事件（独立于买入区）
      const stopLoss = Number(w.stop_loss);
      const brokenStop = w.stop_loss != null && !Number.isNaN(stopLoss) && stopLoss > 0 && price <= stopLoss;
      // 事件类型：破止损优先（更紧急）；都未命中 → null（只记 log 不触发）
      const eventType = brokenStop ? "stop" : inZone ? "zone" : null;
      // 当日是否已触发同类型（破止损/进买入区 分别去重，午后真破位不再被早盘买入区触发吞掉）
      const today = bjDateStr();
      const dup = eventType ? await p.query(
        `SELECT 1 FROM price_watch_log WHERE code=$1 AND date=$2 AND triggered=true AND event_type=$3 LIMIT 1`, [w.code, today, eventType],
      ).catch(() => ({ rows: [] })) : { rows: [1] };
      const logText = eventType === "stop" ? `已破止损（现价${price}≤止损${w.stop_loss}）`
        : eventType === "zone" ? `进入关注区间（偏离${dev}%，买入区 ${w.buy_low}-${w.buy_high}）` : null;
      await p.query(
        `INSERT INTO price_watch_log(code,date,price,mid_price,deviation_pct,triggered,event_type,event_text)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT(code,date) DO UPDATE SET price=EXCLUDED.price,deviation_pct=EXCLUDED.deviation_pct,triggered=EXCLUDED.triggered,event_type=EXCLUDED.event_type,event_text=EXCLUDED.event_text`,
        [w.code, today, price, mid, dev, Boolean(eventType), eventType, logText],
      ).catch(() => {});
      if (eventType && dup.rows.length === 0) {
        await p.query(
          `CREATE TABLE IF NOT EXISTS price_watch_events (
             id SERIAL PRIMARY KEY, code TEXT, name TEXT, price NUMERIC, mid_price NUMERIC,
             deviation_pct NUMERIC, event_text TEXT, read_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now())`,
        ).catch(() => {});
        const eventText = eventType === "stop"
          ? `🚨 已破止损：现价 ${price} ≤ 止损 ${w.stop_loss}（买入区 ${w.buy_low}-${w.buy_high}）`
          : `进入关注区间（偏离${dev}%，止损 ${w.stop_loss ?? "-"}）`;
        await p.query(
          `INSERT INTO price_watch_events(code,name,price,mid_price,deviation_pct,event_text)
           VALUES($1,$2,$3,$4,$5,$6)`,
          [w.code, w.name, price, mid, dev, eventText],
        ).catch(() => {});
        triggered.push({ code: w.code, name: w.name, price, deviation: dev, type: eventType });
        // P1-6：触发后异步生成 AI 一句话结论 + 推送（fire-and-forget，失败不影响主流程）
        try {
          quickStockVerdictAndPush(p, w, price, dev, eventType);
        } catch { /* 静默 */ }
      }
    }
    return { checked: watches.length, triggered };
  } catch (e) { return { checked: 0, triggered: [], error: e.message }; }
}

/**
 * P1-6：盯价触发 → LLM 一句话结论 + 推送（异步，不阻塞 runWatchCheck）
 * 用 server/lib/httpProxy.callModelText 调 LLM（Key 在 server/.env）
 * 结论写入 price_watch_events.event_text（前端轮询可见）+ 推送 push 渠道
 */
async function quickStockVerdictAndPush(p, w, price, dev, eventType) {
  try {
    const { callModelText } = require("../lib/httpProxy");
    // v9.77（P0-9）：破止损触发时提示词强调"是否止损离场"语义（原只有"进入关注区间"）
    const prompt = `个股 ${w.name || w.code}(${w.code}) 现价 ${price} 元，相对买入区(${w.buy_low}-${w.buy_high})偏离 ${dev}%，止损参考 ${w.stop_loss ?? "未设"}。${eventType === "stop" ? "已跌破止损价！" : ""}
请给出一句话短线结论（≤40字）：直接写"可关注/观望/回避"开头 + 理由，不要多余格式。`;
    const verdict = await callModelText(prompt, { system: "你是A股短线盯盘助手，只输出一句话结论（≤40字），不输出任何其他内容。", maxTokens: 80, temperature: 0.2 });
    // 更新事件文本（追加 AI 结论）
    if (verdict) {
      await p.query(
        `UPDATE price_watch_events SET event_text = event_text || ' 🤖 ' || $1
         WHERE code=$2 AND read_at IS NULL ORDER BY id DESC LIMIT 1`,
        [verdict.slice(0, 60), w.code],
      ).catch(() => {});
    }
    // 推送（写 kv push_settings 判断；失败静默）
    try {
      const cfgR = await p.query(`SELECT value FROM kv_store WHERE key='push_settings_v1'`);
      const cfg = cfgR.rows[0]?.value;
      const s = cfg && typeof cfg === "object" && !Array.isArray(cfg)
        ? cfg
        : (cfg && typeof cfg.__raw === "string" ? JSON.parse(cfg.__raw) : null);
      if (s && s.enabled && s.channel) {
        const pushReq = require("./push");
        // push 路由是 express router，直接复用其逻辑较复杂 → 用 http 简单实现跳过，
        // 简化：直接把 AI 结论推给已配置渠道（走 push 模块导出的 sendPushIfConfigured）
        if (typeof pushReq.sendPushIfConfigured === "function") {
          await pushReq.sendPushIfConfigured({
            title: eventType === "stop" ? `🚨 破止损：${w.name || w.code}` : `🎯 盯价触发：${w.name || w.code}`,
            body: `${eventType === "stop" ? "已跌破止损价！" : ""}${verdict || ""}\n现价 ${price} 元 · 偏离 ${dev}% · 止损 ${w.stop_loss ?? "-"}`,
            severity: "critical",
          }, p);
        }
      }
    } catch { /* 推送失败静默 */ }
  } catch { /* LLM 失败静默（不影响触发事件本身） */ }
}

module.exports.runWatchCheck = runWatchCheck;
