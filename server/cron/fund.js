// ============================================================
// server/cron/fund.js —— 领域模块（v9.139.0 阶段二 #16，split-cron.js 自动拆分）
// 行为与原 cron.js 逐字一致；原文件已只留调度注册
// ============================================================
const B = require("./base");
const { contentKey, httpsGet, bjDate, bjDateStr, EM_UT, detectSealDecayServer, markCronStep, hasCronStep, isTradingDayCN, getJson, getJsonWithFallback, requestRaw, parseLLMJSON, SCHEMAS, withPgLock, LOCK_CRON_MAIN, LOCK_THEME, LOCK_WATCH, LOCK_INTRADAY, callLLM, saveFactorIc } = B;


// ---------- v9.36（A3）：龙虎榜采集（与涨停池交叉，识别席位加持） ----------
// 涨停 + 龙虎榜净买入 = 次日溢价增强信号；RPT_DAILYBILLBOARD_DETAILSNEW 当日盘后数据
// v9.77（A7-01 修复）：① 只取指定交易日（默认当日）的行 —— 原 15:40 抓时当日榜单未公布
//   （东财 16:00 起更新），接口按 TRADE_DATE 倒序返回全为昨日数据，被原样存进"今日"key，
//   导致交叉面板整晚错日对齐、伪造"席位加持"；② 每条携带 tradeDate 日期自证。
async function fetchLhbDaily(dateStr) {
  const url = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_DAILYBILLBOARD_DETAILSNEW&columns=ALL&pageSize=300&source=WEB&client=WEB&sortColumns=TRADE_DATE&sortTypes=-1`;
  const j = await httpsGet(url);
  const rows = j?.result?.data ?? [];
  const want = dateStr || bjDateStr();
  return rows
    .filter(r => String(r.TRADE_DATE ?? "").slice(0, 10) === want)
    .map(r => ({
      code: String(r.SECURITY_CODE ?? ""),
      name: String(r.SECURITY_NAME_ABBR ?? ""),
      pct: Number(r.CHANGE_RATE ?? 0),
      buyAmt: Number(r.BILLBOARD_BUY_AMT ?? 0),   // 龙虎榜买入额（元）
      sellAmt: Number(r.BILLBOARD_SELL_AMT ?? 0),
      netBuy: Number(r.BILLBOARD_BUY_AMT ?? 0) - Number(r.BILLBOARD_SELL_AMT ?? 0),
      explain: String(r.EXPLANATION ?? r.EXPLAIN ?? ""),  // 上榜原因（如"日涨幅偏离值达7%"）
      tradeDate: String(r.TRADE_DATE ?? "").slice(0, 10), // v9.77：日期自证（前端交叉前校验）
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

async function fetchBoardQuotes() {
  // 行业板块行情+资金（m:90+t:2）：f3 涨跌幅 / f12 代码 / f14 名称 / f62 主力净额
  const fs = encodeURIComponent("m:90+t:2");
  const url = `${HOST_FUND}/api/qt/clist/get?ut=${EM_UT}&pn=1&pz=100&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${fs}&fields=f12,f14,f3,f62`;
  const j = await httpsGet(url);
  const d = j?.data?.diff;
  const arr = Array.isArray(d) ? d : (d && typeof d === "object" ? Object.values(d) : []);
  return arr.map(it => ({
    code: String(it?.f12 ?? ""), name: String(it?.f14 ?? ""),
    pct: Number(it?.f3 ?? 0), mainNet: Number(it?.f62 ?? 0),
  })).filter(x => x.code && x.name);
}

async function notifyWatchedStockAlerts(pool, blackSwans, anns) {
  try {
    const wRes = await pool.query(`SELECT code, name FROM price_watch WHERE status='active'`);
    const watched = new Map(wRes.rows.map(r => [String(r.code), String(r.name || r.code)]));
    if (watched.size === 0) return 0;
    let fired = 0;
    for (const bs of blackSwans || []) {
      const code = String(bs.code ?? bs.stockCode ?? "");
      if (!watched.has(code)) continue;
      // 当日已推过同类 → 跳过（20min cron 每轮都会抓到同一条）
      const dup = await pool.query(
        `SELECT 1 FROM price_watch_events WHERE code=$1 AND event_text LIKE '🚨 利空%' AND created_at >= now() - interval '1 day' LIMIT 1`, [code],
      ).catch(() => ({ rows: [] }));
      if (dup.rows.length > 0) continue;
      await pool.query(
        `INSERT INTO price_watch_events(code,name,price,mid_price,deviation_pct,event_text)
         VALUES($1,$2,0,0,0,$3)`,
        [code, watched.get(code), `🚨 利空公告：${String(bs.title ?? "").slice(0, 80)}`],
      ).catch(() => {});
      fired++;
      try {
        const pushReq = require("../routes/push");
        if (typeof pushReq.sendPushIfConfigured === "function") {
          await pushReq.sendPushIfConfigured({
            title: `🚨 盯价股利空：${watched.get(code)}`,
            body: `${String(bs.title ?? "").slice(0, 120)}`,
            severity: "critical",
          }, pool);
        }
      } catch { /* 推送失败静默（事件已落库，前端可见） */ }
    }
    for (const a of anns || []) {
      const code = String(a.stockCode ?? "");
      if (!watched.has(code) || !GOOD_ANN_RE.test(String(a.title ?? ""))) continue;
      const dup = await pool.query(
        `SELECT 1 FROM price_watch_events WHERE code=$1 AND event_text LIKE '🟢 利好%' AND created_at >= now() - interval '1 day' LIMIT 1`, [code],
      ).catch(() => ({ rows: [] }));
      if (dup.rows.length > 0) continue;
      await pool.query(
        `INSERT INTO price_watch_events(code,name,price,mid_price,deviation_pct,event_text)
         VALUES($1,$2,0,0,0,$3)`,
        [code, watched.get(code), `🟢 利好公告：${String(a.title ?? "").slice(0, 80)}`],
      ).catch(() => {});
      fired++;
    }
    if (fired > 0) console.log(`[cron] 盯价股公告告警: ${fired} 条`);
    return fired;
  } catch (e) { console.error("[cron] notifyWatchedStockAlerts:", e.message); return 0; }
}

async function fetchBoardFundServer() {
  const fs = encodeURIComponent("m:90+t:2");
  // v9.123.0（卓越审查 P0-3）：加明暗盘明细字段——f66 超大单/f72 大单（暗盘）、f78 中单/f84 小单（明盘）
  const fields = "f12,f14,f62,f66,f72,f78,f84";
  const urlOf = (po) => `${HOST_FUND}/api/qt/clist/get?ut=${EM_UT}&pn=1&pz=100&po=${po}&np=1&fltt=2&invt=2&fid=f62&fs=${fs}&fields=${fields}`;
  const norm = (j) => {
    const d = j?.data?.diff;
    if (Array.isArray(d)) return d;
    if (d && typeof d === "object") return Object.values(d);
    return [];
  };
  // 明细字段缺失（接口未返回）→ null（下游按 null 判"无明暗盘数据"诚实降级，不冒充 0）
  const numF = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v))) ? null : Number(v);
  const merged = new Map();
  // 串行拉取（并发会限流）；失败降级（只有一端也能用）
  for (const po of [1, 0]) {
    try {
      const j = await httpsGet(urlOf(po));
      for (const it of norm(j)) {
        const code = String(it?.f12 ?? "");
        if (code) merged.set(code, {
          code, name: String(it?.f14 ?? ""), mainNet: Number(it?.f62 ?? 0),
          superBig: numF(it?.f66), big: numF(it?.f72), mid: numF(it?.f78), small: numF(it?.f84),
        });
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

const GOOD_ANN_RE = /(重大合同|中标|业绩预增|大幅预增|预盈|回购|增持计划|获批|重组|收购|签署|中标)/;

const HOST_FUND = "https://push2delay.eastmoney.com";
module.exports = { fetchLhbDaily, fetchMarketIntraday, fetchBoardQuotes, notifyWatchedStockAlerts, fetchBoardFundServer, fetchBlockTrades };

