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
// v9.26.10：主键兜底序号（模块顶部声明避免 TDZ；内容哈希作确定性 key 防重复入库）
let fallbackSeq = 0;
/** 内容哈希：title+time 生成确定性主键（同一数据多次抓取 → 同 key → ON CONFLICT 幂等） */
function contentKey(seed) {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) + h + seed.charCodeAt(i)) >>> 0;
  return `fb_${h.toString(36)}_${fallbackSeq++}`;
}

// ---------- v9.35（S3）：市场日指标落库（信号回测的数据源） ----------
// 目的：给前端 signalBacktest 提供"每日市场指标"历史序列（涨停/跌停/炸板/最高板）。
// 情绪分由前端 cloudStore 已同步（kv sentiment:日期 = 数字分），本键只补池类指标。
async function fetchMarketDaily() {
  const date = bjDate();
  const dateStr = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  const zt = await httpsGet(`https://push2ex.eastmoney.com/getTopicZTPool?ut=${EM_UT}&dpt=wz.ztzt&Pageindex=0&pagesize=300&sort=fbt%3Aasc&date=${date}`);
  const zb = await httpsGet(`https://push2ex.eastmoney.com/getTopicZBPool?ut=${EM_UT}&dpt=wz.ztzt&Pageindex=0&pagesize=300&sort=fbt%3Aasc&date=${date}`);
  const dt = await httpsGet(`https://push2ex.eastmoney.com/getTopicDTPool?ut=${EM_UT}&dpt=wz.ztzt&Pageindex=0&pagesize=300&sort=fbt%3Aasc&date=${date}`);
  const ztPool = zt?.data?.pool ?? [];
  const zbPool = zb?.data?.pool ?? [];
  const dtPool = dt?.data?.pool ?? [];
  const maxBoard = ztPool.length > 0 ? Math.max(0, ...ztPool.map(p => Number(p?.lbc ?? 1))) : 0;
  return {
    date: dateStr,
    ztCount: ztPool.length,
    zbCount: zbPool.length,
    dtCount: dtPool.length,
    blastedRate: ztPool.length + zbPool.length > 0 ? Math.round(zbPool.length / (ztPool.length + zbPool.length) * 1000) / 10 : 0,
    maxBoardHeight: maxBoard,
  };
}

