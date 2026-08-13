// ============================================================
// v9.96.0（批次 1）：市场情绪分析中心 —— VibeAlpha 全栈落地（服务端）
// 1. determineCyclePhaseVibeAlpha：5 档周期规则引擎（纯 if-else 无 LLM，对照 market_cycle.py）
// 2. computeStockSentimentScore：个股情绪分 40/30/20/10 加权合成（缺项重归一化，全缺默认 50）
// 3. generateEmotionReport：拉 market_daily/zt_snapshot/news → 周期判定 → LLM 叙事报告 → kv 落库
// 注：舆情三分类（人气榜）在前端做（fetchHotRank 数据仅前端有），报告展示时前端传入人气榜补充
// ============================================================
const { callModelText } = require("./httpProxy");
const { buildPrompt } = require("./aiPrompts");

// ---------- 1. 周期判定（v9.129.0 一致性收敛） ----------
// 唯一判定 = 认知层 deriveSentimentStage（六词，全站情绪周期唯一词表）——
//   原 5 档组合词（冰点/退潮、强分歧/炸板潮、高潮/主升…）与认知层词表互斥，已废弃。
// sealRate/涨停/高度/跌停 仅作辅助证据，不参与阶段判定。
function determineCyclePhaseVibeAlpha(metrics) {
  const { deriveSentimentStage } = require("./cognition");
  const ztCount = metrics.ztCount ?? 0;
  const zbCount = metrics.zbCount != null ? metrics.zbCount : null;
  const sealRate = metrics.sealRate != null ? metrics.sealRate
    : (zbCount != null && ztCount + zbCount > 0 ? ztCount / (ztCount + zbCount) * 100 : null);
  const score = typeof metrics.sentiment === "number" && Number.isFinite(metrics.sentiment)
    ? Math.max(0, Math.min(100, metrics.sentiment)) : 50;
  const premium = typeof metrics.premiumAvg === "number" && Number.isFinite(metrics.premiumAvg) ? metrics.premiumAvg : 0;
  const blastedPct = typeof metrics.blastedRate === "number" && Number.isFinite(metrics.blastedRate)
    ? metrics.blastedRate : (zbCount != null && ztCount + zbCount > 0 ? zbCount / (ztCount + zbCount) * 100 : 0);
  const phase = deriveSentimentStage(score, premium, blastedPct / 100);
  return { phase, sealRate, rule: `认知层判定：情绪${score}分/溢价${premium}/炸板率${blastedPct.toFixed(0)}%` };
}

// ---------- 2. 个股情绪分加权合成（VibeAlpha sentiment.py 对照） ----------
// 分项：5日主力净流入(40) / 主力流入趋势(30) / 北向5日(20) / 散户流出占比(10)
// 缺项按剩余权重重归一化；全缺默认中性 50
function computeStockSentimentScore(parts) {
  const items = [
    { weight: 40, value: parts.mainNet5dRatio },     // 5日主力净流入归一化（-1~1 → 0-100）
    { weight: 30, value: parts.mainNetTrend },       // 流入趋势（后半段-前半段）/前半段，clamp ±2
    { weight: 20, value: parts.northbound5d },       // 北向 5 日累计（相对强度 -1~1）
    { weight: 10, value: parts.retailSellRatio },    // 散户流出占比 0~1（反向指标）
  ].filter(it => it.value != null && Number.isFinite(it.value));

  if (items.length === 0) return { score: 50, parts: [], weights: [] };

  const totalWeight = items.reduce((s, it) => s + it.weight, 0);
  let score = 0;
  const detail = [];
  for (const it of items) {
    // 各分项归一化到 0-100（50 为中性）：
    //  mainNet5dRatio: -1~1 → 50 + v*40；trend: ±2 → 50 + v*20；northbound: -1~1 → 50 + v*25；retail: 反向 50 - v*30
    let v01 = 50;
    if (it.weight === 40) v01 = 50 + it.value * 40;
    else if (it.weight === 30) v01 = 50 + Math.max(-2, Math.min(2, it.value)) * 20;
    else if (it.weight === 20) v01 = 50 + it.value * 25;
    else v01 = 50 - it.value * 30;
    v01 = Math.max(0, Math.min(100, v01));
    score += v01 * (it.weight / totalWeight); // 缺项重归一化
    detail.push({ weight: it.weight, value: it.value, norm: Math.round(v01) });
  }
  return { score: Math.round(score), parts: detail, weights: items.map(i => i.weight) };
}

