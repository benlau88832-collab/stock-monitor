// ============================================================
// server/cron/news.js —— 领域模块（v9.139.0 阶段二 #16，split-cron.js 自动拆分）
// 行为与原 cron.js 逐字一致；原文件已只留调度注册
// ============================================================
const B = require("./base");
const { contentKey, httpsGet, bjDate, bjDateStr, EM_UT, detectSealDecayServer, markCronStep, hasCronStep, isTradingDayCN, getJson, getJsonWithFallback, requestRaw, parseLLMJSON, SCHEMAS, withPgLock, LOCK_CRON_MAIN, LOCK_THEME, LOCK_WATCH, LOCK_INTRADAY, callLLM, saveFactorIc } = B;

async function runNewsFeedSync(pool) {
  try {
    const { fetchStockNewsServer, upsertNewsFeed } = require("../lib/newsAgg");
    const watchR = await pool.query(`SELECT code,name FROM price_watch WHERE status='active' LIMIT 30`).catch(() => ({ rows: [] }));
    const codes = new Set(watchR.rows.map((r) => r.code).filter(Boolean));
    try {
      const { latestCognition } = require("../lib/cognition");
      const cog = await latestCognition(pool);
      if (cog?.leader?.value?.code) codes.add(cog.leader.value.code);
    } catch { /* 认知不可用 → 仅自选 */ }
    let added = 0;
    for (const code of [...codes].slice(0, 40)) {
      try {
        const items = await fetchStockNewsServer(code);
        added += await upsertNewsFeed(pool, items);
      } catch { /* 单股失败跳过 */ }
    }
    if (added > 0) console.log(`[cron] 资讯聚合 news_feed +${added} 条（${codes.size} 只标的）`);
    return { codes: codes.size, added };
  } catch (e) {
    console.warn("[cron] 资讯聚合失败（不影响主链）:", e.message);
    return { codes: 0, added: 0 };
  }
}

function rankNewsStars(title) {
  return NEWS_BOOST_RE.test(title || "") ? 3 : 1;
}

