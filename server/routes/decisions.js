// ============================================================
// server/routes/decisions.js —— 决策直达 API（v9.116.0，S2-2）
// v9.136.0（任务4 契约定案）：GET 批量端点已删除——前端零消费者
//   （决策卡走 POST 单标的；主线/龙头权威源=/api/cognition，不再经决策端点包一层）；
//   POST 契约定案 = 单标的五支柱裁决裸对象（DecisionVerdict，与前端 kernel 同构 golden 锁定），
//   现价装配（stockSnapshot）+ PG 认知权威（getFreshCognition）。
// POST /api/decisions {code, mainline?} —— 单标的五支柱裁决（纯函数，不依赖 LLM，秒级）
// POST /api/decisions/swing {code} —— 波段决策（真实K线/资金/产业链 + AI 综合研判；AI失败回退规则）
// ============================================================
const { pool } = require("../db");
const { composeDecision } = require("../lib/decisionLayer");
const { getJson } = require("../lib/outbound");
const { fetchStockSnapshotServer } = require("../lib/stockSnapshot");
const { analyzeSwing } = require("../lib/swingStage");
const { swingDecision } = require("../lib/swingDecision");
const { chatComplete } = require("../lib/llmCore");
const { loadFeedbackPenalty, applyDecisionPenalty } = require("../lib/feedbackPenalty");
const { buildChainView } = require("../../src/shared/transmission-chain.js");

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function bjDateStr() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

