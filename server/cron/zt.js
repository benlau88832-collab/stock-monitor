// ============================================================
// server/cron/zt.js —— 领域模块（v9.139.0 阶段二 #16，split-cron.js 自动拆分）
// 行为与原 cron.js 逐字一致；原文件已只留调度注册
// ============================================================
const B = require("./base");
const { contentKey, httpsGet, bjDate, bjDateStr, EM_UT, detectSealDecayServer, markCronStep, hasCronStep, isTradingDayCN, getJson, getJsonWithFallback, requestRaw, parseLLMJSON, SCHEMAS, withPgLock, LOCK_CRON_MAIN, LOCK_THEME, LOCK_WATCH, LOCK_INTRADAY, callLLM, saveFactorIc } = B;
const { fetchLhbDaily, fetchBoardFundServer } = require("./fund");


// ---------- v9.35（S3）：市场日指标落库（信号回测的数据源） ----------
// 目的：给前端 signalBacktest 提供"每日市场指标"历史序列（涨停/跌停/炸板/最高板）。
// 情绪分由前端 cloudStore 已同步（kv sentiment:日期 = 数字分），本键只补池类指标。
async function fetchMarketDaily(pool) {
  const date = bjDate();
  const dateStr = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  const zt = await httpsGet(`https://push2ex.eastmoney.com/getTopicZTPool?ut=${EM_UT}&dpt=wz.ztzt&Pageindex=0&pagesize=500&sort=fbt%3Aasc&date=${date}`);
  const zb = await httpsGet(`https://push2ex.eastmoney.com/getTopicZBPool?ut=${EM_UT}&dpt=wz.ztzt&Pageindex=0&pagesize=500&sort=fbt%3Aasc&date=${date}`);
  // v9.101.0（P1-01 返工）：跌停池空响应重试一次（push2ex 间歇性抖动，验收实测 dtCount=0 但跌停池实有 1 只）
  let dt = await httpsGet(`https://push2ex.eastmoney.com/getTopicDTPool?ut=${EM_UT}&dpt=wz.ztzt&Pageindex=0&pagesize=500&sort=fbt%3Aasc&date=${date}`);
  if (!dt?.data?.pool?.length) {
    await new Promise(r => setTimeout(r, 1500));
    dt = await httpsGet(`https://push2ex.eastmoney.com/getTopicDTPool?ut=${EM_UT}&dpt=wz.ztzt&Pageindex=0&pagesize=500&sort=fbt%3Aasc&date=${date}`);
  }
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
  // v9.99.2（全栈体检 B7）：补 sentiment —— market_daily 此前无情绪字段 → 情绪叙事报告"情绪温度计 —"。
  //   盘中 sentiment_snapshot:日期 每 5 分钟落库（对象 {date,ts,sentiment,label}），收盘时合并最新值
  try {
    const sentR = await pool.query(`SELECT value FROM kv_store WHERE key = $1`, [`sentiment_snapshot:${dateStr}`]);
    const sentV = sentR.rows[0]?.value;
    if (sentV != null) md.sentiment = typeof sentV === "object" && Number.isFinite(Number(sentV.sentiment)) ? Number(sentV.sentiment) : null;
  } catch { md.sentiment = null; }
  // premiumAvg（昨日涨停股今日平均涨幅）+ promotionRate（昨日首板今日继续涨停比例）
  // v9.75（正确性修复）：zt_snapshot.date 存储为带横杠 dateStr（fetchZTPool 返回），
  // 原用无横杠 bjDate() 比较（"2026-08-08" < "20260808" 恒真）→ 今天自己的行被当"昨日快照"，premium 今日算今日
  try {
    const prevSnap = await pool.query(`SELECT data FROM zt_snapshot WHERE date < $1 ORDER BY date DESC LIMIT 1`, [dateStr]);
    let prevPool = [];
    if (prevSnap.rows[0]?.data) {
      // v9.75（安全/正确性修复）：data 为 jsonb，node-postgres 默认已解析为对象，直接 JSON.parse 会抛错被吞 → 兼容两种
      try { const prevRaw = typeof prevSnap.rows[0].data === "string" ? JSON.parse(prevSnap.rows[0].data) : prevSnap.rows[0].data; prevPool = prevRaw.pool ?? []; } catch { prevPool = []; }
    }
    if (prevPool.length > 0) {
      const todayCodes = new Set(ztPool.map(p => String(p.c)));
      const prevFirst = prevPool.filter(p => Number(p.lbc ?? 1) === 1);
      // 晋级率：昨日首板 → 今日仍涨停 占比
      md.promotionRate = prevFirst.length > 0
        ? Math.round(prevFirst.filter(p => todayCodes.has(String(p.c))).length / prevFirst.length * 1000) / 1000
        : null;
      // 溢价均值：昨日涨停股今日平均涨幅 —— v9.127.0（蓝图数据质量修复）：
      //   根因：push2delay ulist.np 字段错位（v9.123.0 实测 f43=434629 而非 1343，ut 混用），
      //   依赖它的 premiumAvg 历史恒 null → 情绪周期回测样本为 0。
      //   修复：主源腾讯 qt.gtimg.cn 批量（GBK rawBuffer + parseTencentQuotesBatch 纯函数，本机实测可用），
      //   push2delay ulist 降级；双源皆失败 → null（诚实，回测引擎按 null 排除样本）。
      const codes = [...new Set(prevPool.map(p => String(p.c)))];
      const { parseTencentQuotesBatch } = require("../lib/stockSnapshot");
      const pcts = [];
      for (let i = 0; i < codes.length; i += 50) {
        const batch = codes.slice(i, i + 50);
        const q = batch.map(c => (c.startsWith("6") ? "sh" : c.startsWith("4") || c.startsWith("8") ? "bj" : "sz") + c).join(",");
        try {
          const { body } = await requestRaw(`https://qt.gtimg.cn/q=${q}`, { timeout: 5000, rawBuffer: true }); // GBK → rawBuffer
          for (const [, pct] of parseTencentQuotesBatch(body)) {
            if (pct != null) pcts.push(pct);
          }
        } catch { /* 单批失败跳过，聚合其余批次 */ }
      }
      if (pcts.length === 0) {
        // 腾讯失败 → push2delay ulist 降级（历史实现；字段错位风险存在，仅兜底）
        try {
          const secids = codes.map(c => (c.startsWith("6") ? "1." : "0.") + c).join(",");
          const bj = await httpsGet(`https://push2delay.eastmoney.com/api/qt/ulist.np/get?ut=${EM_UT}&fltt=2&fields=f3,f12&secids=${secids}`);
          const diff = bj?.data?.diff;
          const rows = Array.isArray(diff) ? diff : (diff && typeof diff === "object" ? Object.values(diff) : []);
          const p2 = rows.map(r => Number(r?.f3)).filter(v => Number.isFinite(v));
          if (p2.length > 0 && p2.every(v => Math.abs(v) < 30)) pcts.push(...p2); // 错位值常为天文数字 → |v|<30 才可信
        } catch { /* 双源皆失败 → null */ }
      }
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
        // v9.75（正确性修复）：value 为 jsonb 已自动解析，兼容字符串/对象两种形态
        if (r.rows[0]?.value) { try { items = (typeof r.rows[0].value === "string" ? JSON.parse(r.rows[0].value) : r.rows[0].value).items ?? []; } catch { items = []; } }
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
module.exports = { fetchMarketDaily, fetchNuclearCount, fetchZTPool };

