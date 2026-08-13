// ============================================================
// server/cron/ledger.js —— 领域模块（v9.139.0 阶段二 #16，split-cron.js 自动拆分）
// 行为与原 cron.js 逐字一致；原文件已只留调度注册
// ============================================================
const B = require("./base");
const { contentKey, httpsGet, bjDate, bjDateStr, EM_UT, detectSealDecayServer, markCronStep, hasCronStep, isTradingDayCN, getJson, getJsonWithFallback, requestRaw, parseLLMJSON, SCHEMAS, withPgLock, LOCK_CRON_MAIN, LOCK_THEME, LOCK_WATCH, LOCK_INTRADAY, callLLM, saveFactorIc } = B;


// ============== P0-3：拍板盈亏自动回填 ==============
// 对 decision_post 中 human_action='confirm' 且 executed=false 的样本，
// 用东财 push2his 日K 回填 T+1/T+5 盈亏（拍板价→T+1/T+5 收盘价涨跌幅%）
// 幂等：回填后置 executed=true，下次 cron 不再处理
async function runTradeBackfill(pool) {
  // 拉未回填的 confirm 拍板（近 60 天）
  const r = await pool.query(
    `SELECT * FROM decision_post
     WHERE human_action='confirm' AND executed=false AND code IS NOT NULL
     AND date >= to_char(now() - interval '60 days', 'YYYY-MM-DD')
     ORDER BY ts DESC LIMIT 100`,
  );
  const posts = r.rows;
  let backfilled = 0;
  for (const post of posts) {
    // T+5 需要拍板后至少 7 自然日（5 交易日 + 周末余量）
    const ageDays = Math.floor((Date.now() - new Date(post.ts).getTime()) / 86400000);
    if (ageDays < 7) continue;
    try {
      const pnl = await backfillOnePost(post);
      if (pnl != null) {
        await pool.query(`UPDATE decision_post SET pnl=$1, executed=true WHERE ticket_id=$2`, [pnl, post.ticket_id]);
        backfilled++;
      }
    } catch { /* 单条失败继续 */ }
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
  } catch { /* push2his 断源 → 腾讯兜底 */ }
  // v9.84.5：push2his 断源（HTTP 000）→ 腾讯 fqkline 兜底（列格式 date,open,close,high,low,volume 兼容）
  if (kl.length === 0) {
    try {
      const qSymbol = /^(60|68|5)/.test(post.code) ? `sh${post.code}` : `sz${post.code}`;
      const txUrl = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${qSymbol},day,,,10,qfq`;
      const tj = await httpsGet(txUrl, 10000);
      const rows = tj?.data?.[qSymbol]?.qfqday ?? tj?.data?.[qSymbol]?.day ?? [];
      if (Array.isArray(rows)) kl = rows.map(r => (Array.isArray(r) ? r.join(",") : String(r)));
    } catch { /* 腾讯也失败 → 返回 null */ }
  }
  if (!Array.isArray(kl) || kl.length < 2) return null;
  const dates = kl.map(line => String(line).split(",")[0]);
  // 定位拍板日（含当日）在日K的位置
  let idx = dates.indexOf(post.date);
  if (idx < 0) {
    for (let i = 0; i < dates.length; i++) {
      if (dates[i] >= post.date) { idx = i; break; }
    }
    if (idx < 0) return null;
  }
  const base = Number(post.price_at_post) > 0 ? Number(post.price_at_post) : Number(kl[idx].split(",")[2]);
  if (!(base > 0)) return null;
  // T+5（第 5 个交易日后）优先；不足则 T+1
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


// ============== P1-4：盘后主动汇报 ==============
// 15:10 生成【今日拍板命中度】【明日剧本】【明日应关注】→ 落 kv:post_summary:日期 → 推送手机
// LLM 不可用/未配置 → 规则版兜底（不阻塞）
async function runPostSummary(pool) {
  const date = bjDate();
  const dateStr = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  // 1. 今日拍板
  let posts = [];
  try {
    const r = await pool.query(
      `SELECT mainline, code, human_action, confidence_at_post, price_at_post, pnl, executed
       FROM decision_post WHERE date=$1 ORDER BY ts`, [dateStr],
    );
    posts = r.rows;
  } catch { /* 表可能未建 */ }
  // 2. 今日市场指标
  let sentiment = null, ztCount = null, blastedRate = null, maxBoard = null;
  try {
    const r = await pool.query(`SELECT value FROM kv_store WHERE key=$1`, [`market_daily:${dateStr}`]);
    if (r.rows[0]?.value) {
      const md = typeof r.rows[0].value === "string" ? JSON.parse(r.rows[0].value) : r.rows[0].value;
      ztCount = md?.ztCount ?? null;
      blastedRate = md?.blastedRate ?? null;
      maxBoard = md?.maxBoardHeight ?? null;
    }
  } catch { /* 无 market_daily 用默认 */ }
  try {
    const r = await pool.query(`SELECT value FROM kv_store WHERE key=$1`, [`sentiment:${dateStr}`]);
    if (r.rows[0]?.value != null) {
      const v = r.rows[0].value;
      sentiment = typeof v === "object" && v !== null ? Number(v.__raw ?? v.score ?? NaN) : Number(v);
      if (!Number.isFinite(sentiment)) sentiment = null;
    }
  } catch { /* 静默 */ }

  const postsText = posts.length === 0
    ? "今日无拍板记录"
    : posts.map(p => `${p.mainline ?? p.code ?? "?"} → ${p.human_action}${p.pnl != null ? `（T+5 ${p.pnl}%）` : ""}`).join("；");

  // v9.123.0（卓越审查 P1-7）：复盘链消费认知层——注入认知单行（与 /api/cognition 同源，不再各自取数各自判）
  let cogLine = "";
  try {
    const { latestCognition } = require("../lib/cognition");
    const cog = await latestCognition(pool);
    if (cog) {
      cogLine = `【认知层 v${cog.version}】情绪${cog.sentiment.value.stage}(${cog.sentiment.value.score}) · 主线${cog.mainline.value.primaryTheme}(强度${cog.mainline.value.strength}) · 资金${cog.capital.value.signal} · 风险${cog.risk.value.level}·闸门${cog.risk.value.gateOpen ? "开" : "关"} · 龙头${cog.leader.value.name}${cog.leader.value.height}板`;
    }
  } catch { /* 认知不可用 → 不注入，保留原 prompt */ }

  // 3. LLM 生成（callModelText）
  const prompt = `日期：${dateStr}
${cogLine ? cogLine + "\n" : ""}今日拍板：${postsText}
今日市场：情绪${sentiment ?? "?"}分 · 涨停${ztCount ?? "?"}只 · 炸板率${blastedRate ?? "?"}% · 最高板${maxBoard ?? "?"}

请按以下三段输出（每段≤3行，引用具体数字）：
【今日拍板命中度】
【明日剧本】（最多3个，含概率）
【明日应关注】（最多3条）`;
  let summary = null;
  try {
    const { callModelText } = require("../lib/httpProxy");
    summary = await callModelText(prompt, { system: "你是A股短线游资盘后复盘助手。严格按给定三段标题输出，每段≤3行，引用具体数字。", maxTokens: 4000, temperature: 0.3 }); // v9.107.0（全站助手）：盘后拍板提档 2000→4000 // v9.101.0（P1-06 返工）：600→2000
  } catch (e) {
    summary = `【今日拍板命中度】规则版：${postsText}\n【明日剧本】情绪${sentiment ?? "?"}分，炸板${blastedRate ?? "?"}%，明日以情绪延续性为准\n【明日应关注】看最高板${maxBoard ?? "?"}梯队 + 竞价高开方向`;
  }

  // 4. 落库 kv:post_summary:日期
  const summaryKey = `post_summary:${dateStr}`;
  try {
    await pool.query(
      `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now())
       ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
      [summaryKey, JSON.stringify({ date: dateStr, text: summary, posts: postsText, created_at: new Date().toISOString() })],
    );
  } catch { /* 落库失败不阻塞 */ }

  // 5. 推送（复用 sendPushIfConfigured）
  try {
    const { sendPushIfConfigured } = require("../routes/push");
    await sendPushIfConfigured({
      title: `📊 盘后汇报 ${dateStr}`,
      body: summary.slice(0, 500),
      severity: "warning",
    }, pool);
  } catch { /* 推送失败静默 */ }

  return { ok: true, summaryKey };
}