// ---------- v9.36（A3）：龙虎榜采集（与涨停池交叉，识别席位加持） ----------
// 涨停 + 龙虎榜净买入 = 次日溢价增强信号；RPT_DAILYBILLBOARD_DETAILSNEW 当日盘后数据
async function fetchLhbDaily() {
  const url = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_DAILYBILLBOARD_DETAILSNEW&columns=ALL&pageSize=300&source=WEB&client=WEB&sortColumns=TRADE_DATE&sortTypes=-1`;
  const j = await httpsGet(url);
  const rows = j?.result?.data ?? [];
  return rows.map(r => ({
    code: String(r.SECURITY_CODE ?? ""),
    name: String(r.SECURITY_NAME_ABBR ?? ""),
    pct: Number(r.CHANGE_RATE ?? 0),
    buyAmt: Number(r.BILLBOARD_BUY_AMT ?? 0),   // 龙虎榜买入额（元）
    sellAmt: Number(r.BILLBOARD_SELL_AMT ?? 0),
    netBuy: Number(r.BILLBOARD_BUY_AMT ?? 0) - Number(r.BILLBOARD_SELL_AMT ?? 0),
    explain: String(r.EXPLANATION ?? r.EXPLAIN ?? ""),  // 上榜原因（如"日涨幅偏离值达7%"）
  }));
}

// ---------- v9.38（V3-11）：盘中市场快照（加速信号回测样本积累） ----------
// 盘中每小时落 market_intraday:日期 → 前端 signalBacktest 可读日内快照补样本
async function fetchMarketIntraday() {
  const date = bjDate();
  const dateStr = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  const zt = await httpsGet(`https://push2ex.eastmoney.com/getTopicZTPool?ut=${EM_UT}&dpt=wz.ztzt&Pageindex=0&pagesize=300&sort=fbt%3Aasc&date=${date}`);
  const zb = await httpsGet(`https://push2ex.eastmoney.com/getTopicZBPool?ut=${EM_UT}&dpt=wz.ztzt&Pageindex=0&pagesize=300&sort=fbt%3Aasc&date=${date}`);
  const dt = await httpsGet(`https://push2ex.eastmoney.com/getTopicDTPool?ut=${EM_UT}&dpt=wz.ztzt&Pageindex=0&pagesize=300&sort=fbt%3Aasc&date=${date}`);
  const ztPool = zt?.data?.pool ?? [];
  const zbPool = zb?.data?.pool ?? [];
  const dtPool = dt?.data?.pool ?? [];
  return {
    date: dateStr,
    ts: new Date().toISOString(),
    ztCount: ztPool.length,
    zbCount: zbPool.length,
    dtCount: dtPool.length,
    blastedRate: ztPool.length + zbPool.length > 0 ? Math.round(zbPool.length / (ztPool.length + zbPool.length) * 1000) / 10 : 0,
  };
}

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
function callLLM(payloadText, opts = {}) {
  return new Promise((resolve, reject) => {
    const baseUrl = process.env.AI_BASE_URL || "https://apihub.agnes-ai.cn/v1/chat/completions";
    const model = process.env.AI_MODEL || "agnes-2.5-flash";
    // v9.33（缺口2）：opts.system 可覆盖默认系统提示（盘后自动复盘用专用提示词）
    const body = {
      model,
      messages: [
        { role: "system", content: opts.system || "你是A股资深盘面分析师。基于今日快讯与公告数据，输出当日市场速览（≤150字）：1) 主线方向 2) 强催化公告要点 3) 风险提示。直接输出正文，不要markdown。" },
        { role: "user", content: payloadText },
      ],
      max_tokens: opts.maxTokens || 600,
      temperature: opts.temperature ?? 0.2,
      stream: false,
      chat_template_kwargs: { enable_thinking: opts.thinking ?? false },
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
  return (json?.data?.fastNewsList ?? []).map(n => {
    // v9.26.9：东财快讯 date/time 偶发缺失 → 产生 "undefined undefined"；用当前北京时间兜底
    const t = `${n.date ?? ""} ${n.time ?? ""}`.trim();
    const finalTime = t.length > 10 ? t : new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");
    return {
      code: String(n.code ?? contentKey(`news_${n.title ?? ""}_${n.date ?? ""}_${n.time ?? ""}`)),
      title: n.title ?? "",
      summary: n.summary ?? "",
      sentiment: "neutral",
      stars: 1,
      isOverseas: /纳斯达克|道琼斯|恒生|港股|美股|比特币/.test((n.title || "") + (n.summary || "")),
      time: finalTime,
      url: n.url ?? "",
      boards: [],
    };
  });
}

// ---------- 3. 抓公告 → announcements ----------
async function fetchAnnouncements() {
  const url = `https://np-anotice-stock.eastmoney.com/api/security/ann?sr=-1&page_size=80&page_index=1&ann_type=A&client_source=web&stock_list=`;
  const json = await httpsGet(url);
  const list = json?.data?.list ?? [];
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

// ---------- 4.（P2-1）抓政策类快讯 → kv_store: policy:YYYY-MM-DD ----------
// 政策面是用户核心诉求"消息/政策/公告面"中最弱的一环（此前只有手动粘贴的 policyDiff）。
// 本函数：从东财快讯流中按政策关键词过滤（国务院/央行/证监会/发改委等），
// 落库 kv_store:policy:YYYY-MM-DD，前端 IntelligenceDashboard 可读取展示。
const POLICY_RE = /国务院|央行|证监会|发改委|财政部|工信部|商务部|金融监管总局|国家统计局|政策|规划|意见|通知|办法|实施方案|降准|降息|国常会|两会|专项债|新质生产力|扩大开放|减税|补贴/;
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
    }))
    .slice(0, 30);
}