async function fetchStockKlines(code, days = 70) {
  const secid = /^(60|68|5)/.test(code) ? `1.${code}` : `0.${code}`;
  const primary = `http://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&lmt=${days}&end=20500101&ut=7eea3edcaed734bea9cbfc24409ed989`;
  try {
    const r = await getJson(primary, { timeout: 8000, retries: 1, source: "push2his" });
    const klines = r.data?.data?.klines ?? [];
    if (Array.isArray(klines) && klines.length) return klines;
  } catch { /* fallthrough */ }
  const q = /^(60|68|5)/.test(code) ? `sh${code}` : `sz${code}`;
  const txUrl = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${q},day,,,${days},qfq`;
  const tj = await getJson(txUrl, { timeout: 8000, source: "tencent" });
  const rows = tj.data?.data?.[q]?.qfqday ?? tj.data?.data?.[q]?.day ?? [];
  return Array.isArray(rows) ? rows.map((r) => (Array.isArray(r) ? r.join(",") : String(r))) : [];
}

async function fetchChainContext(code) {
  const [conceptR, ztR] = await Promise.allSettled([
    pool.query(`SELECT concepts, all_boards, hybk, core_concept FROM stock_concepts WHERE code=$1`, [code]),
    pool.query(`SELECT data FROM zt_snapshot ORDER BY date DESC LIMIT 1`),
  ]);
  const candidates = [];
  if (conceptR.status === "fulfilled" && conceptR.value.rows[0]) {
    const row = conceptR.value.rows[0];
    if (row.core_concept) candidates.push(String(row.core_concept));
    if (row.hybk) candidates.push(String(row.hybk));
    const boards = Array.isArray(row.all_boards) ? row.all_boards : [];
    for (const b of boards.slice(0, 6)) candidates.push(String(b));
    const concepts = Array.isArray(row.concepts) ? row.concepts : [];
    for (const c of concepts.slice(0, 6)) candidates.push(String(c));
  }
  if (ztR.status === "fulfilled" && ztR.value.rows[0]) {
    const raw = ztR.value.rows[0].data;
    const snap = typeof raw === "string" ? JSON.parse(raw) : raw;
    const arr = Array.isArray(snap) ? snap : snap?.pool ?? [];
    const hit = arr.find((p) => String(p.code ?? p.c ?? "") === code);
    if (hit?.hybk) candidates.push(String(hit.hybk));
  }
  for (const b of [...new Set(candidates.filter(Boolean))]) {
    const chain = buildChainView(b);
    if (chain) return { board: b, chain };
  }
  return { board: candidates[0] ?? null, chain: null };
}

async function fetchNewsContext(code) {
  const [newsR, annR] = await Promise.allSettled([
    pool.query(`SELECT title, summary, time FROM news WHERE title ILIKE $1 OR summary ILIKE $1 ORDER BY time DESC LIMIT 8`, [`%${code}%`]),
    pool.query(`SELECT title, time FROM announcements WHERE stock_code=$1 ORDER BY time DESC LIMIT 8`, [code]),
  ]);
  return {
    news: newsR.status === "fulfilled" ? newsR.value.rows : [],
    anns: annR.status === "fulfilled" ? annR.value.rows : [],
  };
}

async function llmSwingDecision(code, snap, stage, chain, newsCtx) {
  const system = "你是A股波段投研决策引擎。输入真实K线阶段、行情快照、产业链和消息，输出严格JSON。";
  const user = `请对 ${code} 做波段决策：
阶段：${JSON.stringify(stage)}
行情：${JSON.stringify(snap)}
产业链：${JSON.stringify(chain)}
消息：${JSON.stringify(newsCtx)}

输出严格JSON：
{"verdict":"波段买入|持有|减仓|观望|回避","score":0-100,"buyPoint":"买点或null","stopLossPct":5,"targetPct":15,"positionRange":[10,20],"reasons":["证据链"],"blocks":["风险"],"signal":"一句话"}`;
  const r = await chatComplete({ system, user, maxTokens: 4000, temperature: 0.2, thinking: true });
  const text = String(r?.text ?? "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("LLM output not json");
  const j = JSON.parse(text.slice(start, end + 1));
  return {
    verdict: String(j.verdict || "观望"),
    score: num(j.score) ?? 50,
    buyPoint: j.buyPoint ? String(j.buyPoint) : null,
    stopLossPct: num(j.stopLossPct) ?? 5,
    targetPct: num(j.targetPct) ?? 15,
    positionRange: Array.isArray(j.positionRange) ? [num(j.positionRange[0]) ?? 0, num(j.positionRange[1]) ?? 0] : [0, 0],
    reasons: Array.isArray(j.reasons) ? j.reasons.map(String) : [],
    blocks: Array.isArray(j.blocks) ? j.blocks.map(String) : [],
    signal: String(j.signal || "观望"),
  };
}

module.exports = function decisionsRoutes(app) {
  // POST 单标的
  app.post("/api/decisions", async (req, res) => {
    try {
      const body = req.body || {};
      const code = String(body.code ?? "").trim();
      if (!code) return res.status(400).json({ error: "missing code" });
      const v = await composeDecision({ code, mainline: body.mainline });
      const fp = await loadFeedbackPenalty(pool, code);
      const applied = applyDecisionPenalty(v, fp);
      res.json({ ...applied.decision, feedbackPenalty: applied.penalty });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST 波段决策（真实数据 + AI 综合研判）
  app.post("/api/decisions/swing", async (req, res) => {
    try {
      const code = String(req.body?.code ?? "").trim();
      if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: "invalid code" });
      const [snap, klines, chainCtx, newsCtx] = await Promise.allSettled([
        fetchStockSnapshotServer(code),
        fetchStockKlines(code),
        fetchChainContext(code),
        fetchNewsContext(code),
      ]);
      const snapVal = snap.status === "fulfilled" ? snap.value : null;
      const rows = klines.status === "fulfilled" ? klines.value : [];
      if (!Array.isArray(rows) || rows.length < 30) {
        return res.status(422).json({ error: "K线数据不足（<30 根）", code, snap: snapVal });
      }
      const bars = rows.map((line) => {
        const [date, open, close, high, low, volume] = String(line).split(",");
        return { date, open: num(open), close: num(close), high: num(high), low: num(low), volume: num(volume) || 0 };
      });
      const stage = analyzeSwing(bars);
      const chainVal = chainCtx.status === "fulfilled" ? chainCtx.value : { board: null, chain: null };
      const newsVal = newsCtx.status === "fulfilled" ? newsCtx.value : { news: [], anns: [] };
      let decision = null;
      let fromLLM = false;
      let llmError = null;
      try {
        decision = await llmSwingDecision(code, snapVal, stage, chainVal, newsVal);
        fromLLM = true;
      } catch (e) {
        llmError = String(e?.message ?? e);
        decision = swingDecision({ stage, board: null, holding: false });
      }
      const fp = await loadFeedbackPenalty(pool, code);
      const applied = applyDecisionPenalty(decision, fp);
      res.json({ ok: true, code, snap: snapVal, stage, chain: chainVal, decision: applied.decision, fromLLM, llmError, feedbackPenalty: applied.penalty });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
};
