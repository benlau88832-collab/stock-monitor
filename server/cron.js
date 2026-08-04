// ============================================================
// 定时任务：收盘快照抓取 + 公告/快讯自动落库 + 自动 LLM 分析
// 设计目标（用户核心诉求）：
//   1. 所有公告+信息流自动刷新、自动储存（无需开页面）
//   2. 收盘后自动抓涨停池快照（跨日数据不再空洞）
//   3. 自动 LLM 分析：对抓到的公告/快讯生成结构化分析落库
// ============================================================
const https = require("https");
const cron = require("node-cron");
// v9.26.5：显式加载 .env（独立调用/测试时也能读到 AI 配置）
require("dotenv").config();

const EM_UT = "7eea3edcaed734bea9cbfc24409ed989";

// ---------- 通用 https GET ----------
function httpsGet(url, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "Mozilla/5.0", Referer: "https://data.eastmoney.com/" } }, r => {
      const chunks = [];
      r.on("data", c => chunks.push(c));
      r.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        try { resolve(JSON.parse(raw)); }
        catch { reject(new Error("bad json")); }
      });
    });
    req.on("error", reject);
    req.setTimeout(timeout, () => { req.destroy(new Error("timeout")); });
  });
}

// ---------- v9.26.5：自动 LLM 分析调用（.cn 直连优先，失败走代理） ----------
const { HttpsProxyAgent } = require("https-proxy-agent");
const AI_PROXY_URL = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "http://127.0.0.1:7897";
function callLLM(payloadText) {
  return new Promise((resolve, reject) => {
    const baseUrl = process.env.AI_BASE_URL || "https://apihub.agnes-ai.cn/v1/chat/completions";
    const model = process.env.AI_MODEL || "agnes-2.5-flash";
    const body = {
      model,
      messages: [
        { role: "system", content: "你是A股资深盘面分析师。基于今日快讯与公告数据，输出当日市场速览（≤150字）：1) 主线方向 2) 强催化公告要点 3) 风险提示。直接输出正文，不要markdown。" },
        { role: "user", content: payloadText },
      ],
      max_tokens: 600,
      temperature: 0.2,
      stream: false,
      chat_template_kwargs: { enable_thinking: false },
    };
    const data = JSON.stringify(body);
    const u = new URL(baseUrl);
    const lib = u.protocol === "https:" ? https : require("http");
    const commonHeaders = {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(data),
      "Authorization": "Bearer " + (process.env.AI_API_KEY || ""),
    };
    const attempt = (agent) => new Promise((res2, rej2) => {
      const req = lib.request(u, { method: "POST", headers: commonHeaders, ...(agent ? { agent } : {}) }, r => {
        const chunks = [];
        r.on("data", c => chunks.push(c));
        r.on("end", () => {
          try {
            const j = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            const content = (j.choices?.[0]?.message?.content || "").trim();
            if (!content) return rej2(new Error("empty content"));
            res2(content);
          } catch (e) { rej2(e); }
        });
      });
      req.on("error", rej2);
      req.setTimeout(40000, () => { req.destroy(new Error("llm timeout")); });
      req.write(data);
      req.end();
    });
    // .cn 直连优先；失败走代理重试
    attempt(null).then(resolve, () => attempt(new HttpsProxyAgent(AI_PROXY_URL)).then(resolve, reject));
  });
}