// ---------- 3. 叙事报告生成 ----------
/** 组装报告输入（market_daily + zt_snapshot + news 舆情） */
async function collectEmotionMetrics(pool, dateStr) {
  const out = { date: dateStr, metrics: null, newsStats: null, error: null };
  try {
    // v9.99.2（全栈体检 C1）：按传入 dateStr 精确取 market_daily —— 原实现 `LIKE 'market_daily:%' ORDER BY key DESC LIMIT 1`
    //   完全忽略日期参数，盘中/盘前最新的一条是昨天的 → 情绪报告"运行分析"永远生成昨天数据、落库昨天 key、前端误判成功。
    //   现在：精确 key 查不到 → 明确报错（前端提示"今日收盘快照未生成"），不再静默用旧数据冒充
    const mdR = await pool.query(
      `SELECT key, value FROM kv_store WHERE key = $1`, [`market_daily:${dateStr}`],
    );
    if (mdR.rows.length === 0) { out.error = `今日收盘快照未生成（market_daily:${dateStr} 缺失，cron 15:40 落库）`; return out; }
    let md = mdR.rows[0].value;
    if (typeof md === "string") { try { md = JSON.parse(md); } catch { /* 保持原样 */ } }
    const date = String(mdR.rows[0].key).replace("market_daily:", "");
    const ztCount = md.ztCount ?? 0;
    const zbCount = md.zbCount ?? 0;
    const dtCount = md.dtCount ?? 0;
    const metrics = {
      date,
      ztCount,
      zbCount,
      dtCount,
      blastedRate: md.blastedRate ?? (ztCount + zbCount > 0 ? zbCount / (ztCount + zbCount) * 100 : null),
      maxBoardHeight: md.maxBoardHeight ?? md.height ?? null,
      premiumAvg: md.premiumAvg ?? null,
      promotionRate: md.promotionRate ?? null,
      sentiment: md.sentiment ?? null,
    };
    // 封板率
    metrics.sealRate = ztCount + zbCount > 0 ? ztCount / (ztCount + zbCount) * 100 : null;
    const cycle = determineCyclePhaseVibeAlpha(metrics);
    // 舆情统计（news 表当日 sentiment 聚合 + 词典兜底）
    const newsR = await pool.query(
      `SELECT title, sentiment FROM news WHERE time >= $1 ORDER BY time DESC LIMIT 60`,
      [date + " 00:00:00"],
    );
    const newsStats = { total: newsR.rows.length, positive: 0, negative: 0, neutral: 0, top: [] };
    for (const n of newsR.rows) {
      const sent = n.sentiment;
      if (sent === "positive" || sent === "利好") newsStats.positive++;
      else if (sent === "negative" || sent === "利空") newsStats.negative++;
      else newsStats.neutral++;
      if (newsStats.top.length < 5) newsStats.top.push(String(n.title).slice(0, 80));
    }
    out.metrics = metrics;
    out.cycle = cycle;
    out.newsStats = newsStats;
  } catch (e) { out.error = e.message; }
  return out;
}

/** 生成叙事报告：LLM（emotionReport task）→ 失败规则版兜底 */
async function generateEmotionReport(pool, dateStr) {
  const collected = await collectEmotionMetrics(pool, dateStr);
  if (collected.error || !collected.metrics) {
    return { ok: false, error: collected.error ?? "数据不足", date: dateStr };
  }
  const { metrics, cycle, newsStats } = collected;

  // 报告 prompt（走 buildPrompt emotionReport，前后端 golden 一致）
  const phaseMetrics = [
    `涨停 ${metrics.ztCount} · 炸板 ${metrics.zbCount} · 跌停 ${metrics.dtCount} · 封板率 ${cycle.sealRate != null ? cycle.sealRate.toFixed(0) + "%" : "—"}`,
    `最高 ${metrics.maxBoardHeight} 板 · 炸板率 ${metrics.blastedRate != null ? metrics.blastedRate.toFixed(0) + "%" : "—"}`,
    `昨日涨停今日溢价 ${metrics.premiumAvg != null ? metrics.premiumAvg.toFixed(1) + "%" : "—"} · 晋级率 ${metrics.promotionRate != null ? (metrics.promotionRate * 100).toFixed(0) + "%" : "—"}`,
    `情绪温度计 ${metrics.sentiment ?? "—"} 分`,
  ].join("\n");
  const sentimentText = `周期判定：${cycle.phase}（规则：${cycle.rule}）\n舆情（当日快讯 ${newsStats.total} 条）：利好 ${newsStats.positive} / 利空 ${newsStats.negative} / 中性 ${newsStats.neutral}`;
  const fundText = `（资金面数据由前端人气榜/资金流补充展示）`;

  let reportText;
  let degraded = false;
  try {
    const { system, user } = buildPrompt("emotionReport", { date: metrics.date, phaseMetrics, sentimentText, fundText });
    reportText = await callModelText(user, { system, maxTokens: 1500, temperature: 0.4 });
  } catch {
    degraded = true;
    reportText = `【规则版（LLM 不可用）】\n## 周期阶段：${cycle.phase}\n\n- 涨停 ${metrics.ztCount} 只 / 炸板 ${metrics.zbCount} / 跌停 ${metrics.dtCount}\n- 封板率 ${cycle.sealRate != null ? cycle.sealRate.toFixed(0) + "%" : "—"}，最高 ${metrics.maxBoardHeight} 板\n- 情绪温度计 ${metrics.sentiment ?? "—"} 分，溢价 ${metrics.premiumAvg ?? "—"}%\n\n> 数据为规则统计参考，不构成投资建议`;
  }

  const result = {
    date: metrics.date,
    phase: cycle.phase,
    rule: cycle.rule,
    sealRate: cycle.sealRate,
    metrics,
    newsStats,
    report: reportText,
    degraded,
    generatedAt: new Date().toISOString(),
  };
  // kv 落库（report:emotion:YYYY-MM-DD）
  try {
    await pool.query(
      `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now())
       ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
      [`report:emotion:${result.date}`, JSON.stringify(result)],
    );
  } catch (e) { result.persistError = e.message; }
  return { ok: true, ...result };
}

module.exports = { determineCyclePhaseVibeAlpha, computeStockSentimentScore, generateEmotionReport, collectEmotionMetrics };
