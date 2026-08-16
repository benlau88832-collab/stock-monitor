// ============================================================
// 定时任务调度注册（v9.139.0 阶段二 #16：领域模块拆分后本文件只留调度）
// 领域模块：cron/base.js（共享基础设施）/ zt.js（涨停池·市场日）/ fund.js（资金·龙虎榜·盯价）
//           news.js（快讯·公告·政策）/ brain.js（盘中大脑·主题分析）/ review.js（复盘·事件分级）/
//           ledger.js（成交回填·摘要·画像）
// ============================================================
const cron = require("node-cron");
// v9.26.5：显式加载 .env（独立调用/测试时也能读到 AI 配置）
require("dotenv").config();
const B = require("./cron/base");
const { contentKey, httpsGet, bjDate, bjDateStr, EM_UT, detectSealDecayServer, markCronStep, hasCronStep, isTradingDayCN, getJson, getJsonWithFallback, requestRaw, parseLLMJSON, SCHEMAS, withPgLock, LOCK_CRON_MAIN, LOCK_THEME, LOCK_WATCH, LOCK_INTRADAY, callLLM, saveFactorIc } = B;
const { fetchMarketDaily, fetchNuclearCount, fetchZTPool } = require("./cron/zt");
const { fetchLhbDaily, fetchMarketIntraday, fetchBoardQuotes, notifyWatchedStockAlerts, fetchBoardFundServer, fetchBlockTrades } = require("./cron/fund");
const { rankNewsStars, confirmBlackSwansWithLLM, rankFastNewsStars, fetchFastNews, fetchAnnouncements, fetchPolicyNews, loadRankedAnnTitles, saveRankedAnnTitles, rankStrongAnnouncements, runNewsFeedSync, BLACK_ANN_RE } = require("./cron/news");
const { runIntradayBrain, runProactiveStore, runThemeAnalysis } = require("./cron/brain");
const { analyzeDaily, generateDailyReview, runEventClassify } = require("./cron/review");
const { runTradeBackfill, backfillOnePost, runPostSummary, runUserStyleProfile } = require("./cron/ledger");
// ============================================================
// 定时任务：收盘快照抓取 + 公告/快讯自动落库 + 自动 LLM 分析
// 设计目标（用户核心诉求）：
//   1. 所有公告+信息流自动刷新、自动储存（无需开页面）
//   2. 收盘后自动抓涨停池快照（跨日数据不再空洞）
//   3. 自动 LLM 分析：对抓到的公告/快讯生成结构化分析落库
// ============================================================


// v9.26.5：显式加载 .env（独立调用/测试时也能读到 AI 配置）


// v9.64（V2-P0-5）：contentKey 去内存 seq —— 确定性 key（同一数据多次抓取 → 同 key → 幂等）；
//   原 fallbackSeq 重启后重置，同一缺字段公告会生成不同 key 重复入库
/** 内容哈希：title+time 生成确定性主键（sha256 前缀，无状态） */

// ---------- v9.84.2/3（3.6+4.1）：盘中大脑快照 + 板块集体异动引擎 ----------
// 每 5 分钟（9:30-15:00 交易日）：
//   ① 服务端情绪分落库 sentiment_intraday:日期（页面关掉也不断链，AI 大脑/异动引擎数据源）
//   ② 板块资金快照 fund_streak_intraday:日期（板块涨跌幅+主力净额）
//   ③ 板块集体异动检测：同板块≥3涨停 / 板块涨幅>3%+主力净额>3亿 → kv anomaly:日期 + 推送
//   ④ v9.84.3（4.3）：封单衰减检测下沉（原只在前端内存态，关页即失）—— 同构 detectSealDecay
// 数据源全部东财公开接口，走 httpsGet（6s 超时），单轮失败不阻塞后续

// 封单衰减内存态（模块级，跨轮比较；与前端 src/lib/sealMonitor.ts 同构）

/**
 * v9.119.0（S3-3 补全）：主动智能流落库（独立时段入口）——
 * 认知层（表最新优先）→ runProactiveTick 时段洞察 → LLM 润色（受时段预算，失败回退规则原文）→ kv proactive:latest
 * 由时段调度（盘前/竞价/早盘/午后/尾盘/盘后）与 runIntradayBrain 尾部共同调用；失败不影响主链。
 */

/**
 * v9.124.0（蓝图 4A T-资讯-1）：个股新闻聚合落库 ——
 * 自选（price_watch）+ 主线龙头（认知层 leader.code）→ fetchStockNewsServer → upsertNewsFeed。
 * 0 LLM、0 token；抓取/落库单条失败静默（网络中断/DNS 抖动不阻塞主链）。
 */

/** v9.77（A7-01）：北京时间日期串（YYYY-MM-DD，龙虎榜 TRADE_DATE 对齐用） */

// v9.77（P0-12 修复）：盯价股 × 公告/黑天鹅 主动告警 —— "自选/盯价股出利空赶紧叫我"
// 采集（cron 20min）、推送通道（pushGateway/Server酱/Bark）、事件表（price_watch_events 前端 5s 轮询）
// 全就绪，唯独缺这层胶水。每轮抓完公告/黑天鹅后与 price_watch 活跃清单做 code 交集：
//   利空（black_swan）→ critical 推送 + 事件；强利好（正则）→ 事件。

