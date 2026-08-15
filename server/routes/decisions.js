// ============================================================
// server/routes/decisions.js —— 决策直达 API（v9.116.0，S2-2）
// v9.136.0（任务4 契约定案）：GET 批量端点已删除——前端零消费者
//   （决策卡走 POST 单标的；主线/龙头权威源=/api/cognition，不再经决策端点包一层）；
//   POST 契约定案 = 单标的五支柱裁决裸对象（DecisionVerdict，与前端 kernel 同构 golden 锁定），
//   现价装配（stockSnapshot）+ PG 认知权威（getFreshCognition）。
// POST /api/decisions {code, mainline?} —— 单标的五支柱裁决（纯函数，不依赖 LLM，秒级）
// POST /api/decisions/swing {code} —— 波段决策（真实K线/资金/产业链 + AI 综合研判；AI失败回退规则）
// v9.147.0（数据基建·阶段一）：K线本地优先（kline_daily 通达信导入），断源根治
// v9.147.0（阶段二A·多周期共振）：月线第三级 + LLM 多周期裁决规则
// v9.147.0（阶段二B·波段信号闭环）：buyPoint 信号落库 swing_signals
// ============================================================
const { pool } = require("../db");
const { composeDecision } = require("../lib/decisionLayer");
const { getJson } = require("../lib/outbound");
const { fetchStockSnapshotServer } = require("../lib/stockSnapshot");
const { analyzeSwing, analyzeWeeklySwing, analyzeMonthlySwing } = require("../lib/swingStage");
const { swingDecision } = require("../lib/swingDecision");
const { chatComplete } = require("../lib/llmCore");
const { loadFeedbackPenalty, applyDecisionPenalty } = require("../lib/feedbackPenalty");
const { fetchResearchReportsServer, fetchInstitutionSurveysServer, fetchHolderCountServer, fetchLiftBanServer } = require("../lib/researchData");
const { buildChainView } = require("../../src/shared/transmission-chain.js");
const { getChainDbContext, loadChainEvents } = require("../lib/chainDb");
const { runFundamentalJudge } = require("../lib/fundamentalJudge");

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function bjDateStr() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

async function fetchStockKlines(code, days = 500) {
  // v9.147.0（数据基建·阶段一）：本地 kline_daily 优先（通达信全市场导入 + 每日增量），
  //   根治 push2his 断源导致"K线数据不足<30根"；本地不足才实时抓取并回写缓存（qfq 覆盖）。
  // v9.147.0（阶段二A·多周期共振）：默认 500 根 —— 月线第三级需 ≥12 个月（约 260 交易日）
  try {
    const { getLocalKlinesStrings } = require("../lib/klineDb");
    const local = await getLocalKlinesStrings(pool, code, days);
    if (Array.isArray(local) && local.length >= 30) return local;
  } catch { /* 本地读失败则走实时 */ }
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
  const klines = Array.isArray(rows) ? rows.map((r) => (Array.isArray(r) ? r.join(",") : String(r))) : [];
  // v9.147.0：实时兜底结果回写本地缓存（仅本地不足时到达；qfq 覆盖 tdx 同日期，口径取前复权）
  try {
    const { upsertKlines } = require("../lib/klineDb");
    const bars = klines
      .map((line) => {
        const [date, open, close, high, low, volume] = String(line).split(",");
        if (!date || !Number.isFinite(num(close))) return null;
        return { code, date: String(date), open: num(open), close: num(close), high: num(high), low: num(low), volume: num(volume) || 0, amount: 0 };
      })
      .filter(Boolean);
    if (bars.length) await upsertKlines(pool, bars, "tencent", true);
  } catch { /* 回写失败不影响本次返回 */ }
  return klines;
}

async function fetchChainContext(code) {
  const dataSourceNote = "产业景气数据来源：仅新闻/政策/资金代理，无协会/统计直采";
  try {
    const dbCtx = await getChainDbContext(pool, code);
    if (dbCtx.mapped) {
      const events = await loadChainEvents(pool, dbCtx.chain.chainId);
      return { board: dbCtx.chain.boardName, chain: dbCtx.chain, events, dbMapped: true, dataSourceNote };
    }
  } catch { /* DB 链上下文不可用则退回板块知识库 */ }
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
    if (chain) return { board: b, chain, events: [], dbMapped: false, dataSourceNote };
  }
  return { board: candidates[0] ?? null, chain: null, events: [], dbMapped: false, dataSourceNote };
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