// ---------- （P2-5）公告强催化识别：LLM 评分优先 + 扩展正则兜底 ----------
// 原 analyzeDaily 用 /业绩|中标|增持|回购|重组|突破|获批/ 粗筛，漏召回高
// （如"净利润同比+200%"不含这些词）。改为：配了 LLM Key 时对 top40 公告
// 一次调用打分（score≥4=强利好），LLM 不可用时用扩展关键词正则兜底。
const STRONG_ANN_RE = /业绩|中标|增持|回购|重组|突破|获批|净利润|同比|预增|增长|合同|订单|签约|股权|合资|扩产|涨价|产能|激励|分红|扭亏|减亏/;
// v9.32：黑天鹅公告（利空向）—— 盘前突发立案/退市/商誉减值等会让持仓秒跌停
const BLACK_ANN_RE = /立案|退市|商誉减值|被问询|警示函|行政处罚|预亏|业绩预减|减持|质押|违约|停牌核查|风险提示|控股股东|被列为失信|司法冻结/;
async function rankStrongAnnouncements(pool, dateStr) {
  const annR = await pool.query("SELECT * FROM announcements WHERE time >= $1 ORDER BY time DESC LIMIT 100", [dateStr]);
  const anns = annR.rows;
  const strongByRule = anns.filter(a => STRONG_ANN_RE.test(a.title || ""))
    .slice(0, 15).map(a => `${a.stock_name}:${a.title}`);

  // LLM 一次评分（仅配 key 时；失败静默走规则）
  const strongByLLM = [];
  if (process.env.AI_API_KEY && anns.length > 0) {
    try {
      const top40 = anns.slice(0, 40).map(a => `${a.stock_code} ${a.stock_name}: ${a.title}`).join("\n");
      const txt = await callLLM(`对以下公告逐条评分（1-5：5=重大利好必关注，4=强利好，3=中性偏多，≤2=无关/利空），只输出JSON数组，无其他文字：\n[{"code":"代码","score":4,"logic":"≤20字"}]\n\n公告列表：\n${top40}`);
      const cleaned = txt.replace(/```json|```/g, "").trim();
      const arr = JSON.parse(cleaned);
      if (Array.isArray(arr)) {
        for (const x of arr.slice(0, 15)) {
          if (Number(x.score) >= 4) {
            const a = anns.find(y => y.stock_code === String(x.code));
            strongByLLM.push(a ? `${a.stock_name}:${a.title}` : `code ${x.code}:${x.logic || ""}`);
          }
        }
      }
    } catch (e) {
      console.warn("[cron] 公告LLM评分失败，走规则:", e.message);
    }
  }
  return [...new Set([...strongByLLM, ...strongByRule])].slice(0, 15);
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
    // v9.28（P2-5）：强催化公告改用"LLM评分优先 + 扩展正则兜底"（替换原粗筛正则）
    const strongAnn = await rankStrongAnnouncements(pool, dateStr);

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

// ---------- v9.33（缺口2）：盘后自动复盘（15:40 后） ----------
// 读当日 zt_snapshot + news + announcements + black_swan，LLM 生成复盘落 kv_store:review:YYYY-MM-DD
async function generateDailyReview({ pool }) {
  try {
    const date = bjDate();
    const dateStr = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;

    // 1. 当日涨停池 → 主线分组（按 hybk 行业）
    const snapR = await pool.query("SELECT data FROM zt_snapshot WHERE date = $1 LIMIT 1", [dateStr]);
    const snap = snapR.rows[0]?.data ?? null;
    const poolArr = Array.isArray(snap?.pool) ? snap.pool : [];
    const themeMap = new Map();
    for (const p of poolArr) {
      const h = String(p.hybk || "未分类");
      if (!themeMap.has(h)) themeMap.set(h, []);
      themeMap.get(h).push(String(p.n || ""));
    }
    const themes = [...themeMap.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 6);
    const mainlines = themes.map(([t, arr]) => `${t}(${arr.length}只)${arr.slice(0, 3).join("/")}`).join("；") || "无";

    // 2. 强催化公告（读 analyze 已落库的结果）
    let strongAnn = [];
    try {
      const annR = await pool.query("SELECT value FROM kv_store WHERE key = $1", [`llm_analysis:${dateStr}`]);
      strongAnn = annR.rows[0]?.value?.strongAnn ?? [];
    } catch { /* ignore */ }

    // 3. 黑天鹅
    let blackSwans = "";
    try {
      const bsR = await pool.query("SELECT value FROM kv_store WHERE key = $1", [`black_swan:${dateStr}`]);
      const items = bsR.rows[0]?.value?.items ?? [];
      blackSwans = items.slice(0, 5).map(i => i.title).join("；");
    } catch { /* ignore */ }

    // 4. LLM 或规则版
    let reviewText = "";
    const system = `你是10年经验的A股游资复盘分析师。基于今日收盘数据做盘后复盘。严格按以下四个标题输出，禁止增减标题，每段≤4行：【今日主线回顾】【错过与教训】【明日关注清单】【风险提示】。直接输出正文。`;
    const userText = `日期：${dateStr}\n今日主线：${mainlines}\n涨停${poolArr.length}只\n强催化公告：${strongAnn.slice(0, 5).map(a => (a.stock_name || a.name || "") + ":" + (a.title || "")).join("；") || "无"}\n黑天鹅公告：${blackSwans || "无"}`;
    if (process.env.AI_API_KEY) {
      try { reviewText = await callLLM(userText, { system, maxTokens: 1000, temperature: 0.3 }); }
      catch (e) { reviewText = `【今日主线回顾】${mainlines}\n【错过与教训】LLM调用失败(${e.message})\n【明日关注清单】请稍后重试\n【风险提示】炸板数据见情绪卡`; }
    } else {
      reviewText = `【今日主线回顾】规则版：${mainlines}\n【错过与教训】未配置服务端 LLM Key\n【明日关注清单】请配置 AI_API_KEY 后自动生成\n【风险提示】涨停${poolArr.length}只`;
    }

    const review = { date: dateStr, mainlines, text: reviewText, createdAt: new Date().toISOString() };
    await pool.query(
      `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now())
       ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
      [`review:${dateStr}`, JSON.stringify(review)],
    );
    console.log(`[cron] review ${dateStr} saved`);
  } catch (e) {
    console.error("[cron] review failed:", e.message);
  }
}

// ---------- v9.33（缺口6）：板块资金流落库（行业全量双请求，供前端连续性/切换分析） ----------
// v9.30.2 教训：clist po=1 降序只拿到流入端，必须 po=1 + po=0 双请求合并
// v9.33.1：push2 对 nodejs 直连 TLS ban（socket hang up）；push2delay（延迟15分钟行情）node 可直连 → 改用 push2delay
const HOST_FUND = "https://push2delay.eastmoney.com";
async function fetchBoardFundServer() {
  const fs = encodeURIComponent("m:90+t:2");
  const fields = "f12,f14,f62";
  const urlOf = (po) => `${HOST_FUND}/api/qt/clist/get?ut=${EM_UT}&pn=1&pz=100&po=${po}&np=1&fltt=2&invt=2&fid=f62&fs=${fs}&fields=${fields}`;
  const norm = (j) => {
    const d = j?.data?.diff;
    if (Array.isArray(d)) return d;
    if (d && typeof d === "object") return Object.values(d);
    return [];
  };
  const merged = new Map();
  // 串行拉取（并发会限流）；失败降级（只有一端也能用）
  for (const po of [1, 0]) {
    try {
      const j = await httpsGet(urlOf(po));
      for (const it of norm(j)) {
        const code = String(it?.f12 ?? "");
        if (code) merged.set(code, { code, name: String(it?.f14 ?? ""), mainNet: Number(it?.f62 ?? 0) });
      }
    } catch (e) { console.warn(`[cron] fund po=${po} failed:`, e.message); }
  }
  return [...merged.values()].sort((a, b) => b.mainNet - a.mainNet);
}

// ---------- v9.33（缺口8）：大宗交易折价异动采集（datacenter RPT_DATA_BLOCKTRADE） ----------
// 折价大宗（折价 >8%）是股东减持强信号；T+1 数据（当日盘后次日才有完整数据）
async function fetchBlockTrades() {
  const url = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_DATA_BLOCKTRADE&columns=ALL&pageSize=200&source=WEB&client=WEB&sortColumns=TRADE_DATE&sortTypes=-1`;
  const j = await httpsGet(url);
  const rows = j?.result?.data ?? [];
  return rows.map(r => ({
    code: String(r.SECURITY_CODE ?? ""),
    name: String(r.SECURITY_NAME_ABBR ?? ""),
    price: Number(r.DEAL_PRICE ?? 0),
    closePrice: Number(r.CLOSE_PRICE ?? 0),
    premium: Number(r.PREMIUM_RATIO ?? 0) * 100,   // 折价率%（东财返回小数形式 0.097=9.7% 折价，负=折价）
    amount: Number(r.DEAL_AMT ?? 0),          // 成交额（元）
    volume: Number(r.DEAL_VOLUME ?? 0),
    buyer: String(r.BUYER_NAME ?? ""),
    seller: String(r.SELLER_NAME ?? ""),
  }));
}

// ---------- 启动定时任务 ----------
let cronBusy = false; // v9.26.10：防重叠执行（20min 任务与启动抓取/15:40 并发）
function startCron({ pool }) {
  // 交易日（周一到周五）15:40 收盘快照 + 分析
  cron.schedule("40 15 * * 1-5", async () => {
    console.log("[cron] 15:40 收盘快照 + 分析开始");
    if (cronBusy) { console.log("[cron] busy, skip 15:40"); return; }
    cronBusy = true;
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
    try { await analyzeDaily({ pool }); } catch (e) { console.error("[cron] analyze failed:", e.message); }
    // v9.35（S3）：市场日指标落库（信号回测数据源）
    try {
      const md = await fetchMarketDaily();
      await pool.query(
        `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now())
         ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
        [`market_daily:${md.date}`, JSON.stringify(md)],
      );
      console.log(`[cron] market_daily ${md.date}: 涨停${md.ztCount} 炸板${md.zbCount} 跌停${md.dtCount} 炸板率${md.blastedRate}%`);
    } catch (e) { console.error("[cron] market_daily failed:", e.message); }
    // v9.33（缺口2/6）：盘后自动复盘 + 板块资金流落库（连续性/切换分析数据源）
    try { await generateDailyReview({ pool }); } catch (e) { console.error("[cron] review failed:", e.message); }
    try {
      const funds = await fetchBoardFundServer();
      if (funds.length > 0) {
        const fDate = bjDate();
        const fDateStr = `${fDate.slice(0, 4)}-${fDate.slice(4, 6)}-${fDate.slice(6, 8)}`;
        await pool.query(
          `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now())
           ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
          [`fund_streak:${fDateStr}`, JSON.stringify({ date: fDateStr, items: funds })],
        );
        console.log(`[cron] fund_streak ${fDateStr}: ${funds.length} 行业`);
      }
    } catch (e) { console.error("[cron] fund_streak failed:", e.message); }
    // v9.33（缺口8）：大宗交易折价异动落库（盘后数据）
    try {
      const trades = await fetchBlockTrades();
      if (trades.length > 0) {
        const tDate = bjDate();
        const tDateStr = `${tDate.slice(0, 4)}-${tDate.slice(4, 6)}-${tDate.slice(6, 8)}`;
        await pool.query(
          `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now())
           ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
          [`block_trade:${tDateStr}`, JSON.stringify({ date: tDateStr, items: trades })],
        );
        console.log(`[cron] block_trade ${tDateStr}: ${trades.length} 笔`);
      }
    } catch (e) { console.error("[cron] block_trade failed:", e.message); }
    // v9.36（A3）：龙虎榜落库（涨停×龙虎榜交叉用）
    try {
      const lhb = await fetchLhbDaily();
      if (lhb.length > 0) {
        const lDate = bjDate();
        const lDateStr = `${lDate.slice(0, 4)}-${lDate.slice(4, 6)}-${lDate.slice(6, 8)}`;
        await pool.query(
          `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now())
           ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
          [`lhb:${lDateStr}`, JSON.stringify({ date: lDateStr, items: lhb })],
        );
        console.log(`[cron] lhb ${lDateStr}: ${lhb.length} 只`);
      }
    } catch (e) { console.error("[cron] lhb failed:", e.message); }
    cronBusy = false;
  }, { timezone: "Asia/Shanghai" });

  // 交易日每 20 分钟抓快讯+公告自动落库（9:00 - 16:40，v9.26.10 修正 */20 9-16 会在 16:40 触发却注释到 16:30）
  cron.schedule("*/20 9-16 * * 1-5", async () => {
    if (cronBusy) { console.log("[cron] busy, skip 20min fetch"); return; }
    cronBusy = true;
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
               ON CONFLICT(code) DO UPDATE SET title=$2,summary=$3,time=$8,url=$9`,
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

      // v9.28（P2-1）：政策类快讯落库（kv_store: policy:YYYY-MM-DD）
      try {
        const policies = await fetchPolicyNews();
        if (policies.length > 0) {
          const pDate = bjDate();
          const pDateStr = `${pDate.slice(0, 4)}-${pDate.slice(4, 6)}-${pDate.slice(6, 8)}`;
          await pool.query(
            `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now())
             ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
            [`policy:${pDateStr}`, JSON.stringify({ date: pDateStr, items: policies })],
          );
          console.log(`[cron] policy ${pDateStr}: ${policies.length} 条`);
        }
      } catch (e) { console.error("[cron] policy fetch failed:", e.message); }

      // v9.32：黑天鹅公告落库（kv_store: black_swan:YYYY-MM-DD）—— 利空向公告实时采集
      try {
        const blackSwans = anns.filter(a => BLACK_ANN_RE.test(a.title || ""));
        if (blackSwans.length > 0) {
          const bsDate = bjDate();
          const bsDateStr = `${bsDate.slice(0, 4)}-${bsDate.slice(4, 6)}-${bsDate.slice(6, 8)}`;
          await pool.query(
            `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now())
             ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
            [`black_swan:${bsDateStr}`, JSON.stringify({ date: bsDateStr, items: blackSwans.map(a => ({ code: a.stockCode, name: a.stockName, title: a.title, time: a.time, url: a.url })) })],
          );
          console.log(`[cron] black_swan ${bsDateStr}: ${blackSwans.length} 条`);
        }
      } catch (e) { console.error("[cron] black_swan fetch failed:", e.message); }
    } catch (e) { console.error("[cron] fetch failed:", e.message); }

    // v9.38（V3-11）：盘中市场快照（每小时一次，加速回测样本）
    try {
      const md = await fetchMarketIntraday();
      const iDate = bjDate();
      const iDateStr = `${iDate.slice(0, 4)}-${iDate.slice(4, 6)}-${iDate.slice(6, 8)}`;
      await pool.query(
        `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now())
         ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
        [`market_intraday:${iDateStr}`, JSON.stringify(md)],
      );
    } catch (e) { console.error("[cron] intraday snapshot failed:", e.message); }
    cronBusy = false;
  }, { timezone: "Asia/Shanghai" });

  // 启动时立即抓取一次（验证 + 补数据：涨停快照 + 快讯 + 公告 + 政策 全部入库）
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

    // v9.28（P2-1）：启动即补政策数据
    try {
      const policies = await fetchPolicyNews();
      if (policies.length > 0) {
        const pDate = bjDate();
        const pDateStr = `${pDate.slice(0, 4)}-${pDate.slice(4, 6)}-${pDate.slice(6, 8)}`;
        await pool.query(
          `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now())
           ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
          [`policy:${pDateStr}`, JSON.stringify({ date: pDateStr, items: policies })],
        );
        console.log(`[cron] 启动政策入库 ${pDateStr}: ${policies.length} 条`);
      }
    } catch (e) { console.error("[cron] 启动政策失败:", e.message); }

    await analyzeDaily({ pool });
    // v9.33（缺口2/6/8）：启动即补 复盘 + 资金流 + 大宗交易（容错，任一失败不阻塞）
    try { await generateDailyReview({ pool }); } catch (e) { console.error("[cron] 启动复盘失败:", e.message); }
    try {
      const funds = await fetchBoardFundServer();
      if (funds.length > 0) {
        const fDate = bjDate();
        const fDateStr = `${fDate.slice(0, 4)}-${fDate.slice(4, 6)}-${fDate.slice(6, 8)}`;
        await pool.query(
          `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now())
           ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
          [`fund_streak:${fDateStr}`, JSON.stringify({ date: fDateStr, items: funds })],
        );
        console.log(`[cron] 启动资金流入库 ${fDateStr}: ${funds.length} 行业`);
      }
    } catch (e) { console.error("[cron] 启动资金流失败:", e.message); }
    try {
      const trades = await fetchBlockTrades();
      if (trades.length > 0) {
        const tDate = bjDate();
        const tDateStr = `${tDate.slice(0, 4)}-${tDate.slice(4, 6)}-${tDate.slice(6, 8)}`;
        await pool.query(
          `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now())
           ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
          [`block_trade:${tDateStr}`, JSON.stringify({ date: tDateStr, items: trades })],
        );
        console.log(`[cron] 启动大宗交易入库 ${tDateStr}: ${trades.length} 笔`);
      }
    } catch (e) { console.error("[cron] 启动大宗交易失败:", e.message); }
  }, 3000);

  console.log("[cron] scheduled: 15:40 快照+分析+复盘 · 每20分钟抓快讯/公告/政策 · Asia/Shanghai");
};

// 导出抓取函数供验证/手动触发用
module.exports = startCron;
module.exports.fetchZTPool = fetchZTPool;
module.exports.fetchFastNews = fetchFastNews;
module.exports.fetchAnnouncements = fetchAnnouncements;
module.exports.fetchPolicyNews = fetchPolicyNews;
module.exports.analyzeDaily = analyzeDaily;
module.exports.generateDailyReview = generateDailyReview;
module.exports.fetchBoardFundServer = fetchBoardFundServer;
module.exports.fetchBlockTrades = fetchBlockTrades;
module.exports.fetchMarketDaily = fetchMarketDaily;
module.exports.fetchLhbDaily = fetchLhbDaily;
module.exports.fetchMarketIntraday = fetchMarketIntraday;
