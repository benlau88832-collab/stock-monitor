// ============================================================
// v9.142.0 swing mainline server scorer (CJS port)
// trend 40 + fund 35 + catalyst 25, same intent as src/lib/swingMainline.ts
// ============================================================
const { classifySwingPhase } = require("./swingStage");

function scoreTrend(klines) {
  const signals = [];
  if (!klines || klines.length < 21) return { score: 0, ma20Up: false, pct20d: null, phase: "数据不足", signals: ["板块K线不足21根"] };
  const closes = klines.map((k) => k.close);
  const last = closes[closes.length - 1];
  const p20 = closes[closes.length - 21];
  const pct20d = p20 > 0 ? (last - p20) / p20 * 100 : null;
  const ma20 = closes.slice(-20).reduce((s, v) => s + v, 0) / 20;
  const ma20Prev = closes.slice(-21, -1).reduce((s, v) => s + v, 0) / 20;
  const ma20Up = ma20 > ma20Prev;
  const aboveMa20 = last > ma20;

  let score = 50;
  if (aboveMa20) score += 20; else score -= 20;
  if (ma20Up) score += 10; else score -= 10;
  if (pct20d != null) {
    if (pct20d > 8) score += 15;
    else if (pct20d > 3) score += 8;
    else if (pct20d < -5) score -= 15;
    else if (pct20d < -2) score -= 8;
  }
  const stage = classifySwingPhase(klines);
  if (stage.phase === "主升") score += 5;
  if (stage.phase === "退潮") score -= 10;
  signals.push(stage.phase === "数据不足" ? stage.signals[0] ?? "" : `板块阶段：${stage.phase}`);
  if (aboveMa20) signals.push("指数站上 MA20");
  if (pct20d != null) signals.push(`20日涨幅${pct20d > 0 ? "+" : ""}${pct20d.toFixed(1)}%`);
  return { score: Math.max(0, Math.min(100, score)), ma20Up: aboveMa20, pct20d, phase: stage.phase, signals };
}

function scoreFund(fundSeq) {
  const signals = [];
  if (!fundSeq || fundSeq.length === 0) return { score: 50, fund10d: null, fund20d: null, signals: ["资金序列缺失（中性）"] };
  const seq = fundSeq;
  const last10 = seq.slice(-10);
  const last20 = seq.slice(-20);
  const sum10 = last10.reduce((s, v) => s + v, 0);
  const sum20 = last20.reduce((s, v) => s + v, 0);
  const fund10d = Math.round(sum10 / 1e8 * 10) / 10;
  const fund20d = Math.round(sum20 / 1e8 * 10) / 10;
  let score = 50;
  if (sum10 > 0) score += 20; else score -= 15;
  if (sum20 > 0) score += 10; else score -= 10;
  if (sum10 > 0 && sum20 > 0) score += 5;
  if (sum10 < 0 && sum20 > 0) score -= 5;
  signals.push(`近10日主力${fund10d > 0 ? "+" : ""}${fund10d}亿`);
  signals.push(`近20日主力${fund20d > 0 ? "+" : ""}${fund20d}亿`);
  return { score: Math.max(0, Math.min(100, score)), fund10d, fund20d, signals };
}

function scoreCatalyst(catalysts) {
  const signals = [];
  if (!catalysts || catalysts.length === 0) return { score: 50, catalystsTop: [], signals: ["近N日无催化事件"] };
  const LEVEL_W = { 政策: 25, 行业: 15, 事件: 8, critical: 20, warning: 10, info: 5 };
  let s = 50;
  const tops = [];
  for (const c of catalysts.slice(0, 10)) {
    const w = LEVEL_W[c.level] ?? 8;
    s += w;
    if (tops.length < 3) tops.push(String(c.title ?? "").slice(0, 24));
  }
  signals.push(`${catalysts.length} 条催化事件（近N日）`);
  return { score: Math.max(0, Math.min(100, s)), catalystsTop: tops, signals };
}

function scoreBoard(b) {
  const t = scoreTrend(b.klines);
  const f = scoreFund(b.fundSeq);
  const c = scoreCatalyst(b.catalysts);
  const total = Math.round(t.score * 0.40 + f.score * 0.35 + c.score * 0.25);
  return {
    code: b.code,
    name: b.name,
    trend: t.score,
    fund: f.score,
    catalyst: c.score,
    total,
    phase: t.phase,
    ma20Up: t.ma20Up,
    pct20d: t.pct20d,
    fund10d: f.fund10d,
    fund20d: f.fund20d,
    catalystsTop: c.catalystsTop,
    signals: [...t.signals, ...f.signals, ...c.signals],
  };
}

function rankSwingBoards(boards) {
  const PHASE_W = { 主升: 3, 启动: 2, 底部整理: 1, 加速: 1, 退潮: 0, 数据不足: 0 };
  return [...boards].sort((a, b) => {
    const pa = PHASE_W[a.phase] ?? 0, pb = PHASE_W[b.phase] ?? 0;
    if (pb !== pa) return pb - pa;
    return b.total - a.total;
  });
}

module.exports = { scoreTrend, scoreFund, scoreCatalyst, scoreBoard, rankSwingBoards };