async function llmSwingDecision(code, snap, stage, weeklyStage, monthlyStage, chain, newsCtx, fundamentals, profile) {
  const system = "你是A股波段投研分层决策引擎。每一层结论必须引用输入中的具体数据，输出严格JSON。";
  const user = `请对 ${code} 做波段决策：
日线阶段：${JSON.stringify(stage)}
周线阶段：${JSON.stringify(weeklyStage)}
月线阶段：${JSON.stringify(monthlyStage)}
行情：${JSON.stringify(snap)}
产业链（含数据库映射/营收敞口/传导事件）：${JSON.stringify(chain)}
研报/调研/股东/解禁：${JSON.stringify(fundamentals)}
基本面研判结论（独立 Agent 输出）：${JSON.stringify(fundamentals.fundamentalJudge || null)}
消息：${JSON.stringify(newsCtx)}
 用户画像：${profile || "暂无"}

多周期共振裁决规则：日线=短波段（3天-1月）、周线=中波段（60-180天）、月线=长波段（1-3年）。
月线主升+周线退潮=中期回调低吸窗口；月线退潮+日线反弹=反抽不追高；三周期同向=高置信度信号。

输出严格JSON：
{"verdict":"波段买入|持有|减仓|观望|回避","score":0-100,"buyPoint":"买点或null","stopLossPct":5,"targetPct":15,"positionRange":[10,20],"holdingHorizonDays":20,"reviewCycleDays":20,"reasons":["证据链"],"blocks":["风险"],"evidenceChain":[{"step":"产业链","evidence":"引用具体数据"}],"invalidationConditions":["假设失效条件"],"signal":"一句话","dailyStage":"日线阶段判断","weeklyStage":"周线阶段判断","monthlyStage":"月线阶段判断"}`;
  const r = await chatComplete({ system, user, maxTokens: 8000, temperature: 0.2, thinking: true });
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
    holdingHorizonDays: num(j.holdingHorizonDays) ?? 20,
    reviewCycleDays: num(j.reviewCycleDays) ?? 20,
    reasons: Array.isArray(j.reasons) ? j.reasons.map(String) : [],
    blocks: Array.isArray(j.blocks) ? j.blocks.map(String) : [],
    evidenceChain: Array.isArray(j.evidenceChain) ? j.evidenceChain.slice(0, 10) : [],
    invalidationConditions: Array.isArray(j.invalidationConditions) ? j.invalidationConditions.slice(0, 10).map(String) : [],
    signal: String(j.signal || "观望"),
    dailyStage: j.dailyStage ? String(j.dailyStage) : null,
    weeklyStage: j.weeklyStage ? String(j.weeklyStage) : null,
    monthlyStage: j.monthlyStage ? String(j.monthlyStage) : null,
  };
}

async function insertAiDecisionLog(code, decision, fromLLM, llmError) {
  try {
    const ins = await pool.query(
      `INSERT INTO ai_decision_log(code,verdict,score,holding_horizon_days,review_cycle_days,source,from_llm,llm_error,raw_json)
       VALUES($1,$2,$3,$4,$5,'AI-Swing',$6,$7,$8) RETURNING id`,
      [
        code,
        String(decision?.verdict || "观望"),
        Number(decision?.score) || 0,
        Number(decision?.holdingHorizonDays) || 20,
        Number(decision?.reviewCycleDays) || 20,
        Boolean(fromLLM),
        llmError ? String(llmError).slice(0, 500) : null,
        JSON.stringify(decision || {}),
      ],
    );
    return String(ins.rows[0].id);
  } catch {
    return null;
  }
}

