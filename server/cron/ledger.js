// ============================================================
// v9.142.0 ledger domain: decision backfill, post summary,
// user style profile, and holding logic push from logic_ledger table.
// ============================================================
const B = require("./base");
const { bjDate, bjDateStr, httpsGet, EM_UT, parseLLMJSON, SCHEMAS } = B;
const { checkLedgerAlerts, activeEntries } = require("../../src/shared/logic-ledger.js");

async function runTradeBackfill(pool) {
  const r = await pool.query(
    `SELECT * FROM decision_post
     WHERE human_action='confirm' AND executed=false AND code IS NOT NULL
     AND date >= to_char(now() - interval '60 days', 'YYYY-MM-DD')
     ORDER BY ts DESC LIMIT 100`,
  );
  const posts = r.rows;
  let backfilled = 0;
  for (const post of posts) {
    const ageDays = Math.floor((Date.now() - new Date(post.ts).getTime()) / 86400000);
    if (ageDays < 7) continue;
    try {
      const pnl = await backfillOnePost(post);
      if (pnl != null) {
        await pool.query(`UPDATE decision_post SET pnl=$1, executed=true WHERE ticket_id=$2`, [pnl, post.ticket_id]);
        backfilled++;
      }
    } catch { /* single failure continues */ }
  }
  return { total: posts.length, backfilled };
}

async function backfillOnePost(post) {
  const secid = /^(60|68|5)/.test(post.code) ? `1.${post.code}` : `0.${post.code}`;
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55&klt=101&fqt=0&lmt=10&ut=${EM_UT}`;
  let kl = [];
  try {
    const j = await httpsGet(url, 10000);
    const arr = j?.data?.klines ?? [];
    if (Array.isArray(arr)) kl = arr;
  } catch { /* fallback to Tencent */ }
  if (kl.length === 0) {
    try {
      const qSymbol = /^(60|68|5)/.test(post.code) ? `sh${post.code}` : `sz${post.code}`;
      const txUrl = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${qSymbol},day,,,10,qfq`;
      const tj = await httpsGet(txUrl, 10000);
      const rows = tj?.data?.data?.[qSymbol]?.qfqday ?? tj?.data?.data?.[qSymbol]?.day ?? [];
      if (Array.isArray(rows)) kl = rows.map((r) => (Array.isArray(r) ? r.join(",") : String(r)));
    } catch { /* return null */ }
  }
  if (!Array.isArray(kl) || kl.length < 2) return null;
  const dates = kl.map((line) => String(line).split(",")[0]);
  let idx = dates.indexOf(post.date);
  if (idx < 0) {
    for (let i = 0; i < dates.length; i++) {
      if (dates[i] >= post.date) { idx = i; break; }
    }
    if (idx < 0) return null;
  }
  const base = Number(post.price_at_post) > 0 ? Number(post.price_at_post) : Number(kl[idx].split(",")[2]);
  if (!(base > 0)) return null;
  const t5line = kl[idx + 5];
  if (t5line) {
    const t5Close = Number(t5line.split(",")[2]);
    if (t5Close > 0) return Math.round((t5Close / base - 1) * 10000) / 100;
  }
  const t1line = kl[idx + 1];
  if (t1line) {
    const t1Close = Number(t1line.split(",")[2]);
    if (t1Close > 0) return Math.round((t1Close / base - 1) * 10000) / 100;
  }
  return null;
}

