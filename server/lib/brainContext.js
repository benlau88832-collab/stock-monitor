// ============================================================
// v9.84.2（AI大脑层）：全站快照聚合 —— /api/brain/context 数据源
// 目的：AIConsole 对话与决策 Agent 共享一份"大脑快照"，
//   一次请求拿到 情绪/涨停梯队/主线Top3/板块资金/龙虎榜/黑天鹅/公告强催化/次日闸门，
//   消灭前端碎片化 prompt 拼装（每个任务各拼一遍盘面摘要）。
// 数据源全部来自 PG（cron 已落库），单次聚合并行读取，超时各块独立不互相阻塞。
// ============================================================

// ---------- 北京日期 ----------
function bjDateStr() {
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  return now.toISOString().slice(0, 10);
}

/** 读 kv_store 并解析（JSONB 已被 pg 解析为对象；兼容 {__raw} 字符串形态） */
async function kvRead(pool, key) {
  const r = await pool.query("SELECT value FROM kv_store WHERE key=$1", [key]);
  if (!r.rows.length) return null;
  let v = r.rows[0].value;
  if (v && typeof v === "object" && "__raw" in v) {
    try { v = JSON.parse(v.__raw); } catch { return null; }
  }
  return v;
}

function num(v) { return typeof v === "number" && Number.isFinite(v) ? v : null; }

/**
 * 构建大脑快照
 * @param pool PG 连接池
 * @param dateStr 可选，默认今日（YYYY-MM-DD）
 */