async function ensureAutoLogicLedger(code, name, price, chainBoard, decision, decisionLogRef) {
  if (!decisionLogRef || !String(decision?.verdict || "").includes("买入")) {
    return { created: false, reason: "not_buy" };
  }
  try {
    const existing = await pool.query(`SELECT id FROM logic_ledger WHERE decision_ref=$1 LIMIT 1`, [decisionLogRef]);
    if (existing.rows[0]) return { created: false, reason: "exists" };
    const reviewCycleDays = Math.max(1, Math.min(365, Math.round(Number(decision?.reviewCycleDays) || 20)));
    const nextReviewAt = new Date(Date.now() + 8 * 3600 * 1000 + reviewCycleDays * 86400000).toISOString().slice(0, 10);
    const breakLine = price != null && price > 0 ? Math.round(price * (1 - (Number(decision?.stopLossPct) || 5) / 100) * 100) / 100 : null;
    await pool.query(
      `INSERT INTO logic_ledger(code,name,status,thesis,catalysts,break_line,board,decision_ref,simulated,invalidation_conditions,review_cycle_days,next_review_at)
       VALUES($1,$2,'验证中',$3,'[]'::jsonb,$4,$5,$6,true,$7,$8,$9)`,
      [
        code,
        name || code,
        String(decision?.reasons?.join("；") || decision?.signal || "AI 波段买入逻辑").slice(0, 500),
        breakLine,
        chainBoard || null,
        decisionLogRef,
        JSON.stringify(Array.isArray(decision?.invalidationConditions) ? decision.invalidationConditions.slice(0, 20).map(String) : []),
        reviewCycleDays,
        nextReviewAt,
      ],
    );
    return { created: true };
  } catch (e) {
    return { created: false, reason: String(e?.message || "db_error") };
  }
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
      const profile = String(req.body?.profile ?? "");
      if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: "invalid code" });
      const [snap, klines, chainCtx, newsCtx, researchForecastR, surveyR, holderR, liftR] = await Promise.allSettled([
        fetchStockSnapshotServer(code),
        fetchStockKlines(code),
        fetchChainContext(code),
        fetchNewsContext(code),
        fetchResearchReportsServer(code, 5),
        fetchInstitutionSurveysServer(code, 5),
        fetchHolderCountServer(code),
        fetchLiftBanServer(code, 5),
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
      const weeklyStage = analyzeWeeklySwing(bars);
      const monthlyStage = analyzeMonthlySwing(bars);
      const chainVal = chainCtx.status === "fulfilled" ? chainCtx.value : { board: null, chain: null, events: [], dbMapped: false };
      const newsVal = newsCtx.status === "fulfilled" ? newsCtx.value : { news: [], anns: [] };
      const fundamentalsVal = {
        research: researchForecastR.status === "fulfilled" ? researchForecastR.value : [],
        surveys: surveyR.status === "fulfilled" ? surveyR.value : [],
        holder: holderR.status === "fulfilled" ? holderR.value : null,
        liftBan: liftR.status === "fulfilled" ? liftR.value : [],
      };
      const [historyV, peerV, catalystV] = await Promise.allSettled([
        require("../lib/fundamentalTrend").getFundamentalTrend(pool, code),
        require("../lib/fundamentalTrend").getPeerComparison(pool, code),
        require("../lib/catalystCalendar").getCatalystCalendar(code, 180),
      ]);
      fundamentalsVal.history = historyV.status === "fulfilled" ? historyV.value : [];
      fundamentalsVal.peer = peerV.status === "fulfilled" ? peerV.value : null;
      fundamentalsVal.catalysts = catalystV.status === "fulfilled" ? catalystV.value : [];
      fundamentalsVal.fundamentalJudge = await Promise.race([
        runFundamentalJudge(pool, code, fundamentalsVal.history, fundamentalsVal.peer, fundamentalsVal.catalysts),
        new Promise((resolve) => setTimeout(() => resolve(null), 20000)),
      ]);
      let decision = null;
      let fromLLM = false;
      let llmError = null;
      try {
        decision = await Promise.race([
          llmSwingDecision(code, snapVal, stage, weeklyStage, monthlyStage, chainVal, newsVal, fundamentalsVal, profile),
          new Promise((_, reject) => setTimeout(() => reject(new Error("llm timeout 35s")), 35000)),
        ]);
        fromLLM = true;
      } catch (e) {
        llmError = String(e?.message ?? e);
        const hist = Array.isArray(fundamentalsVal.history) ? fundamentalsVal.history : [];
        const latest = hist[0] || {};
        const fundamentalScore = hist.length >= 4 && (latest.roe != null || latest.revYoy != null || latest.profitYoy != null)
          ? Math.max(0, Math.min(100, Math.round(
              ((latest.roe != null ? Math.max(0, Math.min(20, latest.roe)) / 20 * 40 : 30)
                + (latest.profitYoy != null ? (latest.profitYoy > 0 ? 30 : 10) : 15)
                + (latest.revYoy != null ? (latest.revYoy > 0 ? 30 : 10) : 15))
            )))
          : null;
        const catalystCount = Array.isArray(fundamentalsVal.catalysts) ? fundamentalsVal.catalysts.length : 0;
        const base = swingDecision({ stage, board: null, holding: false, fundamentalScore, catalystCount });
        const weeklyPhase = weeklyStage?.phase;
        const weeklyHorizon = weeklyPhase === "启动" || weeklyPhase === "主升" ? 90 : (weeklyPhase === "加速" || weeklyPhase === "退潮" ? 10 : 20);
        decision = {
          ...base,
          holdingHorizonDays: weeklyHorizon,
          reviewCycleDays: weeklyHorizon >= 60 ? 30 : 20,
          evidenceChain: [{ step: "规则研判", evidence: stage?.signals?.join("；") || "K线/资金规则兜底" }],
          invalidationConditions: ["跌破买点或MA20，波段逻辑失效"],
          dailyStage: stage?.phase ?? null,
          weeklyStage: weeklyStage?.phase ?? null,
          monthlyStage: monthlyStage?.phase ?? null,
        };
      }
      const fp = await loadFeedbackPenalty(pool, code);
      const applied = applyDecisionPenalty(decision, fp);
      const decisionLogRef = await insertAiDecisionLog(code, applied.decision, fromLLM, llmError);
      const autoLogic = await ensureAutoLogicLedger(code, snapVal?.name, snapVal?.price ?? stage?.ma20, chainVal?.chain?.boardName, applied.decision, decisionLogRef);
      // v9.147.0（阶段二B·波段信号闭环）：buyPoint 信号落库（幂等 code+type+date），供 T+20/T+60 胜率回填
      if (stage?.buyPoint) {
        try {
          const { recordSwingSignal } = require("../lib/swingSignals");
          await recordSwingSignal(pool, {
            code, name: snapVal?.name ?? null, signalType: stage.buyPoint,
            signalDate: bjDateStr(), price: snapVal?.price ?? stage.ma20 ?? null,
          });
        } catch { /* 信号落库失败不影响决策 */ }
      }
      res.json({ ok: true, code, snap: snapVal, stage, weeklyStage, monthlyStage, chain: chainVal, fundamentals: fundamentalsVal, decision: applied.decision, decisionLogRef, autoLogic, fromLLM, llmError, feedbackPenalty: applied.penalty, pipeline: { dataReady: true, chainReady: !!chainVal.chain, fundamentalsReady: fundamentalsVal.research.length > 0 || fundamentalsVal.surveys.length > 0 || !!fundamentalsVal.holder || fundamentalsVal.liftBan.length > 0, timingReady: !!stage, llmSynthesis: fromLLM } });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // v9.145.0（第三轮 P0-2）：AI-Swing 服务端留痕查询，供命中率对账优先使用服务端数据
  app.get("/api/decisions/logs", async (req, res) => {
    try {
      const days = Math.max(1, Math.min(365, Number(req.query.days) || 60));
      const source = String(req.query.source || "").trim();
      const params = [days];
      let sourceSql = "";
      if (source) {
        params.push(source);
        sourceSql = " AND source=$2";
      }
      const r = await pool.query(
        `SELECT id,code,ts,verdict,score,holding_horizon_days,review_cycle_days,source,from_llm,llm_error,raw_json
         FROM ai_decision_log
         WHERE ts >= now() - ($1::int || ' days')::interval${sourceSql}
         ORDER BY ts DESC LIMIT 500`,
        params,
      );
      res.json({ ok: true, rows: r.rows });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
};
