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

/** v9.108.2（D-2）：读 kv 值 + updated_at（多源 asOf 用；无行返回 null） */
async function kvReadMeta(pool, key) {
  const r = await pool.query("SELECT value, updated_at FROM kv_store WHERE key=$1", [key]);
  if (!r.rows.length) return null;
  let v = r.rows[0].value;
  if (v && typeof v === "object" && "__raw" in v) {
    try { v = JSON.parse(v.__raw); } catch { return null; }
  }
  return { value: v, ts: r.rows[0].updated_at ? new Date(r.rows[0].updated_at).getTime() : null };
}

function num(v) { return typeof v === "number" && Number.isFinite(v) ? v : null; }

/**
 * 构建大脑快照
 * @param pool PG 连接池
 * @param dateStr 可选，默认今日（YYYY-MM-DD）
 */
async function buildBrainContext(pool, dateStr = bjDateStr()) {
  // v9.108.2（D-2）：market_daily 今日为空 → 回退最近 5 个交易日（自动切换最近可用日，满足"看不到今天就退而求昨天"）
  // 每源带 updated_at（多源 asOf + 延迟标注）
  let mdMeta = await kvReadMeta(pool, `market_daily:${dateStr}`);
  let usedDate = dateStr;
  let fallbackDate = null;
  if (!mdMeta || mdMeta.value == null) {
    for (let i = 1; i <= 5; i++) {
      const d = new Date(Date.now() + 8 * 3600 * 1000 - i * 24 * 3600 * 1000).toISOString().slice(0, 10);
      const cand = await kvReadMeta(pool, `market_daily:${d}`);
      if (cand && cand.value != null) { mdMeta = cand; usedDate = d; fallbackDate = d; break; }
    }
  }
  const [sentMeta, snapMeta, intraR, themeMeta, bsR, evR, fundMeta, lhbR, ztR, annR] = await Promise.allSettled([
    kvReadMeta(pool, `sentiment:${usedDate}`),
    // v9.115.0（S1-4 情绪源优先级修正）：sentiment_snapshot（服务端权威盘中每 5min 采样）——
    //   原只读 sentiment:键（前端 localStorage 经 cloudStore 同步的局部值，可能残留旧会话），
    //   盘中链正常时 snapshot 优先；snapshot 缺失（盘中链断/盘后未跑）回退 sentiment:键
    kvReadMeta(pool, `sentiment_snapshot:${usedDate}`),
    kvRead(pool, `market_intraday:${usedDate}`),
    kvReadMeta(pool, "theme_analysis:latest"),
    kvRead(pool, `black_swan:${usedDate}`),
    kvRead(pool, `event_classify:${usedDate}`),
    kvReadMeta(pool, `fund_streak:${usedDate}`),
    kvRead(pool, `lhb:${usedDate}`),
    pool.query("SELECT data FROM zt_snapshot WHERE date=$1 LIMIT 1", [usedDate]),
    pool.query(
      `SELECT title, column_name, score, stock_name, stock_code, time
       FROM announcements WHERE time LIKE $1 AND score >= 3 ORDER BY time DESC LIMIT 10`,
      [`${usedDate}%`],
    ),
  ]);

  // ---------- 市场情绪/指标 ----------
  const mdValue = mdMeta?.value ?? null;
  // v9.115.0（S1-4）：情绪值两优先 —— sentiment_snapshot（服务端盘中每 5min 采样，权威）> sentiment（前端同步）> null
  const sentVal = (() => {
    if (snapMeta.status === "fulfilled" && snapMeta.value?.ts) {
      const sv = Number(snapMeta.value.value?.sentiment);
      if (Number.isFinite(sv)) return { score: sv, ts: snapMeta.value.ts };
    }
    if (sentMeta.status === "fulfilled" && sentMeta.value?.ts) {
      const snap = sentMeta.value.value;
      const sv = snap && typeof snap === "object" ? Number(snap.sentiment) : Number(snap);
      if (Number.isFinite(sv)) return { score: sv, ts: sentMeta.value.ts };
    }
    return null;
  })();
  const market = {
    ztCount: num(mdValue?.ztCount),
    zbCount: num(mdValue?.zbCount),
    dtCount: num(mdValue?.dtCount),
    blastedRate: num(mdValue?.blastedRate),
    maxBoardHeight: num(mdValue?.maxBoardHeight),
    premiumAvg: num(mdValue?.premiumAvg),
    promotionRate: num(mdValue?.promotionRate),
    lhbBoostCount: num(mdValue?.lhbBoostCount),
    sentiment: sentVal ? sentVal.score : null,
  };

  // ---------- 涨停梯队（当日 zt_snapshot） ----------
  let limitLadder = { total: 0, maxBoard: 0, ladder: [], boards: [], boardCounts: {} };
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
      // v9.113.1（T1-1 D-01 收尾）：boardCounts 全量连板高度分布（lbc→只数）——
      // 前端 PG-first 涨停池合成需要完整分布（ladder 仅 20 条截断，缺失则连板分布失真）
      const byLbc = new Map();
      for (const r of rows) byLbc.set(r.lbc, (byLbc.get(r.lbc) ?? 0) + 1);
      limitLadder = {
        total: rows.length,
        maxBoard: rows.length ? Math.max(...rows.map(r => r.lbc)) : 0,
        ladder: rows.sort((a, b) => b.lbc - a.lbc).slice(0, 20),
        boards: [...byBoard.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([board, count]) => ({ board, count })),
        boardCounts: Object.fromEntries([...byLbc.entries()].sort((a, b) => b[0] - a[0])),
      };
    }
  }

  // ---------- 主线 Top3（theme_analysis:latest） ----------
  let mainlines = { asOf: null, top: [], all: [] };
  if (themeMeta.status === "fulfilled" && themeMeta.value?.value?.themes) {
    const themes = themeMeta.value.value.themes;
    const sorted = [...themes].sort((a, b) => (num(b.heat) ?? 0) - (num(a.heat) ?? 0));
    const slim = (t) => ({
      theme: t.theme, heat: t.heat, trend: t.trend, verdict: t.verdict,
      action: t.action, fundAnalysis: t.fundAnalysis,
      picks: (t.picks ?? []).slice(0, 5).map(p => ({ code: p.code, name: p.name, correlation: p.correlation, aiVerdict: p.aiVerdict })),
      etfs: (t.etfs ?? []).slice(0, 5),
    });
    mainlines = {
      asOf: themeMeta.value.value.key ?? null,
      top: sorted.slice(0, 3).map(slim),
      all: sorted.slice(0, 8).map(slim),
    };
  }

  // ---------- 板块资金（fund_streak 当日，mainNet 排序 top10） ----------
  // fund_streak items 结构：{ code, name(板块名), mainNet }（fetchBoardFundServer 落库）
  let boardFund = { items: [] };
  const fundValue = fundMeta.status === "fulfilled" ? fundMeta.value?.value : null;
  if (fundValue && Array.isArray(fundValue.items)) {
    boardFund.items = fundValue.items
      .filter(i => i && i.name)
      .sort((a, b) => (num(b.mainNet) ?? -Infinity) - (num(a.mainNet) ?? -Infinity))
      .slice(0, 10)
      .map(i => ({
        board: i.name,
        mainNet: num(i.mainNet),
        // v9.123.0（卓越审查 P0-3）：明暗盘明细透传（认知层暗盘/明盘判定用；旧数据无字段 → null）
        superBig: num(i.superBig), big: num(i.big), mid: num(i.mid), small: num(i.small),
      }));
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

  // v9.108.2（D-2）：多源 asOf（每源 updated_at）+ snapshotVersion + fallbackDate（回退最近可用日标记）
  const tsOf = (p) => (p.status === "fulfilled" && p.value?.ts ? p.value.ts : null);
  const sources = {
    market: mdMeta?.ts ?? null,
    sentiment: sentVal ? sentVal.ts : null, // v9.115.0（S1-4）：与 market.sentiment 同源（snapshot 优先）
    theme: tsOf(themeMeta),
    fund: tsOf(fundMeta),
    zt: ztR.status === "fulfilled" && ztR.value.rows[0] ? Date.now() : null, // zt_snapshot 无 updated_at 列，近似当前
  };
  return {
    date: usedDate, // v9.108.2（D-2）：数据实际日期（回退时为最近可用交易日）
    fallbackDate,  // 非空 = 今日无数据，回退到了该日期
    snapshotVersion: Date.now(), // 每次 build 递增（时间戳整数）
    sources,
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
