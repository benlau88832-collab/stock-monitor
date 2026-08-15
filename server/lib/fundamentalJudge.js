// ============================================================
// server/lib/fundamentalJudge.js —— 独立基本面研判（v9.146.0 第三轮报告执行）
// 用途：对个股做独立的质量/估值/催化剂三点研判，结论注入 AI-Swing 决策上下文
//   （llmSwingDecision 的 fundamentals.fundamentalJudge 字段），并落库留痕。
// 输入：fundamental_history 历史序列（最新在前）+ peerComparison + 催化剂日历
// 输出：{ qualityScore, valuation, keyPoints, rawJson, source } → fundamental_judgment 表
// 纯规则实现（0 LLM）：ROE/负债率/成长 → 质量分；PEG/PE 分位 → 估值档；
//   催化剂数量/近度 → 催化强度。失败降级 null 不阻塞主链。
// ============================================================
const { pool } = require("../db");

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/** 质量评分（0-100）：ROE 40 + 成长 30 + 负债 15 + EPS 15 */
function scoreQuality(hist) {
  const latest = hist[0] || {};
  const prev = hist[1] || {};
  const roe = Number(latest.roe);
  const profitYoy = Number(latest.profitYoy);
  const revYoy = Number(latest.revYoy);
  const debt = Number(latest.debt);
  const eps = Number(latest.eps);
  let s = 0;
  // ROE（40 分）：≥15 满分，线性到 0
  s += Number.isFinite(roe) ? clamp(roe / 15 * 40, 0, 40) : 20;
  // 净利增速（20 分）：>30% 满分；负增长 0
  s += Number.isFinite(profitYoy) ? clamp(profitYoy / 30 * 20, 0, 20) : 10;
  // 营收增速（10 分）
  s += Number.isFinite(revYoy) ? clamp(revYoy / 30 * 10, 0, 10) : 5;
  // 负债率（15 分）：≤40% 满分，>80% 0
  s += Number.isFinite(debt) ? clamp((80 - debt) / 40 * 15, 0, 15) : 7.5;
  // EPS 为正（15 分）
  s += Number.isFinite(eps) && eps > 0 ? 15 : 0;
  return Math.round(s);
}

/** 估值档：PEG 优先（<1 低估 / 1-1.5 合理 / >1.5 高估），PE 分位兜底 */
function judgeValuation(hist, peer) {
  const latest = hist[0] || {};
  const pe = Number(latest.peTtm) || Number(latest.pe);
  const profitYoy = Number(latest.profitYoy);
  if (Number.isFinite(pe) && pe > 0 && Number.isFinite(profitYoy) && profitYoy > 0) {
    const peg = pe / profitYoy;
    if (peg < 1) return { label: "低估", peg: Math.round(peg * 100) / 100 };
    if (peg <= 1.5) return { label: "合理", peg: Math.round(peg * 100) / 100 };
    return { label: "高估", peg: Math.round(peg * 100) / 100 };
  }
  const pePercentile = peer?.metrics?.pePercentile;
  if (Number.isFinite(pePercentile) && pePercentile != null) {
    if (pePercentile <= 30) return { label: "低估", pePercentile };
    if (pePercentile <= 70) return { label: "合理", pePercentile };
    return { label: "高估", pePercentile };
  }
  return { label: "未评估" };
}

/** 催化强度：近 180 天催化剂数量 + 最近事件近度 */
function judgeCatalyst(catalysts) {
  const list = Array.isArray(catalysts) ? catalysts : [];
  if (list.length === 0) return { count: 0, strength: "无" };
  const now = Date.now();
  const recent = list.filter((c) => {
    const d = new Date(String(c.event_date ?? "") + "T00:00:00+08:00");
    return Number.isFinite(d.getTime()) && now - d.getTime() <= 30 * 86400000;
  }).length;
  const strength = recent >= 3 ? "强" : recent >= 1 ? "中" : list.length >= 3 ? "弱" : "无";
  return { count: list.length, recent, strength };
}

/** 独立基本面研判主入口：写 fundamental_judgment 表，返回研判对象（失败返回 null） */
async function runFundamentalJudge(p, code, history, peer, catalysts) {
  try {
    const hist = Array.isArray(history) ? history : [];
    const qualityScore = scoreQuality(hist);
    const valuation = judgeValuation(hist, peer);
    const cat = judgeCatalyst(catalysts);
    const keyPoints = [];
    const latest = hist[0] || {};
    if (Number.isFinite(Number(latest.roe))) keyPoints.push(`ROE ${Number(latest.roe).toFixed(1)}%`);
    if (Number.isFinite(Number(latest.profitYoy))) keyPoints.push(`净利同比 ${Number(latest.profitYoy).toFixed(1)}%`);
    if (Number.isFinite(Number(latest.revYoy))) keyPoints.push(`营收同比 ${Number(latest.revYoy).toFixed(1)}%`);
    if (Number.isFinite(Number(latest.debt))) keyPoints.push(`负债率 ${Number(latest.debt).toFixed(1)}%`);
    keyPoints.push(`估值${valuation.label}${valuation.peg != null ? `（PEG ${valuation.peg}）` : ""}`);
    keyPoints.push(`催化${cat.strength}（${cat.count} 条）`);
    const qualityLabel = qualityScore >= 70 ? "优质" : qualityScore >= 45 ? "中等" : "偏弱";
    const rawJson = {
      qualityScore, qualityLabel, valuation, catalyst: cat,
      latest: hist[0] ?? null, peerCount: peer?.peerCount ?? 0,
    };
    await p.query(
      `INSERT INTO fundamental_judgment(code,quality_score,valuation,key_points,raw_json,source)
       VALUES($1,$2,$3,$4,$5,'AI-Swing')`,
      [String(code), qualityScore, valuation.label, JSON.stringify(keyPoints), JSON.stringify(rawJson)],
    );
    return { qualityScore, qualityLabel, valuation, keyPoints, catalyst: cat, rawJson, source: "rule" };
  } catch {
    return null;
  }
}

module.exports = { runFundamentalJudge, scoreQuality, judgeValuation, judgeCatalyst };