async function buildBrainContext(pool, dateStr = bjDateStr()) {
  const [mdR, sentR, intraR, themeR, bsR, evR, fundR, lhbR, ztR, annR] = await Promise.allSettled([
    kvRead(pool, `market_daily:${dateStr}`),
    kvRead(pool, `sentiment:${dateStr}`),
    kvRead(pool, `market_intraday:${dateStr}`),
    kvRead(pool, "theme_analysis:latest"),
    kvRead(pool, `black_swan:${dateStr}`),
    kvRead(pool, `event_classify:${dateStr}`),
    kvRead(pool, `fund_streak:${dateStr}`),
    kvRead(pool, `lhb:${dateStr}`),
    pool.query("SELECT data FROM zt_snapshot WHERE date=$1 LIMIT 1", [dateStr]),
    pool.query(
      `SELECT title, column_name, score, stock_name, stock_code, time
       FROM announcements WHERE time LIKE $1 AND score >= 3 ORDER BY time DESC LIMIT 10`,
      [`${dateStr}%`],
    ),
  ]);

  // ---------- 市场情绪/指标 ----------
  const market = {
    ztCount: num(mdR.status === "fulfilled" ? mdR.value?.ztCount : null),
    zbCount: num(mdR.status === "fulfilled" ? mdR.value?.zbCount : null),
    dtCount: num(mdR.status === "fulfilled" ? mdR.value?.dtCount : null),
    blastedRate: num(mdR.status === "fulfilled" ? mdR.value?.blastedRate : null),
    maxBoardHeight: num(mdR.status === "fulfilled" ? mdR.value?.maxBoardHeight : null),
    premiumAvg: num(mdR.status === "fulfilled" ? mdR.value?.premiumAvg : null),
    promotionRate: num(mdR.status === "fulfilled" ? mdR.value?.promotionRate : null),
    lhbBoostCount: num(mdR.status === "fulfilled" ? mdR.value?.lhbBoostCount : null),
    sentiment: sentR.status === "fulfilled" ? num(sentR.value) : null,
  };

  // ---------- 涨停梯队（当日 zt_snapshot） ----------
  let limitLadder = { total: 0, maxBoard: 0, ladder: [], boards: [] };
  if (ztR.status === "fulfilled" && ztR.value.rows[0]) {
    const data = ztR.value.rows[0].data;
    const poolArr = Array.isArray(data) ? data : data?.pool;
    if (Array.isArray(poolArr)) {
      const rows = poolArr.map(p => ({
        code: String(p?.c ?? p?.code ?? ""), name: p?.n ?? p?.name, lbc: num(p?.lbc) ?? 1,
        hybk: p?.hybk ?? "", fund: num(p?.fund),
      })).filter(r => r.code);
      const byBoard = new Map();
      for (const r of rows) {
        const b = r.hybk || "其他";
        byBoard.set(b, (byBoard.get(b) ?? 0) + 1);
      }
      limitLadder = {
        total: rows.length,
        maxBoard: rows.length ? Math.max(...rows.map(r => r.lbc)) : 0,
        ladder: rows.sort((a, b) => b.lbc - a.lbc).slice(0, 20),
        boards: [...byBoard.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([board, count]) => ({ board, count })),
      };
    }
  }

  // ---------- 主线 Top3（theme_analysis:latest） ----------
  let mainlines = { asOf: null, top: [], all: [] };
  if (themeR.status === "fulfilled" && themeR.value?.themes) {
    const themes = themeR.value.themes;
    const sorted = [...themes].sort((a, b) => (num(b.heat) ?? 0) - (num(a.heat) ?? 0));
    const slim = (t) => ({
      theme: t.theme, heat: t.heat, trend: t.trend, verdict: t.verdict,
      action: t.action, fundAnalysis: t.fundAnalysis,
      picks: (t.picks ?? []).slice(0, 5).map(p => ({ code: p.code, name: p.name, correlation: p.correlation, aiVerdict: p.aiVerdict })),
      etfs: (t.etfs ?? []).slice(0, 5),
    });
    mainlines = {
      asOf: themeR.value.key ?? null,
      top: sorted.slice(0, 3).map(slim),
      all: sorted.slice(0, 8).map(slim),
    };
  }

  // ---------- 板块资金（fund_streak 当日，mainNet 排序 top10） ----------
  // fund_streak items 结构：{ code, name(板块名), mainNet }（fetchBoardFundServer 落库）
  let boardFund = { items: [] };
  if (fundR.status === "fulfilled" && Array.isArray(fundR.value?.items)) {
    boardFund.items = fundR.value.items
      .filter(i => i && i.name)
      .sort((a, b) => (num(b.mainNet) ?? -Infinity) - (num(a.mainNet) ?? -Infinity))
      .slice(0, 10)
      .map(i => ({ board: i.name, mainNet: num(i.mainNet) }));
  }

  // ---------- 龙虎榜（净买入 top15） ----------
  let lhb = { items: [] };
  if (lhbR.status === "fulfilled" && Array.isArray(lhbR.value?.items)) {
    lhb.items = lhbR.value.items
      .filter(i => i && i.code)
      .sort((a, b) => (num(b.netBuy) ?? -Infinity) - (num(a.netBuy) ?? -Infinity))
      .slice(0, 15)
      .map(i => ({ code: i.code, name: i.name, netBuy: num(i.netBuy), pct: num(i.pct) }));
  }

  // ---------- 黑天鹅 / 事件分级 / 公告强催化 ----------
  const blackSwans = (bsR.status === "fulfilled" && Array.isArray(bsR.value?.items))
    ? bsR.value.items.slice(0, 20).map(i => ({
        code: i.code, title: i.title, level: i.level ?? "unknown", time: i.time ?? "",
      }))
    : [];

  const events = (evR.status === "fulfilled" && Array.isArray(evR.value?.items))
    ? evR.value.items.slice(0, 20).map(i => ({
        title: i.title ?? i.name ?? "", level: i.level ?? "", score: num(i.catalystScore ?? i.score),
        code: i.code ?? "", time: i.time ?? "",
      }))
    : [];

  const strongNews = annR.status === "fulfilled"
    ? annR.value.rows.map(r => ({
        code: r.stock_code, name: r.stock_name, title: r.title,
        column: r.column_name, score: r.score, time: r.time,
      }))
    : [];

  // ---------- 次日闸门（从 market_daily 推导，与前端 gateMode 同语义） ----------
  const gate = (() => {
    const m = market;
    if (m.ztCount == null) return { mode: "empty", factor: 0.5, label: "数据未就绪" };
    const pos = (m.sentiment ?? 50) + (m.promotionRate ?? 0.5) * 30 + (m.premiumAvg ?? 0) * 4 - (m.blastedRate ?? 0);
    const mode = pos >= 80 ? "full" : pos >= 60 ? "normal" : pos >= 40 ? "watch" : "shut";
    return { mode, factor: Math.max(0.2, Math.min(1, pos / 100)), label: `${mode}（情绪${m.sentiment ?? "?"}·炸板${m.blastedRate ?? "?"}%·最高${m.maxBoardHeight ?? "?"}板）` };
  })();

  return {
    date: dateStr,
    market,
    limitLadder,
    mainlines,
    boardFund,
    lhb,
    blackSwans,
    events,
    strongNews,
    gate,
  };
}

module.exports = { buildBrainContext };