async function confirmBlackSwansWithLLM(pool, anns) {
  if (!process.env.AI_API_KEY) return null;
  const candidates = anns.filter(a => BLACK_ANN_RE.test(a.title || ""));
  if (candidates.length === 0) return null;
  try {
    // 判重：已确认过标题跳过（kv 滚动 500）
    let done = new Set();
    try {
      const k = await pool.query("SELECT value FROM kv_store WHERE key=$1", [BLACK_ANN_LLM_KEY]);
      const v = k.rows[0]?.value;
      const arr = (typeof v === "string" ? JSON.parse(v) : v)?.titles;
      if (Array.isArray(arr)) done = new Set(arr);
    } catch { /* 首次 */ }
    const fresh = candidates.filter(a => !done.has(a.title)).slice(0, 15);
    if (fresh.length === 0) return null;
    const txt = await callLLM(`对以下公告逐条判断是否构成"黑天鹅"（突发重大利空，会让持仓股大跌甚至跌停）：是→"yes"并给影响级别(severe=立案/退市/造假类|moderate=减持/质押/问询类)与一句话影响；否→"no"。
只输出JSON数组，无其他文字。\n[{"title":"原标题","isBlackSwan":"yes|no","level":"severe|moderate","impact":"≤20字"}]\n\n公告列表：\n${fresh.map((a, i) => `${i + 1}. [${a.stockName}]${a.title.slice(0, 70)}`).join("\n")}`, { maxTokens: 2000, temperature: 0.1 }); // v9.101.0（P1-06 返工）：1500→2000，推理模型不足则 content 为空
    // v9.87.0（P1-8）：统一解析（剥围栏/正则/截断补 ]）+ schema 归一化（isBlackSwan/level 枚举）
    const arr = parseLLMJSON(txt, SCHEMAS.blackSwan);
    if (!Array.isArray(arr) || arr.length === 0) return null;
    // 只接受输入集内的标题（防幻觉）；yes → 保留（标记级别与影响），no → 排除
    const byTitle = new Map(fresh.map(a => [a.title, a]));
    const confirmed = [];
    for (const x of arr) {
      const a = byTitle.get(String(x.title ?? ""));
      if (!a) continue;
      if (String(x.isBlackSwan) === "yes") {
        confirmed.push({
          code: a.stockCode, name: a.stockName, title: a.title, time: a.time, url: a.url,
          level: String(x.level ?? "moderate"), impact: String(x.impact ?? "").slice(0, 20),
        });
      }
    }
    // 记录已评标题（无论 yes/no 都记录，防重复计费）
    const merged = [...new Set([...done, ...fresh.map(a => a.title)])].slice(-500);
    await pool.query(
      `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now()) ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
      [BLACK_ANN_LLM_KEY, JSON.stringify({ titles: merged })],
    );
    if (confirmed.length > 0) console.log(`[cron] 黑天鹅LLM确认: ${confirmed.length}/${fresh.length} 条`);
    return confirmed;
  } catch (e) {
    console.warn("[cron] 黑天鹅LLM确认失败（保留正则结果）:", e.message);
    return null;
  }
}

async function rankFastNewsStars(pool) {
  if (!process.env.AI_API_KEY) return 0;
  try {
    // 1. 取近 2h 未回填的快讯（规则星 ≤2 的才有提升空间，避免重复调用已高分项）
    const sinceStr = new Date(Date.now() + 8 * 3600 * 1000 - 2 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");
    const r = await pool.query(
      `SELECT title FROM news WHERE time >= $1 AND stars <= 2 ORDER BY time DESC LIMIT 30`,
      [sinceStr],
    );
    if (r.rows.length === 0) return 0;
    // 2. 判重（跨轮次已评分标题跳过）
    let doneTitles = new Set();
    try {
      const k = await pool.query("SELECT value FROM kv_store WHERE key=$1", [RANKED_NEWS_TITLE_KEY]);
      const v = k.rows[0]?.value;
      const arr = (typeof v === "string" ? JSON.parse(v) : v)?.titles;
      if (Array.isArray(arr)) doneTitles = new Set(arr);
    } catch { /* 首次无记录 */ }
    const fresh = r.rows.map(x => String(x.title || "")).filter(t => t && !doneTitles.has(t)).slice(0, 20);
    if (fresh.length === 0) return 0;
    // 3. LLM 批打分（一次调用换 20 条分级）
    const txt = await callLLM(`对以下快讯逐条打分：stars=1-5（5=重大利好/大级别催化，4=强利好，3=中性偏多或利空风险，2=普通，1=无关紧要）；sentiment=positive|negative|neutral。只输出JSON数组，无其他文字。\n[{"title":"原标题","stars":3,"sentiment":"positive","logic":"≤15字"}]\n\n快讯列表：\n${fresh.map((t, i) => `${i + 1}. ${t.slice(0, 80)}`).join("\n")}`, { maxTokens: 2000, temperature: 0.1 });
    // v9.87.0（P1-8）：统一解析 + schema 归一化（stars 1-5 clamp / sentiment 枚举）
    const arr = parseLLMJSON(txt, SCHEMAS.fastNewsRank);
    if (!Array.isArray(arr) || arr.length === 0) return 0;
    // 4. 回填（只接受输入集合内的标题，防 LLM 幻觉新标题）
    const titleSet = new Set(fresh);
    let updated = 0;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const x of arr) {
        const title = String(x.title ?? "");
        if (!titleSet.has(title)) continue;
        const stars = Math.max(1, Math.min(5, Number(x.stars) || 1));
        const sentiment = ["positive", "negative", "neutral"].includes(String(x.sentiment)) ? String(x.sentiment) : "neutral";
        const up = await client.query(
          `UPDATE news SET stars=$1, sentiment=$2, rank_source='llm' WHERE title=$3 AND stars <= 2`,
          [stars, sentiment, title],
        );
        if (up.rowCount > 0) updated++;
      }
      // 5. 记录已评标题（滚动保留最近 500，防 kv 膨胀）
      const merged = [...new Set([...doneTitles, ...fresh])].slice(-500);
      await client.query(
        `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now()) ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
        [RANKED_NEWS_TITLE_KEY, JSON.stringify({ titles: merged })],
      );
      await client.query("COMMIT");
    } catch (e) { await client.query("ROLLBACK"); throw e; }
    finally { client.release(); }
    if (updated > 0) console.log(`[cron] 快讯LLM分级回填: ${updated} 条`);
    return updated;
  } catch (e) {
    console.warn("[cron] 快讯LLM分级失败（保留规则提星）:", e.message);
    return 0;
  }
}async function fetchFastNews(pageSize = 80) {

}async function fetchFastNews(pageSize = 80) {
  const url = `https://np-weblist.eastmoney.com/comm/web/getFastNewsList?client=web&biz=web_724&fastColumn=102&sortEnd=&pageSize=${pageSize}&req_trace=${Date.now()}`;
  const json = await httpsGet(url);
  return (json?.data?.fastNewsList ?? []).map(n => {
    // v9.26.9：东财快讯 date/time 偶发缺失 → 产生 "undefined undefined"；用当前北京时间兜底
    // v15-fix：t 含 "undefined" 且长度>10 会绕过兜底 → 显式判 includes("undefined")
    const t = `${n.date ?? ""} ${n.time ?? ""}`.trim();
    const finalTime = (!t.includes("undefined") && t.length > 10) ? t : new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");
    const rawCode = String(n.code ?? "");
    return {
      code: rawCode || contentKey(`news_${n.title ?? ""}_${n.date ?? ""}_${n.time ?? ""}`),
      title: n.title ?? "",
      summary: n.summary ?? "",
      sentiment: "neutral",
      stars: rankNewsStars(n.title),
      // v9.85.2（P2-2）：分级来源标注 —— 规则提星 vs LLM 回填（rankFastNewsStars 会 UPDATE 成 'llm'）
      rankSource: "rule",
      isOverseas: /纳斯达克|道琼斯|恒生|港股|美股|比特币/.test((n.title || "") + (n.summary || "")),
      time: finalTime,
      // v9.93.1（用户报障：支撑新闻不可点击）：getFastNewsList 无 url 字段（实测 url 恒空），
      // 用东财快讯 code 构造真实可跳转链接（实测 finance.eastmoney.com/a/{code}.html 200）
      url: n.url || (rawCode ? `https://finance.eastmoney.com/a/${rawCode}.html` : ""),
      boards: [],
    };
  });
}