function bjDate(offset = 0) {  const d = new Date(Date.now() + 8 * 3600 * 1000 + offset * 86400000);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

// ---------- 1. 抓涨停池快照 → zt_snapshot ----------
async function fetchZTPool(date = bjDate()) {
  const url = `https://push2ex.eastmoney.com/getTopicZTPool?ut=${EM_UT}&dpt=wz.ztzt&Pageindex=0&pagesize=200&sort=fbt%3Aasc&date=${date}`;
  const json = await httpsGet(url);
  const pool = json?.data?.pool ?? [];
  return {
    date: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`,
    count: pool.length,
    pool: pool.map(p => ({
      code: p.c, name: p.n, pct: p.zdp, fbt: p.fbt, lbc: p.lbc, fund: p.fund, hybk: p.hybk, zttj: p.zttj,
    })),
  };
}

// ---------- 2. 抓快讯 → news ----------
async function fetchFastNews() {
  const url = `https://np-weblist.eastmoney.com/comm/web/getFastNewsList?client=web&biz=web_724&fastColumn=102&sortEnd=&pageSize=80&req_trace=${Date.now()}`;
  const json = await httpsGet(url);
  return (json?.data?.fastNewsList ?? []).map(n => ({
    code: String(n.code ?? `${n.date}_${n.time}_${Math.random().toString(36).slice(2, 8)}`),
    title: n.title ?? "",
    summary: n.summary ?? "",
    sentiment: "neutral",
    stars: 1,
    isOverseas: /纳斯达克|道琼斯|恒生|港股|美股|比特币/.test((n.title || "") + (n.summary || "")),
    time: `${n.date} ${n.time}`,
    url: n.url ?? "",
    boards: [],
  }));
}

// ---------- 3. 抓公告 → announcements ----------
async function fetchAnnouncements() {
  const url = `https://np-anotice-stock.eastmoney.com/api/security/ann?sr=-1&page_size=80&page_index=1&ann_type=A&client_source=web&stock_list=`;
  const json = await httpsGet(url);
  const list = json?.data?.list ?? [];
  return list.map(a => ({
    artCode: String(a.art_code ?? `${a.code}_${a.notice_date}_${Math.random().toString(36).slice(2, 8)}`),
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

// ---------- 自动 LLM 分析（可选：配了 key 才调用；无 key 走规则版标注） ----------
// 分析结果写入 kv_store: llm_analysis:YYYY-MM-DD
// v9.26.5：接入真实 LLM（AI_API_KEY 配置在 server/.env 时自动启用）
async function analyzeDaily({ pool }) {
  try {
    const date = bjDate();
    const dateStr = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
    const newsR = await pool.query("SELECT * FROM news WHERE time >= $1 ORDER BY time DESC LIMIT 100", [dateStr]);
    const annR = await pool.query("SELECT * FROM announcements WHERE time >= $1 ORDER BY time DESC LIMIT 100", [dateStr]);

    const strongNews = newsR.rows.filter(n => n.stars >= 3).slice(0, 10).map(n => n.title);
    const strongAnn = annR.rows
      .filter(a => /业绩|中标|增持|回购|重组|突破|获批/.test(a.title || ""))
      .slice(0, 15).map(a => `${a.stock_name}:${a.title}`);

    // v9.26.5：配了服务端 Key → 真实调用 LLM 生成当日市场分析；否则规则版标注
    let llmText = "规则版（未配置服务端 LLM Key，前端 AI 功能可正常使用配置的 Key）";
    if (process.env.AI_API_KEY) {
      try {
        llmText = await callLLM(JSON.stringify({
          strongNews,
          strongAnn,
          newsTotal: newsR.rows.length,
          annTotal: annR.rows.length,
        }));
      } catch (e) {
        llmText = `LLM调用失败(${e.message})，本次为规则版快照`;
        console.error("[cron] analyze LLM failed:", e.message);
      }
    }

    const analysis = {
      date: dateStr,
      summary: `今日自动快照：涨停快照已存库 · 快讯${newsR.rows.length}条 · 公告${annR.rows.length}条 · 强催化公告${strongAnn.length}条`,
      strongAnn,
      strongNews,
      llm: llmText,
      createdAt: new Date().toISOString(),
    };
    await pool.query(
      `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now())
       ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
      [`llm_analysis:${dateStr}`, JSON.stringify(analysis)],
    );
    console.log(`[cron] analyze ${dateStr} done: ${strongAnn.length} strong ann`);
  } catch (e) {
    console.error("[cron] analyze failed:", e.message);
  }
}

// ---------- 启动定时任务 ----------
function startCron({ pool }) {
  // 交易日（周一到周五）15:40 收盘快照 + 分析
  cron.schedule("40 15 * * 1-5", async () => {
    console.log("[cron] 15:40 收盘快照 + 分析开始");
    try {
      const snap = await fetchZTPool();
      const dateStr = snap.date;
      await pool.query(
        `INSERT INTO zt_snapshot(date,data) VALUES($1,$2)
         ON CONFLICT(date) DO UPDATE SET data=$2, created_at=now()`,
        [dateStr, JSON.stringify(snap)],
      );
      console.log(`[cron] zt snapshot ${dateStr}: ${snap.count} 只涨停`);
    } catch (e) { console.error("[cron] zt snapshot failed:", e.message); }
    await analyzeDaily({ pool });
  }, { timezone: "Asia/Shanghai" });

  // 交易日每 20 分钟抓快讯+公告自动落库（9:00 - 16:30）
  cron.schedule("*/20 9-16 * * 1-5", async () => {
    try {
      const news = await fetchFastNews();
      if (news.length > 0) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          for (const n of news) {
            await client.query(
              `INSERT INTO news(code,title,summary,boards,sentiment,stars,is_overseas,time,url)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
               ON CONFLICT(code) DO UPDATE SET title=$2,summary=$3,sentiment=$5,stars=$6,time=$8`,
              [n.code, n.title, n.summary ?? "", "[]", n.sentiment, n.stars, n.isOverseas, n.time, n.url],
            );
          }
          await client.query("COMMIT");
        } catch (e) { await client.query("ROLLBACK"); throw e; }
        finally { client.release(); }
      }
      const anns = await fetchAnnouncements();
      if (anns.length > 0) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          for (const a of anns) {
            await client.query(
              `INSERT INTO announcements(art_code,stock_code,stock_name,title,column_name,boards,score,logic,time,url)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
               ON CONFLICT(art_code) DO UPDATE SET title=$4,time=$9`,
              [a.artCode, a.stockCode, a.stockName, a.title, a.columnName, "[]", a.score, a.logic, a.time, a.url],
            );
          }
          await client.query("COMMIT");
        } catch (e) { await client.query("ROLLBACK"); throw e; }
        finally { client.release(); }
      }
      console.log(`[cron] 20min fetch: news=${news.length} ann=${anns.length}`);
    } catch (e) { console.error("[cron] fetch failed:", e.message); }
  }, { timezone: "Asia/Shanghai" });

  // 启动时立即抓取一次（验证 + 补数据：涨停快照 + 快讯 + 公告 全部入库）
  setTimeout(async () => {
    console.log("[cron] 启动即抓取（验证 + 补数据）");
    try {
      const snap = await fetchZTPool();
      await pool.query(
        `INSERT INTO zt_snapshot(date,data) VALUES($1,$2)
         ON CONFLICT(date) DO UPDATE SET data=$2, created_at=now()`,
        [snap.date, JSON.stringify(snap)],
      );
      console.log(`[cron] 涨停快照入库 ${snap.date}: ${snap.count} 只`);
    } catch (e) { console.error("[cron] 启动快照失败:", e.message); }
    try {
      const news = await fetchFastNews();
      const anns = await fetchAnnouncements();
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        for (const n of news) {
          await c.query(
            `INSERT INTO news(code,title,summary,boards,sentiment,stars,is_overseas,time,url)
             VALUES($1,$2,$3,'[]',$4,$5,$6,$7,$8)
             ON CONFLICT(code) DO UPDATE SET title=$2,summary=$3,time=$7`,
            [n.code, n.title, n.summary, n.sentiment, n.stars, n.isOverseas, n.time, n.url],
          );
        }
        for (const a of anns) {
          await c.query(
            `INSERT INTO announcements(art_code,stock_code,stock_name,title,column_name,boards,score,logic,time,url)
             VALUES($1,$2,$3,$4,$5,'[]',$6,$7,$8,$9)
             ON CONFLICT(art_code) DO UPDATE SET title=$4,time=$8`,
            [a.artCode, a.stockCode, a.stockName, a.title, a.columnName, a.score, a.logic, a.time, a.url],
          );
        }
        await c.query("COMMIT");
      } catch (e) { await c.query("ROLLBACK"); throw e; }
      finally { c.release(); }
      console.log(`[cron] 启动抓取入库: 快讯${news.length} 公告${anns.length}`);
    } catch (e) { console.error("[cron] 启动抓取失败:", e.message); }
    await analyzeDaily({ pool });
  }, 3000);

  console.log("[cron] scheduled: 15:40 快照+分析 · 每20分钟抓快讯/公告 · Asia/Shanghai");
};

// 导出抓取函数供验证/手动触发用
module.exports = startCron;
module.exports.fetchZTPool = fetchZTPool;
module.exports.fetchFastNews = fetchFastNews;
module.exports.fetchAnnouncements = fetchAnnouncements;
module.exports.analyzeDaily = analyzeDaily;