async function runPostSummary(pool) {
  const date = bjDate();
  const dateStr = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  let posts = [];
  try {
    const r = await pool.query(
      `SELECT mainline, code, human_action, confidence_at_post, price_at_post, pnl, executed
       FROM decision_post WHERE date=$1 ORDER BY ts`,
      [dateStr],
    );
    posts = r.rows;
  } catch { /* table may be empty */ }

  let sentiment = null, ztCount = null, blastedRate = null, maxBoard = null;
  try {
    const r = await pool.query(`SELECT value FROM kv_store WHERE key=$1`, [`market_daily:${dateStr}`]);
    if (r.rows[0]?.value) {
      const md = typeof r.rows[0].value === "string" ? JSON.parse(r.rows[0].value) : r.rows[0].value;
      ztCount = md?.ztCount ?? null;
      blastedRate = md?.blastedRate ?? null;
      maxBoard = md?.maxBoardHeight ?? null;
    }
  } catch { /* default */ }
  try {
    const r = await pool.query(`SELECT value FROM kv_store WHERE key=$1`, [`sentiment:${dateStr}`]);
    if (r.rows[0]?.value != null) {
      const v = r.rows[0].value;
      sentiment = typeof v === "object" && v !== null ? Number(v.__raw ?? v.score ?? NaN) : Number(v);
      if (!Number.isFinite(sentiment)) sentiment = null;
    }
  } catch { /* default */ }

  const postsText = posts.length === 0
    ? "今日无拍板记录"
    : posts.map((p) => `${p.mainline ?? p.code ?? "?"} → ${p.human_action}${p.pnl != null ? `（T+5 ${p.pnl}%）` : ""}`).join("；");

  let cogLine = "";
  try {
    const { latestCognition } = require("../lib/cognition");
    const cog = await latestCognition(pool);
    if (cog) {
      cogLine = `【认知层 v${cog.version}】情绪${cog.sentiment.value.stage}(${cog.sentiment.value.score}) 路 主线${cog.mainline.value.primaryTheme}(强度${cog.mainline.value.strength}) 路 资金${cog.capital.value.signal} 路 风险${cog.risk.value.level}路闸门${cog.risk.value.gateOpen ? "开" : "关"} 路 龙头${cog.leader.value.name}${cog.leader.value.height}板`;
    }
  } catch { /* ignore */ }

  const prompt = `日期：${dateStr}\n${cogLine ? cogLine + "\n" : ""}今日拍板：${postsText}\n今日市场：情绪${sentiment ?? "?"}分 路 涨停${ztCount ?? "?"}只 路 炸板率${blastedRate ?? "?"}% 路 最高板${maxBoard ?? "?"}\n\n请按以下三段输出（每段≤3行，引用具体数字）：\n【今日拍板命中度】\n【明日剧本】（最多3个，含概率）\n【明日应关注】（最多5条）`;
  let summary = null;
  try {
    const { callModelText } = require("../lib/httpProxy");
    summary = await callModelText(prompt, { system: "你是A股短线游资盘后复盘助手。严格按给定三段标题输出，每段≤3行，引用具体数字。", maxTokens: 4000, temperature: 0.3 });
  } catch (e) {
    summary = `【今日拍板命中度】规则版：${postsText}\n【明日剧本】情绪${sentiment ?? "?"}分，炸板${blastedRate ?? "?"}%，明日以情绪延续性为纲\n【明日应关注】看最高板${maxBoard ?? "?"}梯队 + 竞价高开方向`;
  }

  const summaryKey = `post_summary:${dateStr}`;
  try {
    await pool.query(
      `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now())
       ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
      [summaryKey, JSON.stringify({ date: dateStr, text: summary, posts: postsText, created_at: new Date().toISOString() })],
    );
  } catch { /* ignore */ }

  try {
    const { sendPushIfConfigured } = require("../routes/push");
    await sendPushIfConfigured({ title: `盘后汇报 ${dateStr}`, body: summary.slice(0, 500), severity: "warning" }, pool);
  } catch { /* ignore */ }
  return { ok: true, summaryKey };
}

async function runUserStyleProfile(pool) {
  const date = bjDate();
  const dateStr = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  let posts = [], trades = [];
  try {
    const r = await pool.query(
      `SELECT mainline, code, human_action, confidence_at_post, pnl, date
       FROM decision_post WHERE date >= to_char(now() - interval '30 days', 'YYYY-MM-DD') ORDER BY ts DESC LIMIT 100`,
    );
    posts = r.rows;
  } catch { /* empty */ }
  try {
    const r = await pool.query(
      `SELECT code, name, action, price, cost, pnl_pct, date
       FROM trade_ledger WHERE date >= to_char(now() - interval '30 days', 'YYYY-MM-DD') ORDER BY ts DESC LIMIT 100`,
    );
    trades = r.rows;
  } catch { /* empty */ }

  if (posts.length === 0 && trades.length === 0) return { ok: false, reason: "no data" };
  const postsText = posts.length === 0 ? "无拍板" : posts.slice(0, 30).map((p) => `${p.date} ${p.mainline ?? p.code ?? "?"}→${p.human_action}${p.pnl != null ? `(${p.pnl}%)` : ""}`).join("；");
  const tradesText = trades.length === 0 ? "无成交" : trades.slice(0, 30).map((t) => `${t.date} ${t.code}${t.name ? "/" + t.name : ""} ${t.action}@${t.price}${t.pnl_pct != null ? `(${t.pnl_pct}%)` : ""}`).join("；");

  const prompt = `用户近30天拍板记录：\n${postsText}\n\n用户近30天成交记录：\n${tradesText}\n\n请推断：1) 交易风格（超短打板/波段/价值/题材博弈）2) 常见心理偏差（追高/死扛/频繁交易等）3) 应回避的题材类型。输出严格JSON：{"style":"...","biases":["..."],"avoidThemes":["..."],"suggestion":"≤50字建议"}`;
  let result = null;
  try {
    const { callModelText } = require("../lib/httpProxy");
    const text = await callModelText(prompt, { system: "你是A股行为金融分析师。只输出JSON。", maxTokens: 4000, temperature: 0.4 });
    result = parseLLMJSON(text, SCHEMAS.userStyle);
  } catch { /* rule fallback */ }
  if (!result) {
    result = { style: "未知", biases: [], avoidThemes: [], suggestion: "样本不足，建议继续使用拍板与成交记录功能" };
  }
  const styleKey = `user_style:${dateStr}`;
  try {
    await pool.query(
      `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now())
       ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
      [styleKey, JSON.stringify({ ...result, date: dateStr })],
    );
  } catch { /* ignore */ }
  return { ok: true, styleKey };
}