// ---------- 3. 抓公告 → announcements ----------
// v15（数据补全）：pages 参数化 —— 启动补抓拉 3 页（覆盖周五晚+周末积压），常规 cron 默认 1 页
async function fetchAnnouncements(pages = 1) {
  const all = [];
  for (let p = 1; p <= pages; p++) {
    const url = `https://np-anotice-stock.eastmoney.com/api/security/ann?sr=-1&page_size=80&page_index=${p}&ann_type=A&client_source=web&stock_list=`;
    try {
      const json = await httpsGet(url);
      const list = json?.data?.list ?? [];
      if (list.length === 0) break;
      all.push(...list);
    } catch { break; }
  }
  const list = all;
  return list.map(a => ({
    artCode: String(a.art_code ?? contentKey(`ann_${a.code ?? ""}_${a.notice_date ?? ""}_${a.title ?? ""}`)),
    // codes/columns 是数组结构（东财 2026 新格式）
    stockCode: String(a.codes?.[0]?.stock_code ?? ""),
    stockName: String(a.codes?.[0]?.short_name ?? ""),
    title: String(a.title ?? "").replace(/<[^>]+>/g, ""),
    columnName: String(a.columns?.[0]?.column_name ?? ""),
    boards: [],
    score: null,
    logic: null,
    time: String(a.display_time ?? a.notice_date ?? "").slice(0, 19),
    url: a.art_code && a.codes?.[0]?.stock_code
      ? `https://data.eastmoney.com/notices/detail/${a.codes[0].stock_code}/${a.art_code}.html`
      : "",
  }));
}

async function fetchPolicyNews() {
  const url = `https://np-weblist.eastmoney.com/comm/web/getFastNewsList?client=web&biz=web_724&fastColumn=102&sortEnd=&pageSize=80&req_trace=${Date.now()}`;
  const json = await httpsGet(url);
  return (json?.data?.fastNewsList ?? [])
    .filter(n => POLICY_RE.test((n.title || "") + (n.summary || "")))
    .map(n => ({
      title: n.title ?? "",
      summary: (n.summary ?? "").slice(0, 120),
      time: `${n.date ?? ""} ${n.time ?? ""}`.trim(),
      url: n.url ?? "",
      // v9.85.2（P2-2）：政策快讯目前是纯正则召回 —— source/confidence 标注，后续 LLM 精筛再升级
      source: "rule",
      confidence: "medium",
    }))
    .slice(0, 30);
}

async function loadRankedAnnTitles(pool) {
  try {
    const k = await pool.query("SELECT value FROM kv_store WHERE key=$1", [RANKED_ANN_KEY]);
    const v = k.rows[0]?.value;
    const arr = (typeof v === "string" ? JSON.parse(v) : v)?.titles;
    return Array.isArray(arr) ? new Set(arr) : new Set();
  } catch { return new Set(); }
}