// ---------- 2. 抓快讯 → news ----------
// v9.75（P0-4 修复）：快讯规则提星 —— 此前 stars 恒 1，analyzeDaily 的 strongNews（stars>=3）恒空，
// "市场速览"LLM 永远看不到快讯维度。用正则对高关注度快讯提星（零 LLM 成本，阶段二再上 LLM 分级回填）。
// v15（待确认方案·数据补全）：pageSize 参数化 —— 启动补抓传 200（覆盖周末积压），常规 cron 默认 80
// ---------- 2c. 黑天鹅公告 LLM 二级确认（v9.75 · 阶段二） ----------
// 背景：BLACK_ANN_RE 正则初筛存在漏召回（"业绩变脸/财务造假/实控人被拘"等语义负向不含触发词）
// 与误召回（标题含"减持"但实际是"减持计划完成"中性公告）。本函数：正则初筛 → LLM 精筛
// （确认是否真利空 + 影响级别 + 一句话影响），幂等：已确认标题跳过；无 key 静默保留正则结果。
// 背景：快讯 stars 恒 1 → analyzeDaily 的 strongNews 恒空、event_classify 排序无真实依据。
// 本函数：配 LLM Key 时，对近 2h 快讯 top20 做一次批调用回填 stars(1-5)/sentiment(positive/negative/neutral)，
// 幂等：按 title 哈希判重（已回填过的标题不再重复计费）；无 key/失败静默（保留规则提星结果）。

// ---------- 4.（P2-1）抓政策类快讯 → kv_store: policy:YYYY-MM-DD ----------
// 政策面是用户核心诉求"消息/政策/公告面"中最弱的一环（此前只有手动粘贴的 policyDiff）。
// 本函数：从东财快讯流中按政策关键词过滤（国务院/央行/证监会/发改委等），
// 落库 kv_store:policy:YYYY-MM-DD，前端 IntelligenceDashboard 可读取展示。

// ---------- （P2-5）公告强催化识别：LLM 评分优先 + 扩展正则兜底 ----------
// 原 analyzeDaily 用 /业绩|中标|增持|回购|重组|突破|获批/ 粗筛，漏召回高
// （如"净利润同比+200%"不含这些词）。改为：配了 LLM Key 时对 top40 公告
// 一次调用打分（score≥4=强利好），LLM 不可用时用扩展关键词正则兜底。
// v9.75（阶段三）：公告评分幂等 —— 15:40 与启动各评一次同批公告 = 重复计费。
// 用"代码+标题"哈希集合判重，同日已评过标题直接跳过（kv 滚动 500）
// v9.32：黑天鹅公告（利空向）—— 盘前突发立案/退市/商誉减值等会让持仓秒跌停

// ---------- v9.33（缺口6）：板块资金流落库（行业全量双请求，供前端连续性/切换分析） ----------
// v9.30.2 教训：clist po=1 降序只拿到流入端，必须 po=1 + po=0 双请求合并
// v9.33.1：push2 对 nodejs 直连 TLS ban（socket hang up）；push2delay（延迟15分钟行情）node 可直连 → 改用 push2delay