// ============== P3-4：用户风格学习（周度） ==============
// 拉近 30 天 decision_post（拍板）+ trade_ledger（成交）→ LLM 推断风格/心理偏差/禁忌题材
// 落 kv:user_style:YYYY-MM-DD；供前端 userProfile 与 AI 督导参考
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
  } catch { /* 表未建 */ }
  try {
    const r = await pool.query(
      `SELECT code, name, action, price, cost, pnl_pct, date
       FROM trade_ledger WHERE date >= to_char(now() - interval '30 days', 'YYYY-MM-DD') ORDER BY ts DESC LIMIT 100`,
    );
    trades = r.rows;
  } catch { /* 表未建 */ }

  if (posts.length === 0 && trades.length === 0) return { ok: false, reason: "no data" };

  const postsText = posts.length === 0 ? "无拍板" : posts.slice(0, 30).map(p => `${p.date} ${p.mainline ?? p.code ?? "?"}→${p.human_action}${p.pnl != null ? `(${p.pnl}%)` : ""}`).join("；");
  const tradesText = trades.length === 0 ? "无成交" : trades.slice(0, 30).map(t => `${t.date} ${t.code}${t.name ? "/" + t.name : ""} ${t.action}@${t.price}${t.pnl_pct != null ? `(${t.pnl_pct}%)` : ""}`).join("；");

  const prompt = `用户近30天拍板记录：\n${postsText}\n\n用户近30天成交记录：\n${tradesText}\n\n请推断：1) 交易风格（超短打板/波段/价值/题材博弈）2) 常见心理偏差（追高/死扛/频繁交易等）3) 应回避的题材类型。输出严格JSON：{"style":"...","biases":["..."],"avoidThemes":["..."],"suggestion":"≤40字建议"}`;

  let result = null;
  try {
    const { callModelText } = require("../lib/httpProxy");
    const text = await callModelText(prompt, { system: "你是A股行为金融分析师。只输出JSON。", maxTokens: 4000, temperature: 0.4 }); // v9.107.0（全站助手）：行为金融提档 2000→4000 // v9.101.0（P1-06 返工）：800→2000
    // v9.87.0（P1-8）：统一解析 + schema 归一化（字段类型/数组元素）
    result = parseLLMJSON(text, SCHEMAS.userStyle);
  } catch { /* LLM 失败 → 规则版 */ }
  if (!result) {
    result = { style: "未知", biases: [], avoidThemes: [], suggestion: "样本不足，建议持续使用拍板与成交记录功能" };
  }

  const styleKey = `user_style:${dateStr}`;
  try {
    await pool.query(
      `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now())
       ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
      [styleKey, JSON.stringify({ ...result, date: dateStr })],
    );
  } catch { /* 落库失败不阻塞 */ }
  return { ok: true, styleKey };
}
module.exports = { runTradeBackfill, backfillOnePost, runPostSummary, runUserStyleProfile };