async function saveRankedAnnTitles(pool, titles) {
  try {
    const merged = [...titles].slice(-500);
    await pool.query(
      `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now()) ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
      [RANKED_ANN_KEY, JSON.stringify({ titles: merged })],
    );
  } catch { /* 失败不影响评分 */ }
}

async function rankStrongAnnouncements(pool, dateStr) {
  const annR = await pool.query("SELECT * FROM announcements WHERE time >= $1 ORDER BY time DESC LIMIT 100", [dateStr]);
  const anns = annR.rows;
  const strongByRule = anns.filter(a => STRONG_ANN_RE.test(a.title || ""))
    .slice(0, 15).map(a => `${a.stock_name}:${a.title}`);

  // LLM 一次评分（仅配 key 时；失败静默走规则）
  // v9.75（阶段三）：幂等 —— 同日已评过的标题（15:40 评分后启动又跑）跳过，避免重复计费
  const strongByLLM = [];
  if (process.env.AI_API_KEY && anns.length > 0) {
    try {
      const rankedTitles = await loadRankedAnnTitles(pool);
      const freshAnns = anns.filter(a => !rankedTitles.has(`${a.stock_code}|${a.title}`));
      if (freshAnns.length > 0) {
        const top40 = freshAnns.slice(0, 40).map(a => `${a.stock_code} ${a.stock_name}: ${a.title}`).join("\n");
        const txt = await callLLM(`对以下公告逐条评分（1-5：5=重大利好必关注，4=强利好，3=中性偏多，≤2=无关/利空），只输出JSON数组，无其他文字：\n[{"code":"代码","score":4,"logic":"≤20字"}]\n\n公告列表：\n${top40}`);
        // v9.87.0（P1-8）：原裸 JSON.parse（坏 JSON 直接抛 → 外层吞掉整段）→ 统一解析 + score clamp
        const arr = parseLLMJSON(txt, SCHEMAS.annScore);
        if (Array.isArray(arr)) {
          for (const x of arr.slice(0, 15)) {
            if (Number(x.score) >= 4) {
              const a = anns.find(y => y.stock_code === String(x.code));
              strongByLLM.push(a ? `${a.stock_name}:${a.title}` : `code ${x.code}:${x.logic || ""}`);
            }
          }
        }
        // 记录已评标题（无论是否进 strong，防重复计费）
        const scored = freshAnns.slice(0, 40).map(a => `${a.stock_code}|${a.title}`);
        for (const t of scored) rankedTitles.add(t);
        await saveRankedAnnTitles(pool, rankedTitles);
      }
    } catch (e) {
      console.warn("[cron] 公告LLM评分失败，走规则:", e.message);
    }
  }
  return [...new Set([...strongByLLM, ...strongByRule])].slice(0, 15);
}

const NEWS_BOOST_RE = /业绩预增|预增|中标|签订|合同|订单|增持|回购|重组|获批|突破|涨停|异动|政策|降准|降息|国常会|国务院|央行|证监会|发改委|工信部|财政部|创新高|大涨|暴涨|重大|全球首发|国产替代|专项债|并购|举牌|回购股份/;

const BLACK_ANN_LLM_KEY = "black_ann_llm_v1";

const RANKED_NEWS_TITLE_KEY = "news_ranked_titles_v1";

const POLICY_RE = /国务院|央行|证监会|发改委|财政部|工信部|商务部|金融监管总局|国家统计局|政策|规划|意见|通知|办法|实施方案|降准|降息|国常会|两会|专项债|新质生产力|扩大开放|减税|补贴/;

const STRONG_ANN_RE = /业绩|中标|增持|回购|重组|突破|获批|净利润|同比|预增|增长|合同|订单|签约|股权|合资|扩产|涨价|产能|激励|分红|扭亏|减亏/;

const RANKED_ANN_KEY = "ranked_ann_titles_v1";

const BLACK_ANN_RE = /立案|退市|商誉减值|被问询|警示函|行政处罚|预亏|业绩预减|减持|质押|违约|停牌核查|风险提示|控股股东|被列为失信|司法冻结/;
module.exports = { runNewsFeedSync, rankNewsStars, confirmBlackSwansWithLLM, rankFastNewsStars, fetchFastNews, fetchAnnouncements, fetchPolicyNews, loadRankedAnnTitles, saveRankedAnnTitles, rankStrongAnnouncements, BLACK_ANN_RE };

