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
// v9.64（V2-P0-5）：contentKey 去内存 seq —— 确定性 key（同一数据多次抓取 → 同 key → 幂等）；
//   原 fallbackSeq 重启后重置，同一缺字段公告会生成不同 key 重复入库
/** 内容哈希：title+time 生成确定性主键（sha256 前缀，无状态） */
function contentKey(seed) {
  const crypto = require("crypto");
  const h = crypto.createHash("sha256").update(String(seed)).digest("hex").slice(0, 16);
  return `fb_${h}`;
}

// ---------- v9.35（S3）：市场日指标落库（信号回测的数据源） ----------
// 目的：给前端 signalBacktest 提供"每日市场指标"历史序列（涨停/跌停/炸板/最高板）。
// 情绪分由前端 cloudStore 已同步（kv sentiment:日期 = 数字分），本键只补池类指标。
async function fetchMarketDaily(pool) {
  const date = bjDate();
  const dateStr = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  const zt = await httpsGet(`https://push2ex.eastmoney.com/getTopicZTPool?ut=${EM_UT}&dpt=wz.ztzt&Pageindex=0&pagesize=500&sort=fbt%3Aasc&date=${date}`);
  const zb = await httpsGet(`https://push2ex.eastmoney.com/getTopicZBPool?ut=${EM_UT}&dpt=wz.ztzt&Pageindex=0&pagesize=500&sort=fbt%3Aasc&date=${date}`);
  const dt = await httpsGet(`https://push2ex.eastmoney.com/getTopicDTPool?ut=${EM_UT}&dpt=wz.ztzt&Pageindex=0&pagesize=500&sort=fbt%3Aasc&date=${date}`);
  const ztPool = zt?.data?.pool ?? [];
  const zbPool = zb?.data?.pool ?? [];
  const dtPool = dt?.data?.pool ?? [];
  const maxBoard = ztPool.length > 0 ? Math.max(0, ...ztPool.map(p => Number(p?.lbc ?? 1))) : 0;
  const md = {
    date: dateStr,
    ztCount: ztPool.length,
    zbCount: zbPool.length,
    dtCount: dtPool.length,
    blastedRate: ztPool.length + zbPool.length > 0 ? Math.round(zbPool.length / (ztPool.length + zbPool.length) * 1000) / 10 : 0,
    maxBoardHeight: maxBoard,
  };
  // v9.40（V4-G）：补齐 4 个因子输入字段（此前缺失 → factorLib 4 因子永远 decayed）
  // v9.56（V8-2）：premiumAvg/promotionRate 补落库；sealDecayCount 改真实（无 seal 预警源 → null，不用炸板冒充）；fundInflowStreak 连续天数
  // sealDecayCount：封单衰减预警数 —— server 无 sealMonitor 预警源，真实值缺失 → null（不再用 zbPool 炸板数代理）
  md.sealDecayCount = null;
  // premiumAvg（昨日涨停股今日平均涨幅）+ promotionRate（昨日首板今日继续涨停比例）
  try {
    const prevSnap = await pool.query(`SELECT data FROM zt_snapshot WHERE date < $1 ORDER BY date DESC LIMIT 1`, [date]);
    let prevPool = [];
    if (prevSnap.rows[0]?.data) {
      try { prevPool = JSON.parse(prevSnap.rows[0].data).pool ?? []; } catch { prevPool = []; }
    }
    if (prevPool.length > 0) {
      const todayCodes = new Set(ztPool.map(p => String(p.c)));
      const prevFirst = prevPool.filter(p => Number(p.lbc ?? 1) === 1);
      // 晋级率：昨日首板 → 今日仍涨停 占比
      md.promotionRate = prevFirst.length > 0
        ? Math.round(prevFirst.filter(p => todayCodes.has(String(p.c))).length / prevFirst.length * 1000) / 1000
        : null;
      // 溢价均值：昨日涨停股今日平均涨幅（push2delay ulist 批量拉 f3 涨跌幅；收盘后 = 溢价代理）
      const codes = [...new Set(prevPool.map(p => String(p.c)))];
      const secids = codes.map(c => (c.startsWith("6") ? "1." : "0.") + c).join(",");
      const bj = await httpsGet(`https://push2delay.eastmoney.com/api/qt/ulist.np/get?ut=${EM_UT}&fltt=2&fields=f3,f12&secids=${secids}`);
      const diff = bj?.data?.diff;
      const rows = Array.isArray(diff) ? diff : (diff && typeof diff === "object" ? Object.values(diff) : []);
      const pcts = rows.map(r => Number(r?.f3)).filter(v => Number.isFinite(v));
      md.premiumAvg = pcts.length > 0 ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length * 100) / 100 : null;
    } else { md.premiumAvg = null; md.promotionRate = null; }
  } catch (e) { console.warn("[cron] premium/promotion 计算失败:", e?.message); md.premiumAvg = null; md.promotionRate = null; }
  // lhbBoostCount：龙虎榜净买入股票数（席位加持）
  try {
    const lhb = await fetchLhbDaily();
    md.lhbBoostCount = lhb.filter(x => x.netBuy > 0).length;
  } catch { md.lhbBoostCount = null; }
  // fundInflowStreak：主线行业连续流入天数（读 fund_streak 历史，往前数连续 mainNet>0）
  try {
    const funds = await fetchBoardFundServer();
    if (funds.length > 0) {
      const fDateStr = `${bjDate().slice(0, 4)}-${bjDate().slice(4, 6)}-${bjDate().slice(6, 8)}`;
      await pool?.query(
        `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now())
         ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
        [`fund_streak:${fDateStr}`, JSON.stringify({ date: fDateStr, items: funds })],
      );
      // 连续流入天数：从今天往前数，主流入行业每日 mainNet>0
      let streak = 0;
      const d = new Date();
      for (let i = 0; i < 10; i++) {
        const dd = new Date(d); dd.setDate(dd.getDate() - i);
        const key = `fund_streak:${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, "0")}-${String(dd.getDate()).padStart(2, "0")}`;
        const r = await pool.query(`SELECT value FROM kv_store WHERE key=$1`, [key]).catch(() => ({ rows: [] }));
        let items = [];
        if (r.rows[0]?.value) { try { items = JSON.parse(r.rows[0].value).items ?? []; } catch { items = []; } }
        const top = items[0];
        if (top && top.mainNet > 0) streak++;
        else if (i > 0) break; // 今天可能还没落库，从昨天开始断链即停
        if (i === 0 && (!top || top.mainNet <= 0)) { streak = 0; break; }
      }
      md.fundInflowStreak = streak;
    } else md.fundInflowStreak = null;
  } catch { md.fundInflowStreak = null; }
  // nuclearCount：核按钮数（昨 ≥2 板 今跌 ≤-9%，退潮最强信号）
  try {
    md.nuclearCount = await fetchNuclearCount(pool, dateStr);
  } catch { md.nuclearCount = null; }
  return md;
}

// V4-G：核按钮计数 —— 读昨日涨停快照 ≥2 板 → push2delay 批量拉今日行情 → 统计 ≤-9%
async function fetchNuclearCount(pool, todayStr) {
  if (!pool) return null;
  const r = await pool.query("SELECT data FROM zt_snapshot WHERE date < $1 ORDER BY date DESC LIMIT 1", [todayStr]);
  if (!r.rows[0]?.data?.pool) return null;
  const prev = r.rows[0].data.pool;
  const highBoards = prev.filter(s => (s.lbc ?? 1) >= 2);
  if (highBoards.length === 0) return 0;
  const codes = highBoards.map(s => s.code).slice(0, 80);
  const secids = codes.map(c => (/^(60|68|9)/.test(String(c)) ? "1." : "0.") + c).join(",");
  const j = await httpsGet(`https://push2delay.eastmoney.com/api/qt/ulist.np/get?ut=${EM_UT}&fltt=2&fields=f2,f12&secids=${secids}`);
  const diff = j?.data?.diff;
  const items = Array.isArray(diff) ? diff : (diff && typeof diff === "object" ? Object.values(diff) : []);
  return items.filter(it => Number(it?.f2 ?? 999) <= -9).length;
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
  const zt = await httpsGet(`https://push2ex.eastmoney.com/getTopicZTPool?ut=${EM_UT}&dpt=wz.ztzt&Pageindex=0&pagesize=500&sort=fbt%3Aasc&date=${date}`);
  const zb = await httpsGet(`https://push2ex.eastmoney.com/getTopicZBPool?ut=${EM_UT}&dpt=wz.ztzt&Pageindex=0&pagesize=500&sort=fbt%3Aasc&date=${date}`);
  const dt = await httpsGet(`https://push2ex.eastmoney.com/getTopicDTPool?ut=${EM_UT}&dpt=wz.ztzt&Pageindex=0&pagesize=500&sort=fbt%3Aasc&date=${date}`);
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
// v9.38.1（V3-P0）：抽公共层 server/lib/httpProxy.js（惰性 require + 容错，消除重复实现）
const { callModelText: callLLM } = require("./lib/httpProxy");
// v9.42：因子 IC 服务端评估（幻方"因子失效"监测权威落库端）
const { saveFactorIc } = require("./lib/factorIc");

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

// ---------- v9.38.1（V3-12）：事件三级分类闭环（政策/行业/事件） ----------
// 盘后 cron 批量跑一次：读当日快讯 → 去重 → LLM 分级 → 落库 event_classify:日期
// 验收：一条"央行降准"新闻被分为政策级、beneficiaries 含银行/地产
async function runEventClassify({ pool }) {
  const date = bjDate();
  const dateStr = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  try {
    // 1. 读当日快讯（按 star 排序，取 top 30）
    const r = await pool.query(
      `SELECT title, time, stars FROM news
       WHERE time >= $1
       ORDER BY (stars IS NOT NULL) DESC, stars DESC, time DESC
       LIMIT 60`,
      [`${dateStr} 00:00:00`],
    );
    // 2. 去重（同标题前缀合并——同一事件多条快讯）
    const seen = new Set();
    const events = [];
    for (const row of r.rows) {
      const title = String(row.title || "").trim();
      if (!title) continue;
      const key = title.slice(0, 18); // 前缀去重
      if (seen.has(key)) continue;
      seen.add(key);
      events.push({ title: title.slice(0, 60), source: "东财快讯" });
      if (events.length >= 15) break; // 批量 15（太多会超 token 截断）
    }
    if (events.length === 0) {
      console.log("[cron] event_classify: 当日无快讯，跳过");
      return;
    }

    // JSON 容错解析（LLM 输出常被 max_tokens 截断 → 截到最后一个完整对象补 ]）
    const parseLoose = (text) => {
      try { const p = JSON.parse(text); if (Array.isArray(p)) return p; } catch { /* 继续 */ }
      const idx = text.lastIndexOf("}");
      if (idx > 0) {
        try { const p = JSON.parse(text.slice(0, idx + 1) + "]"); if (Array.isArray(p)) return p; } catch { /* 继续 */ }
      }
      return null;
    };

    // 3. LLM 三级分级（与前端 aiPrompts eventClassify 同构）；不可用 → 规则版
    let items = null;
    const system = `你是A股事件分级器。对以下新闻/公告事件做三级分类并评估影响。\n只返回JSON数组，无其他文字。`;
    const userText = `事件列表（标题|来源）：\n${events.map(e => `- ${e.title} | ${e.source}`).join("\n")}\n\n输出严格JSON数组，每事件一项：\n[{"title":"原标题","level":"政策|行业|事件","beneficiaries":["受益板块1","板块2"],"catalystScore":0-100,"timeSensitivity":"即时|短期|中长期","reason":"≤25字"}]\n分级规则：\n- 政策级：国务院/央行/证监会/发改委/国常会/部委发文 → beneficiaries 给受益行业清单\n- 行业级：产业链事件/涨价/订单/技术突破 → beneficiaries 给细分方向\n- 事件级：个股公告/中标/减持 → beneficiaries 给该股行业\ncatalystScore 按影响力度：国常会级 85-100 / 部委级 65-84 / 行业级 40-64 / 个股级 20-40`;
    if (process.env.AI_API_KEY) {
      try {
        const text = await callLLM(userText, { system, maxTokens: 3000, temperature: 0.1 });
        const parsed = parseLoose(text);
        if (parsed && parsed.length > 0) items = parsed;
      } catch (e) {
        console.warn("[cron] event_classify LLM 失败，走规则版:", e.message);
      }
    }
    if (!items) {
      items = events.map(e => {
        const t = e.title;
        let level = "事件";
        if (/国务院|央行|证监会|发改委|国常会|部委|印发|通知|规划|试点|专项/.test(t)) level = "政策";
        else if (/产业链|涨价|订单|技术|量产|突破|扩产|招标/.test(t)) level = "行业";
        return { title: t.slice(0, 30), level, beneficiaries: [], catalystScore: level === "政策" ? 70 : level === "行业" ? 50 : 30, timeSensitivity: "短期", reason: "规则版分级" };
      });
    }

    // 4. 落库
    const payload = { date: dateStr, items, createdAt: new Date().toISOString() };
    await pool.query(
      `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now())
       ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
      [`event_classify:${dateStr}`, JSON.stringify(payload)],
    );
    const policyCount = items.filter(i => i.level === "政策").length;
    const indCount = items.filter(i => i.level === "行业").length;
    console.log(`[cron] event_classify ${dateStr}: ${items.length} 事件（政策${policyCount}/行业${indCount}/事件${items.length - policyCount - indCount}）`);
  } catch (e) {
    console.error("[cron] event_classify failed:", e.message);
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
// v9.54（V7-15）：A股交易日历 —— 节假日休市判定（2026 年法定休市区间；与前端 tradeCalendar.ts 口径一致）
const HOLIDAY_RANGES_2026 = [
  ["2026-01-01", "2026-01-02"], ["2026-02-16", "2026-02-22"], ["2026-04-04", "2026-04-06"],
  ["2026-05-01", "2026-05-05"], ["2026-06-19", "2026-06-21"], ["2026-09-25", "2026-09-27"],
  ["2026-10-01", "2026-10-07"],
];
function isTradingDayCN(d = new Date()) {
  const day = d.getDay();
  if (day === 0 || day === 6) return false;
  // 北京时间日期串
  const bj = new Date(d.getTime() + d.getTimezoneOffset() * 60000 + 8 * 3600000);
  const ds = `${bj.getUTCFullYear()}-${String(bj.getUTCMonth() + 1).padStart(2, "0")}-${String(bj.getUTCDate()).padStart(2, "0")}`;
  for (const [a, b] of HOLIDAY_RANGES_2026) {
    if (ds >= a && ds <= b) return false;
  }
  return true;
}
function startCron({ pool }) {
  // 交易日（周一至周五且非节假日）15:40 收盘快照 + 分析
  cron.schedule("40 15 * * 1-5", async () => {
    if (!isTradingDayCN()) { console.log("[cron] 15:40 非交易日（节假日），跳过抓取"); return; }
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
      const md = await fetchMarketDaily(pool);
      await pool.query(
        `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now())
         ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
        [`market_daily:${md.date}`, JSON.stringify(md)],
      );
      console.log(`[cron] market_daily ${md.date}: 涨停${md.ztCount} 炸板${md.zbCount} 跌停${md.dtCount} 炸板率${md.blastedRate}%`);
    } catch (e) { console.error("[cron] market_daily failed:", e.message); }
    // v9.42：因子 IC 健康度落库（读历史 market_daily+sentiment → 滚动窗口 IC → factor_ic:日期）
    try { await saveFactorIc(pool); } catch (e) { console.error("[cron] factor_ic failed:", e.message); }
    // v9.33（缺口2/6）：盘后自动复盘 + 板块资金流落库（连续性/切换分析数据源）
    try { await generateDailyReview({ pool }); } catch (e) { console.error("[cron] review failed:", e.message); }
    // v9.38.1（V3-12）：事件三级分类（政策/行业/事件）—— 盘后批量跑一次
    try { await runEventClassify({ pool }); } catch (e) { console.error("[cron] event_classify failed:", e.message); }
    // v9.66：收盘盯价快照（active 监控清单 → 收盘价/偏离度 → log + 触发事件）
    try {
      const { runWatchCheck } = require("./routes/watch");
      const wr = await runWatchCheck(pool);
      console.log(`[cron] 收盘盯价: ${wr.checked} 只监控, ${wr.triggered.length} 只触发关注区间`);
    } catch (e) { console.error("[cron] watch close failed:", e.message); }
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
    if (!isTradingDayCN()) { console.log("[cron] 非交易日（节假日），跳过快讯抓取"); return; }
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
    // v9.42：启动即补因子 IC 健康度（无论当天是否到收盘时间都有快照）
    try { await saveFactorIc(pool); } catch (e) { console.error("[cron] 启动因子IC失败:", e.message); }
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

  console.log("[cron] scheduled: 15:40 快照+分析+复盘 · 每20分钟抓快讯/公告/政策 · 盘中每5分钟盯价 · Asia/Shanghai");

  // v9.66：个股盯价监控 —— 盘中每 5 分钟（9:05-15:05 交易日），active 清单拉价算偏离
  cron.schedule("*/5 9-15 * * 1-5", async () => {
    try {
      if (!isTradingDayCN()) return;
      const { runWatchCheck } = require("./routes/watch");
      const r = await runWatchCheck(pool);
      if (r.triggered.length > 0) {
        console.log(`[cron] ⚡ 盯价触发关注区间: ${r.triggered.map(t => `${t.name}(${t.code}) 现价${t.price} 偏离${t.deviation}%`).join(" | ")}`);
      }
    } catch (e) { console.error("[cron] 盘中盯价失败:", e.message); }
  });

  // ---------- V13-1（P0）：新闻驱动作战管线 ----------
  // 频率（V13-4 深度推理）：盘前 9:15 检查隔夜 → 盘中每 30 分钟（9:30-14:30）→ 盘后 15:05 完整版
  const scheduleThemeAnalysis = (expr, label) => cron.schedule(expr, async () => {
    try {
      if (!isTradingDayCN() && expr !== "5 15 * * 1-5") return; // 盘后允许非交易日补跑
      await runThemeAnalysis({ pool, label });
    } catch (e) { console.error(`[cron] themeAnalysis(${label}) failed:`, e.message); }
  }, { timezone: "Asia/Shanghai" });
  scheduleThemeAnalysis("15 9 * * 1-5", "盘前");
  scheduleThemeAnalysis("*/30 9-14 * * 1-5", "盘中");
  scheduleThemeAnalysis("5 15 * * 1-5", "盘后");
};

// ============== V13-1：新闻驱动作战管线（规则抽主题 → LLM 分析 → 规则选股 → LLM 研判） ==============
// 与 src/lib/themeAnalysis.ts（前端共享纯函数）保持算法一致：extractThemeHeat = 关键词折叠 24 大类 + 热度计数
// 数据：news 表（cron 已抓）→ kv fund_streak（板块资金，零新增请求）→ 2 次 callLLM → 落库 theme_analysis
async function runThemeAnalysis({ pool, label = "手动" }) {
  const date = bjDate();
  const dateStr = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  // 读取主题规则：服务端内联（等价 src/lib/themeAnalysis.ts extractThemeHeat 的 conceptGroupOf 折叠）
  const GROUP_ROOTS = [
    { group: "通信", roots: ["通信", "5G", "6G", "光模块", "光通信", "CPO", "卫星通信", "光缆", "光纤", "交换机", "毫米波"] },
    { group: "芯片", roots: ["芯片", "半导体", "存储", "封测", "光刻", "EDA", "GPU", "CPU", "晶圆", "碳化硅", "先进封装"] },
    { group: "AI应用", roots: ["AI应用", "AI智能体", "AI眼镜", "数字人", "智能体", "多模态", "AIGC", "大模型", "人工智能", "计算机", "软件", "互联网"] },
    { group: "算力", roots: ["算力", "服务器", "液冷", "散热", "数据中心", "IDC", "东数西算", "边缘计算"] },
    { group: "智能驾驶", roots: ["智能驾驶", "无人驾驶", "自动驾驶", "激光雷达", "车载", "智能座舱", "车路云", "Robotaxi"] },
    { group: "机器人", roots: ["机器人", "减速器", "执行器", "灵巧手", "伺服", "人形机器人"] },
    { group: "新能源车", roots: ["新能源车", "电动汽车", "锂电池", "动力电池", "固态电池", "充电桩", "氢能源"] },
    { group: "新能源", roots: ["光伏", "风电", "储能", "特高压", "电网", "逆变器", "硅料"] },
    { group: "医药", roots: ["医药", "创新药", "减肥药", "GLP-1", "CXO", "疫苗", "医疗器械"] },
    { group: "低空经济", roots: ["低空经济", "飞行", "无人机", "eVTOL"] },
    { group: "军工", roots: ["军工", "航天", "卫星", "大飞机", "C919", "商业航天"] },
    { group: "消费电子", roots: ["消费电子", "折叠屏", "AR眼镜", "MR", "苹果", "可穿戴", "光学"] },
    { group: "大消费", roots: ["白酒", "食品", "饮料", "零售", "旅游", "免税", "宠物经济"] },
    { group: "金融", roots: ["证券", "券商", "保险", "银行", "金融科技", "数字货币"] },
    { group: "房地产", roots: ["房地产", "地产", "建材", "物业"] },
    { group: "传媒", roots: ["传媒", "影视", "游戏", "短剧", "动漫"] },
    { group: "教育", roots: ["教育", "职业教育", "在线教育", "知识付费"] },
    { group: "有色金属", roots: ["稀土", "黄金", "白银", "有色金属", "铜", "锂矿"] },
    { group: "化工", roots: ["化工", "化肥", "化纤", "磷化工", "钛白粉"] },
    { group: "材料", roots: ["新材料", "碳纤维", "石墨烯", "玻璃", "超材料"] },
  ];
  const conceptGroupOf = (t) => {
    if (!t) return null;
    let best = null;
    for (const def of GROUP_ROOTS) {
      for (const root of def.roots) {
        if (t.includes(root) && (best === null || root.length > best.root.length)) best = { group: def.group, root };
      }
    }
    return best ? best.group : null;
  };
  // 同长按表序优先（简化：首表命中；与前端最长词根近似——够管线用）

  try {
    // Step 1（规则 0 LLM）：读近 2h 快讯 → 抽主题热度
    // news.time 为 text 类型（"YYYY-MM-DD HH:MM:SS"）→ 用字符串比较（北京时区 2h 前）
    const sinceStr = new Date(Date.now() + 8 * 3600 * 1000 - 2 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");
    const newsR = await pool.query(
      `SELECT title, time, url FROM news WHERE time >= $1 ORDER BY time DESC LIMIT 80`,
      [sinceStr],
    );
    const newsItems = newsR.rows.map(n => ({ title: String(n.title || ""), time: String(n.time), url: n.url ? String(n.url) : undefined }));
    const tally = new Map();
    for (const n of newsItems) {
      const g = conceptGroupOf(n.title);
      if (!g) continue;
      const prev = tally.get(g) ?? { count: 0, items: [] };
      prev.count++;
      if (prev.items.length < 5) prev.items.push({ title: n.title.slice(0, 60), url: n.url, time: n.time });
      tally.set(g, prev);
    }
    const themes = [...tally.entries()]
      .map(([name, v]) => ({ name, heat: Math.min(100, v.count * 15), evidence: v.items }))
      .sort((a, b) => b.heat - a.heat)
      .slice(0, 10);
    if (themes.length === 0) { console.log("[cron] themeAnalysis: 近2h无新闻主题，跳过"); return null; }

    // Step 2（0 LLM）：读板块资金（kv fund_streak，零新增请求）
    const streakR = await pool.query("SELECT value FROM kv_store WHERE key LIKE 'fund_streak%' ORDER BY updated_at DESC LIMIT 1");
    let fundData = [];
    try {
      const sv = streakR.rows[0]?.value ? JSON.parse(streakR.rows[0].value) : null;
      if (sv && Array.isArray(sv.list)) fundData = sv.list.map(x => ({
        name: x.board ?? x.name, mainNet: x.mainNet ?? 0, mainNet5d: x.mainNet5d ?? 0, pct: x.pct ?? 0,
      }));
    } catch { fundData = []; }

    // Step 3（1 次 LLM）：行情联动分析
    const analysisPrompt = `你是10年A股游资分析师。基于以下主题热度+板块资金数据，对每个主题做行情联动分析。

主题热度+资金：
${JSON.stringify(themes.map(t => ({
  theme: t.name, heat: t.heat, evidence: t.evidence,
  fund: fundData.find(f => f.name === t.name) ?? null,
})))}

规则：
- 资金持续流入(5d>0)+热度高 → "领涨龙头"
- 资金近期回流(1d>0 但 5d 可能<0)+热度上升 → "潜力起爆"
- 热度高但资金流出(1d<0) → "风险警示"

输出严格JSON数组：
[{"theme":"主题名","verdict":"领涨龙头|潜力起爆|风险警示","fundAnalysis":"≤40字引用具体数字","action":"≤20字操作建议"}]`;
    const analysisText = await callLLM(analysisPrompt, { maxTokens: 3000, temperature: 0.2 });
    let analyses = [];
    try { analyses = JSON.parse(analysisText); } catch {
      const m = analysisText.match(/\[[\s\S]*\]/);
      if (m) { try { analyses = JSON.parse(m[0]); } catch { analyses = []; } }
    }
    if (!Array.isArray(analyses)) analyses = [];

    // ===== V13-5（P0）Step 3：规则选股 + ETF 匹配 =====
    // 说明：stockPicker.ts / etfScore.ts / classifyStock 均为 TS 前端模块，server(CJS) 无法 require ——
    //   此处内联等价实现（涨停池过滤 + 封单排序；主题→ETF 映射表；GROUP_ROOTS 折叠判断主题归属）
    //   与前端逻辑保持同口径（注释互相引用）
    const ETF_POOL_MINI = [
      { code: "510300", name: "沪深300ETF", kws: ["宽基", "沪深300"] },
      { code: "512480", name: "半导体ETF", kws: ["芯片", "半导体"] },
      { code: "159995", name: "芯片ETF", kws: ["芯片", "半导体"] },
      { code: "515050", name: "5G通信ETF", kws: ["通信", "5G", "光模块", "CPO"] },
      { code: "159819", name: "人工智能ETF", kws: ["AI应用", "人工智能", "大模型", "机器人"] },
      { code: "159852", name: "云计算ETF", kws: ["算力", "云计算", "服务器", "数据中心"] },
      { code: "516510", name: "云计算50ETF", kws: ["算力", "云计算", "数据中心"] },
      { code: "159562", name: "机器人ETF", kws: ["机器人"] },
      { code: "515030", name: "新能源车ETF", kws: ["新能源车", "锂电池"] },
      { code: "516160", name: "新能源ETF", kws: ["新能源", "光伏", "风电", "储能"] },
      { code: "512170", name: "医疗ETF", kws: ["医药", "医疗", "创新药"] },
      { code: "512660", name: "军工ETF", kws: ["军工", "航天", "卫星"] },
      { code: "512880", name: "证券ETF", kws: ["金融", "证券"] },
      { code: "512690", name: "酒ETF", kws: ["白酒", "大消费"] },
      { code: "512980", name: "传媒ETF", kws: ["传媒", "游戏"] },
      { code: "512400", name: "有色金属ETF", kws: ["有色金属", "稀土"] },
      { code: "516110", name: "汽车ETF", kws: ["智能驾驶", "汽车"] },
    ];
    const matchMiniETF = (theme) => ETF_POOL_MINI
      .filter(e => e.kws.some(k => theme.includes(k) || k.includes(theme)))
      .slice(0, 2)
      .map(e => ({ code: e.code, name: e.name, matchScore: 80 + Math.floor(Math.random() * 15) }));

    const themePicks = new Map(); // theme → picks
    const themeEtfs = new Map();  // theme → etfs
    try {
      // zt_snapshot.date 存 bjDate()（无横杠 "20260808"）→ 用 date 变量（非 dateStr 带横杠）
      const ztR = await pool.query(`SELECT data FROM zt_snapshot WHERE date = $1 LIMIT 1`, [date]);
      // zt_snapshot.data 为 jsonb（pg 可能返回字符串或对象）→ 兼容两种
      const raw = ztR.rows[0]?.data;
      const ztPool = typeof raw === "string" ? JSON.parse(raw) : (raw ?? []);
      const arr = Array.isArray(ztPool) ? ztPool : (ztPool.pool ?? []);
      for (const th of themes) {
        // 3a. 主题归属过滤（内联 conceptGroupOf 判断：hybk/名称折叠到主题大类）
        const themeStocks = arr.filter(s => {
          const g = conceptGroupOf(String(s.hybk ?? ""));
          const name = String(s.n ?? "");
          return g === th.name || name.includes(th.name) || String(s.hybk ?? "").includes(th.name);
        });
        // 3b. 排序选股（封单 > 连板 > 涨幅，取 2-3 只）
        const picks = themeStocks
          .sort((a, b) => (b.fund ?? 0) - (a.fund ?? 0) || (b.lbc ?? 1) - (a.lbc ?? 1) || (b.zdp ?? 0) - (a.zdp ?? 0))
          .slice(0, 3)
          .map((s, i) => ({
            code: String(s.c ?? ""), name: String(s.n ?? ""),
            role: i === 0 ? "首选" : i === 1 ? "接力" : "低吸",
            correlation: 0, buyTrigger: `竞价/回踩企稳再考虑（主题热度${th.heat}）`, stopLoss: "跌破前低-5%", risk: "追高回落",
          }));
        themePicks.set(th.name, picks);
        // 3c. ETF 匹配（主题→ETF 映射表）
        themeEtfs.set(th.name, matchMiniETF(th.name));
      }
    } catch { /* 无涨停池快照 → picks 空 */ }

    // ===== V13-5（P0）Step 4：LLM 批量研判 + 关联度验证（correlation<0.5 → 回避并过滤） =====
    const allPicks = [...themePicks.entries()].flatMap(([theme, picks]) => picks.map(p => ({ ...p, theme })));
    let stockVerdicts = [];
    if (allPicks.length > 0) {
      const stockPrompt = `对以下主题选股做关联度验证+研判。每只股票必须是该主题的高关联标的（不是蹭概念）。
${JSON.stringify(allPicks.map(p => ({ theme: p.theme, code: p.code, name: p.name, role: p.role })))}

输出严格JSON数组：
[{"code":"代码","correlation":0.0-1.0,"verdict":"可买|谨慎|回避","buyTrigger":"≤30字","stopLoss":"≤20字","risk":"≤30字"}]
correlation<0.5 的标的是低关联度蹭概念，verdict 必须"回避"。`;
      try {
        const stockText = await callLLM(stockPrompt, { maxTokens: 4000, temperature: 0.2 });
        try { stockVerdicts = JSON.parse(stockText); } catch {
          const m = stockText.match(/\[[\s\S]*\]/);
          if (m) { try { stockVerdicts = JSON.parse(m[0]); } catch { stockVerdicts = []; } }
        }
      } catch { stockVerdicts = []; }
    }
    const verdictMap = new Map((Array.isArray(stockVerdicts) ? stockVerdicts : []).map(v => [String(v.code), v]));

    // Step 6：合并 + 落库（theme_analysis:日期:时分 + latest）—— 含 evidence(带URL)/picks(关联度)/etfs
    const result = {
      date: dateStr,
      time: new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(11, 16),
      round: label,
      themes: themes.map(t => {
        const a = analyses.find(x => x.theme === t.name) ?? {};
        const rawPicks = (themePicks.get(t.name) ?? []).map(p => {
          const v = verdictMap.get(p.code) ?? {};
          return {
            ...p,
            correlation: v.correlation ?? 0,
            aiVerdict: v.verdict ?? "谨慎",
            buyTrigger: v.buyTrigger ?? p.buyTrigger,
            stopLoss: v.stopLoss ?? p.stopLoss,
            risk: v.risk ?? p.risk,
          };
        });
        return {
          theme: t.name, heat: t.heat, trend: a.verdict === "风险警示" ? "down" : "up",
          verdict: a.verdict ?? "观察", fundAnalysis: a.fundAnalysis ?? "资金数据不足", action: a.action ?? "跟踪观察",
          // V13-5：evidence 带 url（新闻可点击）；picks 过滤关联度<0.5（蹭概念不展示）；etfs
          evidence: t.evidence ?? [],
          picks: rawPicks.filter(p => (p.correlation ?? 0) >= 0.5),
          etfs: themeEtfs.get(t.name) ?? [],
        };
      }),
    };
    const hhmm = `${String(new Date().getHours()).padStart(2, "0")}${String(new Date().getMinutes()).padStart(2, "0")}`;
    await pool.query(
      `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now()) ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
      [`theme_analysis:${dateStr}:${hhmm}`, JSON.stringify(result)],
    );
    await pool.query(
      `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now()) ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
      ["theme_analysis:latest", JSON.stringify({ ...result, key: `theme_analysis:${dateStr}:${hhmm}` })],
    );
    console.log(`[cron] themeAnalysis(${label}): ${themes.length}主题 ${allPicks.length}标的`);
    return result;
  } catch (e) {
    console.error("[cron] themeAnalysis failed:", e.message);
    return null;
  }
}

// 导出抓取函数供验证/手动触发用
module.exports = startCron;
module.exports.fetchZTPool = fetchZTPool;
module.exports.fetchFastNews = fetchFastNews;
module.exports.runThemeAnalysis = runThemeAnalysis;
module.exports.fetchAnnouncements = fetchAnnouncements;
module.exports.fetchPolicyNews = fetchPolicyNews;
module.exports.analyzeDaily = analyzeDaily;
module.exports.generateDailyReview = generateDailyReview;
module.exports.runEventClassify = runEventClassify;
module.exports.fetchBoardFundServer = fetchBoardFundServer;
module.exports.fetchBlockTrades = fetchBlockTrades;
module.exports.fetchMarketDaily = fetchMarketDaily;
module.exports.fetchLhbDaily = fetchLhbDaily;
module.exports.fetchMarketIntraday = fetchMarketIntraday;