let cronBusy = false; // v9.26.10：防重叠执行（20min 任务与启动抓取/15:40 并发）
// v9.81（性能/运维）：盯价/主题分析任务独立防重叠 —— node-cron 同任务前一轮未跑完会再触发
let watchRunning = false;
let themeRunning = false;
// v9.84.2/3：盘中大脑快照防重叠
let intradayBusy = false;
// v9.102.0（第二批 A，T-A1）：盘中精灵每 2 分钟轮询防重叠（内部串行四池 8-15s/轮，*/2 分钟位检查 + busy 跳过）
// v9.108.3（复验缺口②）：文案对齐 —— 原残留"高频率轮询…*/2s 检查"表述与 T-4A 修正矛盾
let sprintBusy = false;
function startCron({ pool }) {
  // 交易日（周一至周五且非节假日）15:40 收盘快照 + 分析
  cron.schedule("40 15 * * 1-5", async () => {
    if (!isTradingDayCN()) { console.log("[cron] 15:40 非交易日（节假日），跳过抓取"); return; }
    console.log("[cron] 15:40 收盘快照 + 分析开始");
    if (cronBusy) { console.log("[cron] busy, skip 15:40"); return; }
    cronBusy = true;
    // v9.89.0（P2-4）：PG advisory lock 跨进程互斥（cronBusy 保留为进程内双保险）
    let gotLock = false;
    try { gotLock = await withPgLock(pool, LOCK_CRON_MAIN, async () => {
    // v9.137.0（审查 P0-2 修复）：dateStr 提升到内层 try 之外 —— 原 const 声明在 try 块内
    //   （块级作用域），块外 8 处 markCronStep(pool, dateStr,...) 引用抛 ReferenceError: dateStr is not defined，
    //   导致 15:40 主链在 zt 落库后即崩，盘后链（analyze/marketDaily/factorIc/review/eventClassify/
    //   watchClose/fundStreak/blockTrade）从未执行、checkpoint 零写入、每次重启启动补跑重复计费。
    let dateStr = bjDateStr(); // 兜底：snap 抓取失败时仍可用今日日期标记 checkpoint
    try {
      const snap = await fetchZTPool();
      dateStr = snap.date;
      await pool.query(
        `INSERT INTO zt_snapshot(date,data) VALUES($1,$2)
         ON CONFLICT(date) DO UPDATE SET data=$2, created_at=now()`,
        [dateStr, JSON.stringify(snap)],
      );
      console.log(`[cron] zt snapshot ${dateStr}: ${snap.count} 只涨停`);
    } catch (e) { console.error("[cron] zt snapshot failed:", e.message); }
    await markCronStep(pool, dateStr, "zt");
    try { await analyzeDaily({ pool }); } catch (e) { console.error("[cron] analyze failed:", e.message); }
    await markCronStep(pool, dateStr, "analyze");
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
    await markCronStep(pool, dateStr, "marketDaily");
    // v9.42：因子 IC 健康度落库（读历史 market_daily+sentiment → 滚动窗口 IC → factor_ic:日期）
    try { await saveFactorIc(pool); } catch (e) { console.error("[cron] factor_ic failed:", e.message); }
    await markCronStep(pool, dateStr, "factorIc");
    // v9.33（缺口2/6）：盘后自动复盘 + 板块资金流落库（连续性/切换分析数据源）
    try { await generateDailyReview({ pool }); } catch (e) { console.error("[cron] review failed:", e.message); }
    await markCronStep(pool, dateStr, "review");
    // v9.38.1（V3-12）：事件三级分类（政策/行业/事件）—— 盘后批量跑一次
    try { await runEventClassify({ pool }); } catch (e) { console.error("[cron] event_classify failed:", e.message); }
    await markCronStep(pool, dateStr, "eventClassify");
    // v9.66：收盘盯价快照（active 监控清单 → 收盘价/偏离度 → log + 触发事件）
    try {
      const { runWatchCheck } = require("./routes/watch");
      const wr = await runWatchCheck(pool);
      console.log(`[cron] 收盘盯价: ${wr.checked} 只监控, ${wr.triggered.length} 只触发关注区间`);
    } catch (e) { console.error("[cron] watch close failed:", e.message); }
    await markCronStep(pool, dateStr, "watchClose");
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
    await markCronStep(pool, dateStr, "fundStreak");
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
    await markCronStep(pool, dateStr, "blockTrade");
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
    // v9.137.0（审查 P0-2）：dateStr 已在回调顶部声明（原块级作用域 ReferenceError 修复），此处统一引用
    await markCronStep(pool, dateStr, "lhb");
    }); } catch (e) { console.error("[cron] PG lock error:", e.message); }
    if (!gotLock) { console.log("[cron] PG lock busy, skip 15:40"); }
    cronBusy = false;
  }, { timezone: "Asia/Shanghai" });

  // v9.77（A7-01 修复）：龙虎榜盘后补抓 —— 东财当日榜单 16:00 起陆续公布，15:40 首抓多为空/昨日；
  // 17:30 / 18:30 重抓当日（fetchLhbDaily 已按 TRADE_DATE 过滤今日）幂等覆盖 lhb:今日。
  const saveLhbToday = async () => {
    try {
      const lhb = await fetchLhbDaily();
      if (lhb.length > 0) {
        const lDateStr = bjDateStr();
        await pool.query(
          `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now())
           ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
          [`lhb:${lDateStr}`, JSON.stringify({ date: lDateStr, items: lhb })],
        );
        console.log(`[cron] lhb 补抓 ${lDateStr}: ${lhb.length} 只`);
      }
    } catch (e) { console.error("[cron] lhb 补抓失败:", e.message); }
  };
  cron.schedule("30 17 * * 1-5", async () => { await saveLhbToday(); }, { timezone: "Asia/Shanghai" });
  cron.schedule("30 18 * * 1-5", async () => { await saveLhbToday(); }, { timezone: "Asia/Shanghai" });

  // 快讯+公告自动落库：每天 8:00-20:40 每 20 分钟（v9.84.6：原仅工作日 9-16 ——
  // 周末不抓导致周六日问"周末有什么消息"本地库无新数据；周末海外快讯/公告对周一开盘有价值，放行周末）
  // v9.137.0（审查 P3-03）：注释窗口对齐 —— */20 在 8-20 时位实际覆盖 8:00-20:40（尾端 20:20/20:40 也触发）
  // 节假日（isTradingDayCN false 且非周末）仍跳过
  cron.schedule("*/20 8-20 * * *", async () => {
    if (!isTradingDayCN()) {
      // v9.85.0（P1-15）：周末判定用北京时间（原 new Date().getDay() 依赖运行时区，UTC 下凌晨 8 点前判错前一天）
      const bjDay = new Date(Date.now() + 8 * 3600 * 1000).getUTCDay();
      if (bjDay !== 0 && bjDay !== 6) { console.log("[cron] 节假日，跳过快讯抓取"); return; }
    }
    if (cronBusy) { console.log("[cron] busy, skip 20min fetch"); return; }
    cronBusy = true;
    // v9.89.0（P2-4）：PG advisory lock 跨进程互斥
    let gotLock = false;
    try { gotLock = await withPgLock(pool, LOCK_CRON_MAIN, async () => {
    try {
      const news = await fetchFastNews();
      if (news.length > 0) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          for (const n of news) {
            await client.query(
              `INSERT INTO news(code,title,summary,boards,sentiment,stars,rank_source,is_overseas,time,url)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
               ON CONFLICT(code) DO UPDATE SET title=$2,summary=$3,time=$9,url=$10`,
              [n.code, n.title, n.summary ?? "", "[]", n.sentiment, n.stars, n.rankSource ?? "rule", n.isOverseas, n.time, n.url],
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

      // v9.75（阶段二）：快讯 LLM 分级回填（stars/sentiment）—— 解决 strongNews 恒空 + 事件排序无依据
      try { await rankFastNewsStars(pool); } catch { /* 不影响主流程 */ }

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
      // v9.75（阶段二）：正则初筛 → LLM 二级确认（yes 保留 + 影响级别；失败静默用正则结果）
      let blackSwans = [];
      try {
        const regexHits = anns.filter(a => BLACK_ANN_RE.test(a.title || ""));
        const llmConfirmed = await confirmBlackSwansWithLLM(pool, anns);
        // v9.85.2（P2-2）：统一事件分类 schema —— source/confidence 标注（LLM 精筛 vs 正则兜底）
        blackSwans = llmConfirmed !== null
          ? llmConfirmed.map(a => ({ ...a, source: "llm", confidence: "high" }))
          : regexHits.map(a => ({ code: a.stockCode, name: a.stockName, title: a.title, time: a.time, url: a.url, source: "rule", confidence: "medium" }));
        if (blackSwans.length > 0) {
          const bsDate = bjDate();
          const bsDateStr = `${bsDate.slice(0, 4)}-${bsDate.slice(4, 6)}-${bsDate.slice(6, 8)}`;
          await pool.query(
            `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now())
             ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
            [`black_swan:${bsDateStr}`, JSON.stringify({ date: bsDateStr, items: blackSwans })],
          );
          console.log(`[cron] black_swan ${bsDateStr}: ${blackSwans.length} 条`);
        }
      } catch (e) { console.error("[cron] black_swan fetch failed:", e.message); }

      // v9.77（P0-12 修复）：盯价股 × 公告/黑天鹅 主动告警（利空 critical 推送 + 利好事件）
      try {
        await notifyWatchedStockAlerts(pool, blackSwans, anns);
      } catch (e) { console.error("[cron] 盯价股公告告警失败:", e.message); }
    } catch (e) { console.error("[cron] fetch failed:", e.message); }

    // v9.38（V3-11）：盘中市场快照（随 20min 链执行，加速回测样本）
    // v9.137.0（审查 P3-01）：注释名实对齐 —— 原注释"每小时一次"实为挂在 */20 任务内每 20 分钟一次
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
    }); } catch (e) { console.error("[cron] PG lock error:", e.message); }
    if (!gotLock) { console.log("[cron] PG lock busy, skip 20min fetch"); }
    cronBusy = false;
  }, { timezone: "Asia/Shanghai" });

  // 启动时立即抓取一次（验证 + 补数据：涨停快照 + 快讯 + 公告 + 政策 全部入库）
  // v9.81（性能/运维）：补抓链加固 —— cronBusy 互斥（不与 20min/15:40 任务并发抢东财+AI 配额）
  setTimeout(async () => {
    if (cronBusy) { console.log("[cron] busy, skip startup fetch"); return; }
    cronBusy = true;
    // v9.89.0（P2-4）：PG advisory lock 跨进程互斥
    let gotLock = false;
    try { gotLock = await withPgLock(pool, LOCK_CRON_MAIN, async () => {
    try {
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
      // v15（数据补全）：启动补抓拉大参数 —— 快讯 200 条 + 公告 3 页（240 条），覆盖周五关~周一开积压
      const news = await fetchFastNews(200);
      const anns = await fetchAnnouncements(3);
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        for (const n of news) {
          await c.query(
            `INSERT INTO news(code,title,summary,boards,sentiment,stars,rank_source,is_overseas,time,url)
             VALUES($1,$2,$3,'[]',$4,$5,$6,$7,$8,$9)
             ON CONFLICT(code) DO UPDATE SET title=$2,summary=$3,time=$8`,
            [n.code, n.title, n.summary, n.sentiment, n.stars, n.rankSource ?? "rule", n.isOverseas, n.time, n.url],
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

    // v9.75（阶段二）：启动即快讯 LLM 分级回填（先分级，analyzeDaily 的 strongNews 才有数据）
    // v9.81（性能/运维）：非交易日跳过 LLM 链（周末/节假日启动不再烧 5-10 分钟 + AI 配额）
    const isTrading = isTradingDayCN();
    if (isTrading) {
      // v9.89.0（P2-4）：重启后 15:40 链已完成的步骤跳过（防重复执行/重复计费）
      const cpDate = bjDateStr();
      const cpAnalyze = await hasCronStep(cpDate, "analyze");
      const cpReview = await hasCronStep(cpDate, "review");
      const cpIc = await hasCronStep(cpDate, "factorIc");
      // v9.100.0（P1-01）：启动补跑遗漏 market_daily —— 服务重启错过 15:40 链时，
      //   情绪报告/信号回测/Playbook/盘后汇报全断档（2026-08-11 实测 market_daily:08-11=null，其余链全回退昨日）
      const cpMarketDaily = await hasCronStep(cpDate, "marketDaily");
      if (cpAnalyze && cpReview && cpIc && cpMarketDaily) {
        console.log("[cron] 启动 LLM 链：今日 15:40 已完成（checkpoint），跳过");
      } else {
        try { await rankFastNewsStars(pool); } catch { /* 不影响 */ }
        if (!cpAnalyze) { try { await analyzeDaily({ pool }); } catch (e) { console.error("[cron] 启动 analyzeDaily 失败:", e.message); } }
        // v9.100.0（P1-01）：补 market_daily（参照 15:40 链写法，checkpoint 幂等防重复）
        if (!cpMarketDaily) {
          try {
            const md = await fetchMarketDaily(pool);
            await pool.query(
              `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now())
               ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
              [`market_daily:${md.date}`, JSON.stringify(md)],
            );
            await markCronStep(md.date, "marketDaily");
            console.log(`[cron] 启动补 market_daily ${md.date}: 涨停${md.ztCount} 炸板${md.zbCount} 跌停${md.dtCount}`);
          } catch (e) { console.error("[cron] 启动 market_daily 失败:", e.message); }
        }
        // v9.33（缺口2/6/8）：启动即补 复盘 + 资金流 + 大宗交易（容错，任一失败不阻塞）
        if (!cpReview) { try { await generateDailyReview({ pool }); } catch (e) { console.error("[cron] 启动复盘失败:", e.message); } }
        // v9.42：启动即补因子 IC 健康度（无论当天是否到收盘时间都有快照）
        if (!cpIc) { try { await saveFactorIc(pool); } catch (e) { console.error("[cron] 启动因子IC失败:", e.message); } }
      }
    } else {
      console.log("[cron] 非交易日，跳过 LLM 链（快讯分级/分析/复盘/因子IC）");
    }
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
    } finally { /* v9.89.0：原任务体 try 的 finally（cronBusy 复位已外提）*/ } }); } catch (e) { console.error("[cron] PG lock error:", e.message); }
    if (!gotLock) { console.log("[cron] PG lock busy, skip startup fetch"); }
    cronBusy = false;
  }, 3000);

  console.log("[cron] scheduled: 15:40 快照+分析+复盘 · 每20分钟抓快讯/公告/政策 · 盘中每5分钟盯价 · Asia/Shanghai");

  // v9.140.0（阶段三 #13）：大宗商品价格采集（百川盈孚 SSR，景气度价格维度数据源）
  // 交易日 09:20 早盘价 + 15:10 收盘价；外部站点抖动失败静默（不阻塞主链）
  const runCommodityPriceTask = async () => {
    try {
      if (!isTradingDayCN()) return;
      const { fetchCommodityPrices, saveCommodityPrices } = require("./lib/commodityPrice");
      const r = await fetchCommodityPrices();
      const dateStr = await saveCommodityPrices(pool, r);
      const up = r.items.filter(i => i.dir === "up").length;
      const down = r.items.filter(i => i.dir === "down").length;
      console.log(`[cron] commodity_price ${dateStr}: ${r.items.length} 项（涨${up}/跌${down}，${r.source}）`);
    } catch (e) { console.warn("[cron] commodity_price 失败（外部站点）:", e.message); }
  };
  cron.schedule("20 9 * * 1-5", runCommodityPriceTask);
  cron.schedule("10 15 * * 1-5", runCommodityPriceTask);

  // v9.150.0（P2-4）：统计口径外部数据每日刷新（月度数据变化慢，失败静默，次日重试）
  cron.schedule("40 7 * * *", async () => {
    try {
      const { syncIndustryMacroSignals } = require("./lib/industryStatistics");
      const r = await syncIndustryMacroSignals(pool);
      console.log(`[cron] industry_macro 同步: ${r.ok.map(x => `${x.endpoint}(${x.inserted})`).join(" ")}${r.failed.length ? " 失败:" + r.failed.map(x => x.endpoint).join(",") : ""}`);
    } catch (e) { console.warn("[cron] industry_macro 同步失败:", e.message); }
  }, { timezone: "Asia/Shanghai" });

  // v9.148.0（任务07+08）：每晚 21:00 全链挖掘 + 简报生成 —— 6 链站内信号 + 外网交叉验证
  // → chain_intel 落库 → LLM 简报 → chain_briefing（每晚都跑含周末；幂等覆盖同链同日）
  cron.schedule("0 21 * * *", async () => {
    try {
      const { runNightlyScan } = require("./lib/chainIntel");
      const { generateAllBriefings } = require("./lib/chainBriefing");
      const scanResults = await runNightlyScan(pool);
      console.log(`[cron] chain_intel 夜间扫描: ${scanResults.map(r => r.chainId + (r.ok ? `(${r.items}条/${r.ms}ms)` : "✗" + r.error)).join(" ")}`);
      const briefResults = await generateAllBriefings(pool);
      console.log(`[cron] chain_briefing 简报: ${briefResults.map(r => r.chainId + (r.ok ? `(${r.stage}${r.fallback ? ",规则兜底" : ""})` : "✗" + r.error)).join(" ")}`);
    } catch (e) { console.warn("[cron] chain_intel 夜间任务失败:", e.message); }
  }, { timezone: "Asia/Shanghai" });

  // v9.148.0（任务12）→ v9.148.2（A5）：每日回填链命中率（简报判断 vs T+5 链内标的实际涨跌）
  //   18:30 执行（原 16:05 与 15:45 kline 增量写 IO 相撞 + 16:05 时当日 kline 可能未写完）
  cron.schedule("30 18 * * 1-5", async () => {
    try {
      const { recordAllChainHits } = require("./lib/chainLearning");
      const results = await recordAllChainHits(pool);
      if (results.length > 0) {
        console.log(`[cron] chain_hit 命中回填: ${results.map(r => r.chainId + "(" + r.date + "→" + r.avgPct + "%)").join(" ")}`);
      }
    } catch (e) { console.warn("[cron] chain_hit 回填失败:", e.message); }
  }, { timezone: "Asia/Shanghai" });

  // v9.148.0（任务11）：盘中异动补挖 —— 每 5 分钟检测（批量涨停≥3/商品±3%/链内公告）→ 补挖+推送
  // 同链 30 分钟节流；未配置推送渠道时静默（检测仍记录，不推送）
  cron.schedule("*/5 9-15 * * 1-5", async () => {
    try {
      const { runAnomalyCheck } = require("./lib/chainAnomaly");
      const results = await runAnomalyCheck(pool);
      if (results.length > 0) {
        console.log(`[cron] chain_anomaly 异动: ${results.map(r => r.chainId + (r.throttled ? "(节流)" : (r.pushed ? "(已推)" : (r.skipped ? "(未配渠道)" : "✗" + (r.error || "")))).slice(0, 30)).join(" ")}`);
      }
    } catch (e) { console.warn("[cron] chain_anomaly 异动检测失败:", e.message); }
  }, { timezone: "Asia/Shanghai" });

  // v9.148.0（任务10）：早盘前推送简报摘要（交易日 8:35；简报为前一晚 21:00 生成）
  // 需先在设置页配置推送渠道（Server酱=微信扫码绑定）；未配置时静默跳过
  cron.schedule("35 8 * * 1-5", async () => {
    try {
      const { pushBriefingDigest } = require("./lib/chainPush");
      const out = await pushBriefingDigest(pool);
      console.log(`[cron] chain_push 简报推送: ${out.ok ? "已推送" : (out.skipped ? "跳过(" + (out.reason || "未配置渠道") + ")" : "失败")}（${out.chainCount ?? 0} 链，${out.date ?? ""}）`);
    } catch (e) { console.warn("[cron] chain_push 简报推送失败:", e.message); }
  }, { timezone: "Asia/Shanghai" });

  // v9.140.0（#11 推送分层·持仓优先）：持仓逻辑提醒推手机 —— 盘中每 20 分钟 + 盘后 15:50 各一次
  // 引擎与前端同源（shared/logic-ledger.js），按天去重（ledger_push_log:日期），
  // 持仓台账数据由前端 saveEntry 同步到 PG kv（logic_ledger:日期）
  const runLedgerPushTask = async (label) => {
    try {
      if (!isTradingDayCN()) return;
      const { runLedgerPush } = require("./cron/ledger");
      await runLedgerPush(pool);
    } catch (e) { console.warn(`[cron] ledger_push(${label}) 失败:`, e.message); }
  };
  cron.schedule("*/20 9-15 * * 1-5", () => runLedgerPushTask("盘中"));
  cron.schedule("50 15 * * 1-5", () => runLedgerPushTask("盘后"));

  // v9.66：个股盯价监控 —— 盘中每 5 分钟（`*/5 9-15` 实际 9:00-15:55；v9.128.0 一致性审查 P2 注释对齐，
  //   无内部时段守卫属已知宽松，盘后空转待后续收紧）
  cron.schedule("*/5 9-15 * * 1-5", async () => {
    try {
      if (!isTradingDayCN()) return;
      // v9.81：防重叠 —— 上一轮未跑完（东财慢/超时）时跳过本轮
      // v9.89.0（P2-4）：PG advisory lock 跨进程互斥（watchRunning 保留为进程内双保险）
      if (watchRunning) { console.log("[cron] watch busy, skip"); return; }
      watchRunning = true;
      try {
        const gotLock = await withPgLock(pool, LOCK_WATCH, async () => {
          const { runWatchCheck } = require("./routes/watch");
          const r = await runWatchCheck(pool);
          if (r.triggered.length > 0) {
            console.log(`[cron] ⚡ 盯价触发关注区间: ${r.triggered.map(t => `${t.name}(${t.code}) 现价${t.price} 偏离${t.deviation}%`).join(" | ")}`);
          }
        });
        if (!gotLock) console.log("[cron] watch PG lock busy, skip");
      } finally { watchRunning = false; }
    } catch (e) { console.error("[cron] 盘中盯价失败:", e.message); }
  }, { timezone: "Asia/Shanghai" });

  // v9.84.2/3（3.6+4.1）：盘中大脑快照 + 板块集体异动 —— 每 5 分钟（9:30-15:00 交易日）
  // 情绪分/板块资金快照落库（关页不断链）+ 同板块≥3涨停/资金脉冲 → kv anomaly + 多通道推送
  cron.schedule("*/5 9-15 * * 1-5", async () => {
    try {
      if (!isTradingDayCN()) return;
      if (intradayBusy) return; // 防重叠
      intradayBusy = true;
      try {
        // v9.89.0（P2-4）：PG advisory lock 跨进程互斥
        const gotLock = await withPgLock(pool, LOCK_INTRADAY, async () => {
          const r = await runIntradayBrain(pool);
          if (r.sentiment != null) console.log(`[cron] 盘中快照 ${bjDateStr()}: 情绪${r.sentiment} 异动${r.anomalies}`);
        });
        if (!gotLock) console.log("[cron] intraday PG lock busy, skip");
      } finally { intradayBusy = false; }
    } catch (e) { console.error("[cron] 盘中大脑快照失败:", e.message); }
  }, { timezone: "Asia/Shanghai" });

  // v9.104.0（第四批 C，T-C1）：盘中情报调度 —— 五段式 `30 9-14` = 每小时 :30 共 6 轮（9:30-14:30），
  // v9.128.0（一致性审查 P1-8）：注释名实对齐（原"30min 自动"误导——真 30 分钟需 `*/30 9-14`，同文件 themeAnalysis 用）
  // 关页不断链：盘中每 30 分钟 LLM 生成当日分析（llm_analysis:日期，失败规则版兜底已有）
  // + kv intel_intraday:日期:HHMM 轮次标记（前端 IntelligenceDashboard 可展示"盘中自动轮次"）
  let intradayIntelBusy = false;
  cron.schedule("30 9-14 * * 1-5", async () => {
    try {
      if (!isTradingDayCN()) return;
      if (intradayIntelBusy) return;
      intradayIntelBusy = true;
      try {
        await analyzeDaily({ pool });
        const now = new Date(Date.now() + 8 * 3600 * 1000);
        const ds = now.toISOString().slice(0, 10);
        const hhmm = now.toISOString().slice(11, 16).replace(":", "");
        await pool.query(
          `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now())
           ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
          [`intel_intraday:${ds}:${hhmm}`, JSON.stringify({ date: ds, time: hhmm, type: "盘中自动" })],
        );
        console.log(`[cron] 盘中情报轮次 ${ds}:${hhmm}`);
      } finally { intradayIntelBusy = false; }
    } catch (e) { console.error("[cron] 盘中情报失败:", e.message); }
  }, { timezone: "Asia/Shanghai" });

  // v9.102.0（第二批 A，T-A1）：盘中精灵轮询 —— push2ex 四池串行巡检
  // v9.137.0（审查 P0-1 修复）：表达式 6 字段→5 字段 —— 原 "*/2 * 9-15 * * 1-5" 为 6 字段
  //   （秒 分 时 日 月 周），*/2 落在秒位 = 每 2 秒触发（9:00-15:59 每分钟 30 次，交易日约 12600 次），
  //   且每 2 秒抢 LOCK_INTRADAY 导致 5 分钟盘中大脑被锁饿死（sentiment_snapshot 断更、认知陈旧）；
  //   改 5 字段 "*/2 9-15 * * 1-5" = 每 2 分钟（与 v9.102.0 原注释意图一致）。
  // v9.138.0（波段重构·阶段一，Q5 降噪）：精灵调度停用 —— 炸板/封单异动推送属超短打板件，
  //   波段客（3天-1个月）不需要分钟级封单提醒；代码保留（runIntradaySprint 可手动/后续按需启用），
  //   盘中大脑（runIntradayBrain，*/5）仍负责情绪快照/板块异动，不受影响。
  // 通达信"盘中精灵"效果：涨停潮/炸板突变/封单异动第一时间提醒（已停用）
  // 东财风控：内部串行 QPS≤2 + 每池 1.5-3s 抖动；busy 跳过 + PG lock（与盘中大脑共享 LOCK_INTRADAY）
  // cron.schedule("*/2 9-15 * * 1-5", async () => {
  //   try {
  //     if (!isTradingDayCN()) return;
  //     if (sprintBusy) return; // 防重叠（一轮 8-15s，*/2 分钟间隔内通常已跑完）
  //     sprintBusy = true;
  //     try {
  //       const gotLock = await withPgLock(pool, LOCK_INTRADAY, async () => {
  //         const { runIntradaySprint } = require("./lib/intradaySprint");
  //         await runIntradaySprint(pool);
  //       });
  //       if (!gotLock) console.log("[cron] sprint PG lock busy, skip");
  //     } finally { sprintBusy = false; }
  //   } catch (e) { console.error("[cron] 盘中精灵失败:", e.message); }
  // }, { timezone: "Asia/Shanghai" });

  // v9.103.0（第三批 D，T-D2）：隔夜映射巡检 —— 9:05 盘前 + 15:05 盘后
  // 外盘异动（|涨跌幅|≥2%）→ shared/overseas-map.js 映射匹配 → kv overseas_map_hint:日期 + info 推送
  cron.schedule("5 9 * * 1-5", async () => {
    try {
      if (!isTradingDayCN()) return;
      const { runOverseasPatrol } = require("./lib/overseasPatrol");
      await runOverseasPatrol(pool, "盘前");
    } catch (e) { console.error("[cron] 隔夜映射巡检(盘前)失败:", e.message); }
  }, { timezone: "Asia/Shanghai" });
  cron.schedule("5 15 * * 1-5", async () => {
    try {
      if (!isTradingDayCN()) return;
      const { runOverseasPatrol } = require("./lib/overseasPatrol");
      await runOverseasPatrol(pool, "盘后");
    } catch (e) { console.error("[cron] 隔夜映射巡检(盘后)失败:", e.message); }
  }, { timezone: "Asia/Shanghai" });

  // ---------- P0-3：拍板盈亏自动回填（15:50 盘后） ----------
  // 对 decision_post 表中"已拍 confirm 且执行未标记"的样本，用真实日 K 回填 T+5 PnL
  // 幂等：UPDATE 后再查不重复（executed=true）
  cron.schedule("50 15 * * 1-5", async () => {
    try {
      if (!isTradingDayCN()) return;
      const r = await runTradeBackfill(pool);
      if (r.total > 0) console.log(`[cron] P0-3 拍板盈亏回填: ${r.backfilled}/${r.total} 条`);
    } catch (e) { console.error("[cron] 拍板盈亏回填失败:", e.message); }
  }, { timezone: "Asia/Shanghai" });

  // ---------- v9.119.0（S3-3 补全）：主动智能流时段调度（盘前/竞价/早盘/午后/尾盘/盘后） ----------
  // 每时段入口产出时段洞察 + LLM 润色（受时段预算，失败回退规则原文）→ kv proactive:latest
  // 前端 ProactiveFeed 读 /api/proactive（优先 kv 润色版，无则实时规则版）
  const PROACTIVE_SCHEDULE = [
    ["5 9 * * 1-5", "盘前"],
    ["25 9 * * 1-5", "竞价"],
    ["0 10 * * 1-5", "早盘"],
    ["35 13 * * 1-5", "午后"],
    ["35 14 * * 1-5", "尾盘"],
    ["5 15 * * 1-5", "盘后"],
  ];
  for (const [expr, label] of PROACTIVE_SCHEDULE) {
    cron.schedule(expr, async () => {
      try {
        if (!isTradingDayCN()) return;
        await runProactiveStore(pool, bjDateStr());
      } catch (e) { console.error(`[cron] 主动流(${label})失败:`, e.message); }
    }, { timezone: "Asia/Shanghai" });
  }

  // ---------- v9.124.0（蓝图 4A T-资讯-1）：个股新闻聚合落库（盘前 9:10 / 盘后 15:20） ----------
  // 自选（price_watch）+ 主线龙头（认知 leader.code）新闻入 news_feed；0 LLM，失败静默不阻塞主链
  for (const expr of ["10 9 * * 1-5", "20 15 * * 1-5"]) {
    cron.schedule(expr, async () => {
      try {
        if (!isTradingDayCN()) return;
        await runNewsFeedSync(pool);
      } catch (e) { console.warn(`[cron] 资讯聚合失败（不影响主链）:`, e.message); }
    }, { timezone: "Asia/Shanghai" });
  }

  // ---------- P1-4：盘后主动汇报（15:10 LLM 生成今日拍板命中度 + 明日剧本 → 推送） ----------
  cron.schedule("10 15 * * 1-5", async () => {
    try {
      if (!isTradingDayCN()) return;
      const r = await runPostSummary(pool);
      if (r?.ok) console.log(`[cron] P1-4 盘后汇报已生成并推送: ${r.summaryKey}`);
    } catch (e) { console.error("[cron] 盘后汇报失败:", e.message); }
  }, { timezone: "Asia/Shanghai" });

  // ---------- P3-4：用户风格学习（周六 15:30，周度低频） ----------
  cron.schedule("30 15 * * 6", async () => {
    try {
      const r = await runUserStyleProfile(pool);
      if (r?.ok) console.log(`[cron] P3-4 用户风格学习: ${r.styleKey}`);
    } catch (e) { console.error("[cron] 用户风格学习失败:", e.message); }
  }, { timezone: "Asia/Shanghai" });

  // ---------- v9.147.0（数据基建·阶段一）：本地日K增量维护（盘后 15:45） ----------
  // 通达信 lday 增量导入 + 自选池腾讯 qfq 兜底 → kline_daily 表（读路径本地优先）
  // 交易日执行；单轮失败不阻塞主链；幂等（code+date 冲突跳过）
  cron.schedule("45 15 * * 1-5", async () => {
    try {
      if (!isTradingDayCN()) return;
      const { runKlineIncremental } = require("./cron/klines");
      await runKlineIncremental(pool);
      // v9.148.2（A5 P1-1）：交易日历增量 upsert（命中率锚定查询用，替代 kline_daily 全表扫）
      try {
        const today = bjDateStr();
        await pool.query(
          `INSERT INTO trading_calendar(date) VALUES($1) ON CONFLICT(date) DO NOTHING`,
          [today],
        );
      } catch (e) { console.warn("[cron] trading_calendar upsert 失败:", e.message); }
      await markCronStep(pool, bjDateStr(), "klineIncremental");
    } catch (e) { console.error("[cron] kline 增量失败:", e.message); }
  }, { timezone: "Asia/Shanghai" });

  // ---------- v9.147.0（阶段二B·波段信号闭环）：信号 T+20/T+60 盈亏回填（盘后 15:55） ----------
  // 用本地 kline_daily 计算 swing_signals 未回填样本的 20/60 交易日收盘涨跌幅（0 外部依赖）
  cron.schedule("55 15 * * 1-5", async () => {
    try {
      if (!isTradingDayCN()) return;
      const { backfillSignalPnl } = require("./lib/swingSignals");
      const r = await backfillSignalPnl(pool);
      if (r.backfilled > 0) console.log(`[cron] 波段信号回填: ${r.backfilled}/${r.total} 条`);
    } catch (e) { console.error("[cron] 波段信号回填失败:", e.message); }
  }, { timezone: "Asia/Shanghai" });

  // ---------- V13-1（P0）：新闻驱动作战管线 ----------
  // 频率（V13-4 深度推理）：盘前 9:15 检查隔夜 → 盘中每 30 分钟（9:00-14:30 含整点共 12 轮，v9.137.0 注释对齐）→ 盘后 15:05 完整版
  const scheduleThemeAnalysis = (expr, label) => cron.schedule(expr, async () => {
    try {
      if (!isTradingDayCN() && expr !== "5 15 * * 1-5") return; // 盘后允许非交易日补跑
      // v9.81：防重叠 —— runThemeAnalysis 含 2 次 LLM（恶劣情况单轮可超 30 分钟），不叠加
      // v9.89.0（P2-4）：PG advisory lock 跨进程互斥（与前端手动触发共用 LOCK_THEME）
      if (themeRunning) { console.log(`[cron] themeAnalysis(${label}) busy, skip`); return; }
      themeRunning = true;
      try {
        const gotLock = await withPgLock(pool, LOCK_THEME, async () => {
          await runThemeAnalysis({ pool, label });
        });
        if (!gotLock) console.log(`[cron] themeAnalysis(${label}) PG lock busy, skip`);
      }
      finally { themeRunning = false; }
    } catch (e) { console.error(`[cron] themeAnalysis(${label}) failed:`, e.message); }
  }, { timezone: "Asia/Shanghai" });
  scheduleThemeAnalysis("15 9 * * 1-5", "盘前");
  scheduleThemeAnalysis("*/30 9-14 * * 1-5", "盘中");
  scheduleThemeAnalysis("5 15 * * 1-5", "盘后");
};

/** 单只拍板回填：拉日K，定位拍板日 → T+1/T+5 收盘涨跌幅%（优先 T+5） */

// 导出抓取函数供验证/手动触发用
module.exports = startCron;
module.exports.fetchZTPool = fetchZTPool;
module.exports.fetchFastNews = fetchFastNews;
module.exports.runThemeAnalysis = runThemeAnalysis;
module.exports.runTradeBackfill = runTradeBackfill;
module.exports.runPostSummary = runPostSummary;
module.exports.runUserStyleProfile = runUserStyleProfile;
module.exports.runNewsFeedSync = runNewsFeedSync; // v9.124.0（蓝图 4A T-资讯-1）
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
module.exports.runIntradayBrain = runIntradayBrain; // v9.84.2/3：盘中大脑快照+板块异动（手动触发/测试）
// v9.85.0（P1-4）：主题分析并发锁暴露 —— db.js 手动触发与 cron 定时共用同一把锁（防并发耗尽 LLM 配额）
module.exports.getThemeBusy = () => themeRunning;
module.exports.setThemeBusy = (v) => { themeRunning = Boolean(v); };