async function loadPushedLog(pool, today) {
  try {
    const r = await pool.query("SELECT value FROM kv_store WHERE key=$1", [`ledger_push_log:${today}`]);
    const v = r.rows[0]?.value;
    const arr = typeof v === "string" ? JSON.parse(v) : v;
    return new Set(Array.isArray(arr) ? arr : []);
  } catch { return new Set(); }
}

async function savePushedLog(pool, today, pushedKeys) {
  await pool.query(
    `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now())
     ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
    [`ledger_push_log:${today}`, JSON.stringify([...pushedKeys].slice(-200))],
  );
}

async function loadLogicEntries(pool) {
  const r = await pool.query(
    `SELECT * FROM logic_ledger WHERE status <> '已离场' ORDER BY updated_at DESC LIMIT 200`,
  );
  return r.rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name || row.code,
    status: row.status,
    thesis: row.thesis,
    catalysts: Array.isArray(row.catalysts) ? row.catalysts : [],
    breakLine: row.break_line != null ? Number(row.break_line) : null,
    board: row.board,
    decisionRef: row.decision_ref,
    tradeRef: row.trade_ref,
    simulated: Boolean(row.simulated),
  }));
}

async function loadBoardHealth(pool) {
  const today = bjDateStr();
  try {
    const r = await pool.query("SELECT value FROM kv_store WHERE key=$1", [`swing_direction:${today}`]);
    const v = r.rows[0]?.value;
    const data = typeof v === "string" ? JSON.parse(v) : v;
    const boards = Array.isArray(data?.boards) ? data.boards : [];
    const map = {};
    for (const b of boards) if (b?.name) map[String(b.name)] = b.phase !== "退潮";
    return map;
  } catch { return {}; }
}

async function runLedgerPush(pool, opts = {}) {
  const today = bjDateStr();
  const entries = await loadLogicEntries(pool);
  if (!entries || entries.length === 0) return { ok: false, reason: "no logic ledger data" };
  const alreadyPushed = await loadPushedLog(pool, today);
  const boardHealth = await loadBoardHealth(pool);

  const needPrice = entries.filter((e) => e.breakLine != null && e.breakLine > 0);
  const priceMap = new Map();
  if (needPrice.length > 0) {
    try {
      const codes = [...new Set(needPrice.map((e) => String(e.code)))];
      const q = codes.map((c) => (c.startsWith("6") ? "sh" : c.startsWith("4") || c.startsWith("8") ? "bj" : "sz") + c).join(",");
      const { requestRaw } = require("../lib/outbound");
      const { parseTencentQuotesBatch } = require("../lib/stockSnapshot");
      const { body } = await requestRaw(`https://qt.gtimg.cn/q=${q}`, { timeout: 5000, rawBuffer: true });
      for (const [code, pct] of parseTencentQuotesBatch(body)) {
        if (pct != null && Number.isFinite(pct)) priceMap.set(String(code).replace(/^(sh|sz|bj)/, ""), pct);
      }
    } catch (e) { console.warn("[cron] ledger_push price enrich failed:", e.message); }
  }

  const candidates = [];
  for (const e of entries) {
    const price = priceMap.get(String(e.code)) ?? null;
    const boardHealthy = e.board ? (boardHealth[String(e.board)] ?? null) : null;
    for (const a of checkLedgerAlerts(e, { price, boardHealthy, today })) {
      const key = `${a.code}:${a.type}`;
      if (alreadyPushed.has(key)) continue;
      if (a.type === "break_line" && price == null) continue;
      candidates.push({ alert: a, key });
    }
  }
  candidates.sort((x, y) => (x.alert.severity === "critical" ? 0 : 1) - (y.alert.severity === "critical" ? 0 : 1));

  let pushed = 0;
  for (const { alert, key } of candidates) {
    alreadyPushed.add(key);
    if (opts.dryRun) { pushed++; continue; }
    try {
      const { sendPushIfConfigured } = require("../routes/push");
      const r = await sendPushIfConfigured({ title: `持仓提醒：${alert.name}（${alert.code}）`, body: alert.message, severity: alert.severity });
      if (r && r.ok) pushed++;
    } catch (e) { console.warn(`[cron] ledger_push ${key} failed:`, e.message); }
  }
  await savePushedLog(pool, today, alreadyPushed);
  return { ok: true, entries: entries.length, candidates: candidates.length, pushed };
}

module.exports = { runTradeBackfill, backfillOnePost, runPostSummary, runUserStyleProfile, runLedgerPush, loadPushedLog, savePushedLog };
