// ============================================================
// server/cron/brain.js —— 领域模块（v9.139.0 阶段二 #16，split-cron.js 自动拆分）
// 行为与原 cron.js 逐字一致；原文件已只留调度注册
// ============================================================
const B = require("./base");
const { contentKey, httpsGet, bjDate, bjDateStr, EM_UT, detectSealDecayServer, markCronStep, hasCronStep, isTradingDayCN, getJson, getJsonWithFallback, requestRaw, parseLLMJSON, SCHEMAS, withPgLock, LOCK_CRON_MAIN, LOCK_THEME, LOCK_WATCH, LOCK_INTRADAY, callLLM, saveFactorIc } = B;
const { fetchZTPool } = require("./zt");
const { fetchBoardQuotes } = require("./fund");


async function runIntradayBrain(pool, force = false) {
  // 交易时段防护：仅北京 9:15-15:05 且非周末才采集（防手动误触/跨日数据误报；force 用于测试）
  const nowBJ = new Date(Date.now() + 8 * 3600 * 1000);
  const hhmm = nowBJ.getHours() * 100 + nowBJ.getMinutes();
  const weekday = nowBJ.getDay();
  if (!force && (weekday === 0 || weekday === 6 || hhmm < 915 || hhmm > 1505)) {
    return { sentiment: null, anomalies: 0, skipped: "非交易时段" };
  }
  const ds = bjDateStr();
  // ① 涨停池 + 炸板池（并行，互不阻塞）
  const [ztRes, zbRes, boardRes] = await Promise.allSettled([
    fetchZTPool(),
    httpsGet(`https://push2ex.eastmoney.com/getTopicZBPool?ut=${EM_UT}&dpt=wz.ztzt&Pageindex=0&pagesize=200&sort=fbt%3Aasc&date=${bjDate()}`),
    fetchBoardQuotes(),
  ]);
  const ztPool = ztRes.status === "fulfilled" ? (ztRes.value?.pool ?? []) : [];
  const zbPool = (zbRes.status === "fulfilled" && Array.isArray(zbRes.value?.data?.pool)) ? zbRes.value.data.pool : [];
  const boards = boardRes.status === "fulfilled" ? boardRes.value : [];

  // ② 服务端情绪分（简化同构前端 computeSentimentNow 池子因子，供关页断链场景）
  let sentiment = null;
  let sentimentLabel = "数据不足";
  if (ztPool.length > 0 || boards.length > 0) {
    const ztCount = ztPool.length;
    const blastedRate = ztCount + zbPool.length > 0 ? Math.round(zbPool.length / (ztCount + zbPool.length) * 1000) / 10 : 0;
    const maxBoard = ztPool.length > 0 ? Math.max(0, ...ztPool.map(p => Number(p?.lbc ?? 1))) : 0;
    const totalNet = boards.reduce((s, b) => s + b.mainNet, 0);
    const s = 50
      + Math.min(12, ztCount * 0.15)               // 涨停加分（0-12）
      - Math.min(10, blastedRate * 0.2)            // 炸板扣分
      + Math.max(-10, Math.min(10, (maxBoard - 3) * 2)) // 高度加分
      + Math.max(-6, Math.min(6, totalNet / 1e11 * 3));  // 板块资金方向（±6）
    sentiment = Math.max(0, Math.min(100, Math.round(s)));
    sentimentLabel = sentiment >= 80 ? "极度贪婪" : sentiment >= 65 ? "贪婪" : sentiment >= 45 ? "中性" : sentiment >= 25 ? "恐慌" : "极度恐慌";
  }
  // ③ 板块资金快照（top30）落库
  // 注意：情绪分用独立 key sentiment_snapshot（sentiment_intraday:日期 已被前端 sentimentStore
  //   占用为 [{t:"HH:MM",s:score}] 数组格式 —— 服务端对象格式不得复用同 key 互相覆盖）
  await pool.query(
    `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now())
     ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
    [`sentiment_snapshot:${ds}`, JSON.stringify({ date: ds, ts: new Date().toISOString(), sentiment, label: sentimentLabel })],
  );
  const boardTop = boards.slice(0, 30).map(b => ({ board: b.name, code: b.code, pct: b.pct, mainNet: b.mainNet }));
  await pool.query(
    `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now())
     ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
    [`fund_streak_intraday:${ds}`, JSON.stringify({ date: ds, ts: new Date().toISOString(), items: boardTop })],
  );

  // ④ 板块集体异动检测（游资"强势资金批量接入"信号）
  const anomalies = [];
  // 规则 A：同板块 ≥3 只涨停（按 hybk 聚合，取 top 板块）
  const byBoard = new Map();
  for (const p of ztPool) {
    const b = String(p?.hybk || "未分类");
    byBoard.set(b, (byBoard.get(b) ?? []).concat(p));
  }
  for (const [board, list] of byBoard) {
    if (list.length >= 3) {
      const lbc = Math.max(...list.map(x => Number(x?.lbc ?? 1)));
      anomalies.push({
        type: "集体涨停", board, count: list.length, lbc,
        stocks: list.slice(0, 5).map(x => `${x.n}(${x.lbc ?? 1}板)`).join("、"),
        ts: Date.now(), severity: "critical",
      });
    }
  }
  // 规则 B：板块涨幅 >3% 且 主力净额 >3 亿（资金脉冲）
  for (const b of boards) {
    if (b.pct > 3 && b.mainNet > 3e8) {
      anomalies.push({
        type: "资金脉冲", board: b.name, pct: b.pct, mainNet: b.mainNet,
        stocks: "", ts: Date.now(), severity: "warning",
      });
    }
  }
  if (anomalies.length > 0) {
    // 去重：同板块同类型 30 分钟内不重复报
    const seenR = await pool.query("SELECT value FROM kv_store WHERE key=$1", [`anomaly_seen:${ds}`]).catch(() => ({ rows: [] }));
    const seen = new Map();
    try {
      const sv = seenR.rows[0]?.value;
      const obj = sv && typeof sv === "object" && "__raw" in sv ? JSON.parse(sv.__raw) : sv;
      if (obj && typeof obj === "object") for (const [k, v] of Object.entries(obj)) seen.set(k, Number(v));
    } catch { /* 兼容坏值 */ }
    const nowHHmm = `${String(new Date(Date.now() + 8 * 3600 * 1000).getHours()).padStart(2, "0")}${String(new Date(Date.now() + 8 * 3600 * 1000).getMinutes()).padStart(2, "0")}`;
    const fresh = anomalies.filter(a => {
      const k = `${a.board}|${a.type}`;
      const last = seen.get(k);
      if (last != null && nowHHmm - last < 30) return false; // 30 分钟内已报
      seen.set(k, nowHHmm);
      return true;
    });
    if (fresh.length > 0) {
      // 落库 anomaly:日期（前端轮询展示）
      const prevR = await pool.query("SELECT value FROM kv_store WHERE key=$1", [`anomaly:${ds}`]).catch(() => ({ rows: [] }));
      let prev = [];
      try {
        const pv = prevR.rows[0]?.value;
        prev = Array.isArray(pv) ? pv : (pv && typeof pv === "object" && "__raw" in pv ? JSON.parse(pv.__raw) : []);
      } catch { prev = []; }
      await pool.query(
        `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now())
         ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
        [`anomaly:${ds}`, JSON.stringify([...prev.slice(-20), ...fresh])],
      );
      await pool.query(
        `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now())
         ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
        [`anomaly_seen:${ds}`, JSON.stringify(Object.fromEntries(seen))],
      );
      // 推送（多通道并发：飞书/QQ/Server酱 等已配置渠道全推）
      // 频率保护：每轮最多推 3 条（critical 优先），落库保留全部 —— 防首轮 40 条刷屏
      const { sendPushIfConfigured } = require("../routes/push");
      const { shouldPush } = require("../lib/pushDedup"); // v9.130.0（终审 N7）：跨引擎统一冷却
      const toPush = [...fresh].sort((a, b) => (a.severity === "critical" ? 0 : 1) - (b.severity === "critical" ? 0 : 1)).slice(0, 3);
      for (const a of toPush) {
        const title = a.type === "集体涨停" ? `⚡ 板块集体涨停：${a.board}` : `💥 资金脉冲：${a.board}`;
        const body = a.type === "集体涨停"
          ? `${a.board} ${a.count} 只涨停（最高 ${a.lbc} 板）\n${a.stocks}`
          : `${a.board} 涨 ${a.pct}% · 主力净流入 ${(a.mainNet / 1e8).toFixed(1)} 亿`;
        try {
          if (await shouldPush(pool, a.severity, a.board)) {
            await sendPushIfConfigured({ title, body, severity: a.severity });
          }
        } catch { /* 推送失败不影响主链 */ }
      }
      console.log(`[cron] ⚡ 盘中板块异动 ${ds}: ${fresh.map(a => `${a.board}(${a.type})`).join(" | ")}`);
    }
  }
  // ⑤ v9.84.3（4.3）：封单衰减检测（server 下沉，关页不失）→ kv seal_alerts:日期 + 推送
  const sealAlerts = detectSealDecayServer(ztPool);
  if (sealAlerts.length > 0) {
    const prevSealR = await pool.query("SELECT value FROM kv_store WHERE key=$1", [`seal_alerts:${ds}`]).catch(() => ({ rows: [] }));
    let prevSeal = [];
    try {
      const pv = prevSealR.rows[0]?.value;
      prevSeal = Array.isArray(pv) ? pv : (pv && typeof pv === "object" && "__raw" in pv ? JSON.parse(pv.__raw) : []);
    } catch { prevSeal = []; }
    await pool.query(
      `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now())
       ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
      [`seal_alerts:${ds}`, JSON.stringify([...prevSeal.slice(-20), ...sealAlerts])],
    );
    // 推送（red 必推；yellow 最多 2 条防刷屏）
    const { sendPushIfConfigured } = require("../routes/push");
    const sealToPush = sealAlerts.filter(a => a.level === "red").slice(0, 3)
      .concat(sealAlerts.filter(a => a.level === "yellow").slice(0, 2));
    for (const a of sealToPush) {
      const title = a.level === "red" ? `🚨 炸板预警：${a.name}(${a.code})` : `⚠ 封单衰减：${a.name}(${a.code})`;
      const body = `封单 ${(a.prevFund / 1e8).toFixed(2)}亿 → ${(a.nowFund / 1e4).toFixed(0)}万（-${Math.abs(a.changePct)}%${a.changePct === -100 ? "，已开板" : ""}）· ${a.boardCount}板`;
      try { await sendPushIfConfigured({ title, body, severity: a.level === "red" ? "critical" : "warning" }); } catch { /* 静默 */ }
    }
    console.log(`[cron] 🚨 封单衰减 ${ds}: ${sealAlerts.map(a => `${a.name}(${a.changePct}%)`).join(" | ")}`);
  }
  // ⑥ v9.115.0（S1-2）：认知快照构建 + 落库（version 单调递增，表为权威序列）——
  //   全站唯一认知由 cron 驱动刷新，/api/cognition 读表最新；失败不影响既有主链
  try {
    const { buildBrainContext } = require("../lib/brainContext");
    const { buildCognition, rawFromBrainContext, nextVersion, persistCognition } = require("../lib/cognition");
    const { currentSession } = require("../lib/proactiveSession");
    const ctx = await buildBrainContext(pool);
    const raw = rawFromBrainContext(ctx);
    const ver = await nextVersion(pool);
    // v9.123.0（卓越审查 P1-1）：真实时段注入（此前 buildCognition 硬编码"盘中"）
    const cog = buildCognition(raw, ver, currentSession());
    await persistCognition(pool, cog);
    // ⑦ v9.117.0（S3-3）：主动智能流落库（时段洞察 + LLM 预算）—— 前端 ProactiveFeed 读 kv 最新
    try { await runProactiveStore(pool, ds, cog); } catch (e) { console.warn("[cron] 主动流落库失败（不影响主链）:", e.message); }
    console.log(`[cron] 🧠 认知快照 v${cog.version} ${ds}: hash=${cog.hash} 情绪${cog.sentiment.value.stage}(${cog.sentiment.value.score}) 主线${cog.mainline.value.primaryTheme} 闸门${cog.risk.value.gateOpen ? "开" : "关"}`);
  } catch (e) { console.warn("[cron] 认知快照失败（不影响主链）:", e.message); }
  return { sentiment, anomalies: anomalies.length, sealAlerts: sealAlerts.length };
}

async function runProactiveStore(pool, ds, cogArg) {
  const { buildBrainContext } = require("../lib/brainContext");
  const { buildCognition, rawFromBrainContext, latestCognition } = require("../lib/cognition");
  const { currentSession } = require("../lib/proactiveSession");
  const { runProactiveTick, refineInsightsWithLLM } = require("../lib/proactiveScheduler");
  let cog = cogArg ?? null;
  if (!cog) {
    const latest = await latestCognition(pool);
    if (latest) cog = latest;
    else {
      const ctx = await buildBrainContext(pool);
      cog = buildCognition(rawFromBrainContext(ctx), 1);
    }
  }
  const session = currentSession();
  // v9.122.0（卓越 S3-2b）+ v9.123.0（P1-6）：推理层预判接入（cron 路径）——
  //   轻量变体：认知在手，只补 prevCog 环比 + 利好快讯催化（60s 缓存，不重聚合 brainContext）
  let reasoning = null;
  try {
    const { buildReasoningForCog } = require("../routes/reasoning");
    reasoning = await buildReasoningForCog(cog);
  } catch { reasoning = null; }
  const tick = runProactiveTick(cog, session, undefined, reasoning);
  // v9.119.0（润色有效性）：policy-brief 骨架补真实政策快讯（PG news 政策类，润色才有要点可组织）
  try {
    const pb = tick.insights.find((i) => i.id === "policy-brief");
    if (pb) {
      const polR = await pool.query(
        `SELECT title FROM news WHERE title ~ '央行|证监会|国务院|发改委|财政部|工信部|国常会|降准|降息|政策' ORDER BY time DESC LIMIT 3`,
      );
      if (polR.rows.length) {
        pb.body = `政策要点：${polR.rows.map((r) => r.title).join("；")}`;
        pb.evidence = { sampleSize: polR.rows.length, caliber: "政策语料库 PG 实时查询，LLM 摘要（预算内）", asOf: cog?.asOf ?? "" };
      } else {
        // v9.123.0（卓越审查 P0-4）：语料为空不润色——模型对占位文本只会输出拒绝语（实测），
        //   诚实文案 + 0 token（不烧 600 无效预算）
        pb.body = "今日暂无政策催化（语料 N=0），盘前重点回到主线/隔夜映射。";
        pb.llmUsed = false; pb.tokenCost = 0;
        pb.evidence = { sampleSize: 0, caliber: "政策语料 N=0，规则骨架", asOf: cog?.asOf ?? "" };
      }
    }
  } catch { /* 政策语料查询失败 → 保留规则骨架 */ }
  // LLM 润色：仅预算充足条目（盘后复盘 1200/剧本 800/盘前简报 600），失败自动回退规则原文
  const refined = await refineInsightsWithLLM(tick.insights, cog, tick.budget);
  await pool.query(
    `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now())
     ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
    [`proactive:latest`, JSON.stringify({ ts: Date.now(), date: ds, session, insights: refined.insights.slice(0, 8), budget: refined.budget, cognitionVersion: cog?.version ?? null })],
  );
  const llmN = refined.insights.filter((i) => i.llmUsed).length;
  console.log(`[cron] 📡 主动流 ${session.phase}(${session.window}): ${refined.insights.length} 条洞察 · LLM润色${llmN}条 · 预算${refined.budget.llmUsedTokens}/${refined.budget.llmBudgetTokens}`);
}


// ============== V13-1：新闻驱动作战管线（规则抽主题 → LLM 分析 → 规则选股 → LLM 研判） ==============
// 与 src/lib/themeAnalysis.ts（前端共享纯函数）保持算法一致：extractThemeHeat = 关键词折叠 24 大类 + 热度计数
// 数据：news 表（cron 已抓）→ kv fund_streak（板块资金，零新增请求）→ 2 次 callLLM → 落库 theme_analysis
async function runThemeAnalysis({ pool, label = "手动" }) {
  const date = bjDate();
  const dateStr = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  // v9.84（分类统一）：主题词表与前端共享同一份（src/shared/concept-groups.js）——
  // 原内联 20 组与前端 24 组词根漂移（低空经济/数据要素/核能核电等分类不一致），同一新闻两种口径
  const { CONCEPT_GROUPS: GROUP_ROOTS } = require("../../src/shared/concept-groups.js");
  // v9.136.0（主线单源）：主题强度分服务端同构实现（与前端 calcMainlineStrength 逐公式一致）
  const { calcMainlineStrength, rankThemesByStrength } = require("../lib/mainlineStrength");
  const conceptGroupOf = (t) => {
    if (!t) return null;
    let best = null;
    for (const def of GROUP_ROOTS) {
      for (const root of def.roots) {
        if (t.includes(root) && (best === null || root.length > best.root.length)) best = { group: def.group, root };
      }
    }
    return best ? best.group : null;
  };
  // 同长按表序优先（简化：首表命中；与前端最长词根近似——够管线用）

  try {
    // Step 1（规则 0 LLM）：读近 2h 快讯 → 抽主题热度
    // news.time 为 text 类型（"YYYY-MM-DD HH:MM:SS"）→ 用字符串比较（北京时区 2h 前）
    const sinceStr = new Date(Date.now() + 8 * 3600 * 1000 - 2 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");
    const newsR = await pool.query(
      `SELECT title, time, url FROM news WHERE time >= $1 ORDER BY time DESC LIMIT 80`,
      [sinceStr],
    );
    const newsItems = newsR.rows.map(n => ({ title: String(n.title || ""), time: String(n.time), url: n.url ? String(n.url) : undefined }));
    const tally = new Map();
    for (const n of newsItems) {
      const g = conceptGroupOf(n.title);
      if (!g) continue;
      const prev = tally.get(g) ?? { count: 0, items: [] };
      prev.count++;
      if (prev.items.length < 5) prev.items.push({ title: n.title.slice(0, 60), url: n.url, time: n.time });
      tally.set(g, prev);
    }
    const themes = [...tally.entries()]
      .map(([name, v]) => ({ name, heat: Math.min(100, v.count * 15), evidence: v.items }))
      // v9.136.0（主线单源）：不再此处按 heat 排序——Step3b 涨停数据齐后按 strength 重排
      //   （heat 保留为 tie-breaker 与催化参考）
      .slice(0, 10);
    if (themes.length === 0) { console.log("[cron] themeAnalysis: 近2h无新闻主题，跳过"); return null; }

    // Step 2（0 LLM）：读板块资金（kv fund_streak，零新增请求）
    const streakR = await pool.query("SELECT value FROM kv_store WHERE key LIKE 'fund_streak%' ORDER BY updated_at DESC LIMIT 1");
    let fundData = [];
    try {
      // v9.75（正确性修复）：value 为 jsonb 已自动解析；且落库字段是 items（cron.js 写入时 JSON.stringify({date, items})），此前误读 sv.list 恒为空
      const sv = streakR.rows[0]?.value ? (typeof streakR.rows[0].value === "string" ? JSON.parse(streakR.rows[0].value) : streakR.rows[0].value) : null;
      const fundList = sv?.items ?? sv?.list ?? [];
      if (Array.isArray(fundList)) fundData = fundList.map(x => ({
        name: x.board ?? x.name, mainNet: x.mainNet ?? 0, mainNet5d: x.mainNet5d ?? 0, pct: x.pct ?? 0,
      }));
    } catch { fundData = []; }

    // Step 3（1 次 LLM）：行情联动分析
    // v9.75（正确性修复）：资金匹配从 exact（"芯片"≠"半导体"恒 null）改为关键词交集匹配 ——
    // 主题组名(GROUP_ROOTS) 与 东财行业名 用 roots 关键词做包含判断，让 fundAnalysis 有真实数据可引用
    const fundMatchForTheme = (theme) => {
      const roots = GROUP_ROOTS.find(g => g.group === theme)?.roots ?? [];
      if (roots.length === 0) return null;
      let best = null, bestScore = 0;
      for (const f of fundData) {
        const name = String(f.name ?? "");
        let score = 0;
        for (const root of roots) { if (name.includes(root)) score++; }
        if (score > bestScore) { bestScore = score; best = f; }
      }
      return best;
    };
    const analysisPrompt = `你是10年A股游资分析师。基于以下主题热度+板块资金数据，对每个主题做行情联动分析。

主题热度+资金：
${JSON.stringify(themes.map(t => ({
  theme: t.name, heat: t.heat, evidence: t.evidence,
  fund: fundMatchForTheme(t.name),
})))}

规则：
- 资金持续流入(5d>0)+热度高 → "领涨龙头"
- 资金近期回流(1d>0 但 5d 可能<0)+热度上升 → "潜力起爆"
- 热度高但资金流出(1d<0) → "风险警示"

输出严格JSON数组：
[{"theme":"主题名","verdict":"领涨龙头|潜力起爆|风险警示","fundAnalysis":"≤40字引用具体数字","action":"≤20字操作建议"}]`;
    // v9.99.2（全栈体检 B2）：Step3 callLLM 包 try/catch —— 原实现无捕获，LLM 失败抛错被外层 catch 吞掉
    //   → 整条主题分析管线 return null 不落库 → 前端主题作战卡空白且无任何提示（最严重 LLM 失效表现）。
    //   现：失败/解析失败 → 规则兜底 verdict（资金方向判定）继续落库 + llmDegraded 标记，前端可显示"规则版"
    let analysisLlmFailed = false;
    let analysisText = null;
    try {
      analysisText = await callLLM(analysisPrompt, { maxTokens: 4000, temperature: 0.2 }); // v9.107.0（全站助手）：themeAnalysis 提档 3000→4000
    } catch (e) {
      analysisLlmFailed = true;
      console.warn("[themeAnalysis] Step3 LLM 失败，规则兜底 verdict:", e.message);
    }
    let analyses = [];
    if (analysisText) {
      try { analyses = JSON.parse(analysisText); } catch {
        const m = analysisText.match(/\[[\s\S]*\]/);
        if (m) { try { analyses = JSON.parse(m[0]); } catch { analyses = []; } }
      }
    }
    if (!Array.isArray(analyses)) analyses = [];
    // 规则兜底：LLM 失败或输出不可解析 → 按资金方向给 verdict（与 prompt 内规则同口径）
    if (analysisLlmFailed || analyses.length === 0) {
      analysisLlmFailed = true;
      analyses = themes.map(t => {
        const f = fundMatchForTheme(t.name);
        const verdict = f && f.mainNet5d > 0 ? "领涨龙头" : f && f.mainNet > 0 ? "潜力起爆" : "风险警示";
        return { theme: t.name, verdict, fundAnalysis: "LLM 不可用，规则兜底（资金方向）", action: "跟踪观察" };
      });
    }

    // ===== V13-5（P0）Step 3：规则选股 + ETF 匹配 =====
    // 说明：stockPicker.ts / etfScore.ts / classifyStock 均为 TS 前端模块，server(CJS) 无法 require ——
    //   此处内联等价实现（涨停池过滤 + 封单排序；主题→ETF 映射表；GROUP_ROOTS 折叠判断主题归属）
    //   与前端逻辑保持同口径（注释互相引用）
    const ETF_POOL_MINI = [
      { code: "510300", name: "沪深300ETF", kws: ["宽基", "沪深300"] },
      { code: "512480", name: "半导体ETF", kws: ["芯片", "半导体"] },
      { code: "159995", name: "芯片ETF", kws: ["芯片", "半导体"] },
      { code: "515050", name: "5G通信ETF", kws: ["通信", "5G", "光模块", "CPO"] },
      { code: "159819", name: "人工智能ETF", kws: ["AI应用", "人工智能", "大模型", "机器人"] },
      { code: "159852", name: "云计算ETF", kws: ["算力", "云计算", "服务器", "数据中心"] },
      { code: "516510", name: "云计算50ETF", kws: ["算力", "云计算", "数据中心"] },
      { code: "159562", name: "机器人ETF", kws: ["机器人"] },
      { code: "515030", name: "新能源车ETF", kws: ["新能源车", "锂电池"] },
      { code: "516160", name: "新能源ETF", kws: ["新能源", "光伏", "风电", "储能"] },
      { code: "512170", name: "医疗ETF", kws: ["医药", "医疗", "创新药"] },
      { code: "512660", name: "军工ETF", kws: ["军工", "航天", "卫星"] },
      { code: "512880", name: "证券ETF", kws: ["金融", "证券"] },
      { code: "512690", name: "酒ETF", kws: ["白酒", "大消费"] },
      { code: "512980", name: "传媒ETF", kws: ["传媒", "游戏"] },
      { code: "512400", name: "有色金属ETF", kws: ["有色金属", "稀土"] },
      { code: "516110", name: "汽车ETF", kws: ["智能驾驶", "汽车"] },
    ];
    // v9.84.3（5.1）：真实评分替代随机数 —— 主题热度(50%) + 涨停联动(30%) + 基础(20%)
    // 原实现 80+random*15：同一主题每次刷新分数漂移、与前端 etfScore 口径不一致（半成品清理）
    const matchMiniETF = (theme, heat, themeZtCount) => ETF_POOL_MINI
      .filter(e => e.kws.some(k => theme.includes(k) || k.includes(theme)))
      .slice(0, 2)
      .map(e => ({
        code: e.code, name: e.name,
        matchScore: Math.round(Math.min(100,
          Math.min(50, (heat ?? 50) * 0.5) +     // 主题热度贡献 50%（热度100 → 50分）
          Math.min(30, themeZtCount * 6) +        // 涨停联动贡献 30%（每只涨停 +6）
          20,                                     // 基础分
        )),
      }));

      const themePicks = new Map(); // theme → picks
      const themeEtfs = new Map();  // theme → etfs
      // v9.136.0（主线单源）：主题涨停信息（ztCount/height/mainNet5d）→ Step3b 后算强度分
      const ztInfo = new Map();     // theme → { ztCount, height, mainNet5d }
      // v9.89.0：zt 池提升到 try 外 —— 原 const arr 在 try 块内（块级作用域），
      //   Step4 的 `(Array.isArray(arr) ? arr : [])` 在 try 外引用 → ReferenceError: arr is not defined
      //   （v9.75 遗留，被 concept-groups module 错误掩盖至今）
      let arr = [];
      try {
        // v9.75（正确性修复）：zt_snapshot.date 实际存储为带横杠 dateStr（fetchZTPool cron.js 返回）
        // 原用无横杠 date 等值查询永不命中 → ztPool 恒空 → Step4 LLM 选股研判从未真正跑过（死代码）
        const ztR = await pool.query(`SELECT data FROM zt_snapshot WHERE date = $1 LIMIT 1`, [dateStr]);
        // zt_snapshot.data 为 jsonb（pg 可能返回字符串或对象）→ 兼容两种
        const raw = ztR.rows[0]?.data;
        const ztPool = typeof raw === "string" ? JSON.parse(raw) : (raw ?? []);
        arr = Array.isArray(ztPool) ? ztPool : (ztPool.pool ?? []);
        for (const th of themes) {
          // 3a. 主题归属过滤（内联 conceptGroupOf 判断：hybk/名称折叠到主题大类）
          const themeStocks = arr.filter(s => {
            const g = conceptGroupOf(String(s.hybk ?? ""));
            // v9.93.3-fix：zt_snapshot 落库字段是 code/name（fetchZTPool 已 map），
            // 原用接口原始 s.c/s.n → 恒空 → 龙头标的 code/name 空壳
            const name = String(s.name ?? s.n ?? "");
            return g === th.name || name.includes(th.name) || String(s.hybk ?? "").includes(th.name);
          });
          // v9.136.0（主线单源）：收集主题涨停信息（强度分输入；mainNet5d 取资金匹配值）
          const thFund = fundMatchForTheme(th.name);
                    const themeTurnover = themeStocks.length > 0 ? themeStocks.reduce((sum, s) => sum + Number(s.hs ?? 0), 0) / themeStocks.length : null;
          ztInfo.set(th.name, {
            ztCount: themeStocks.length,
            height: themeStocks.reduce((m, s) => Math.max(m, Number(s.lbc ?? s.lbc ?? 1) || 1), 1),
            mainNet5d: thFund?.mainNet5d ?? 0,
            turnoverRate: themeTurnover,
          });
          // 3b. 排序选股（封单 > 连板 > 涨幅，取 2-3 只）
          const picks = themeStocks
            .sort((a, b) => (b.fund ?? 0) - (a.fund ?? 0) || (b.lbc ?? 1) - (a.lbc ?? 1) || (b.zdp ?? 0) - (a.zdp ?? 0))
            .slice(0, 3)
            .map((s, i) => ({
              code: String(s.code ?? s.c ?? ""), name: String(s.name ?? s.n ?? ""),
              role: i === 0 ? "首选" : i === 1 ? "接力" : "低吸",
              correlation: 0, buyTrigger: `竞价/回踩企稳再考虑（主题热度${th.heat}）`, stopLoss: "跌破前低-5%", risk: "追高回落",
            }));
          themePicks.set(th.name, picks);
          // 3c. ETF 匹配（主题→ETF 映射表；真实评分 = 热度 + 涨停联动）
          themeEtfs.set(th.name, matchMiniETF(th.name, th.heat, themeStocks.length));
        }
      } catch { /* 无涨停池快照 → picks 空 */ }

      // v9.136.0（主线单源）：主题强度分（与前端 calcMainlineStrength 同口径）→ strength 降序重排
      //   —— 服务端 primaryTheme 与前端实战引擎 candidates[0] 判定口径一致（排序键统一）
      //   催化剂：与前端同 0/1 判定（有新闻 evidence → 60，无 → 50）
      const totalZt = arr.length;
      const totalMaxHeight = arr.reduce((m, s) => Math.max(m, Number(s.lbc ?? 1) || 1), 1);
      for (const th of themes) {
        const zi = ztInfo.get(th.name) ?? { ztCount: 0, height: 1, mainNet5d: 0, turnoverRate: null };
        const r = calcMainlineStrength({
          ztCount: zi.ztCount,
          totalZtCount: totalZt,
          height: zi.height,
          totalMaxHeight,
          promotionRate: null, // 晋级率暂无逐主线数据，中性（与前端一致）
          mainNet5d: zi.mainNet5d,
          mainNet10d: null,
          boardPct: 0,
          turnoverRate: zi.turnoverRate ?? null,
          catalystStrength: (th.evidence?.length ?? 0) > 0 ? 60 : 50, // 有新闻催化 → 略加分（与前端 newsTitles 判定一致）
        });
        th.ztCount = zi.ztCount;
        th.height = zi.height;
        th.mainNet5d = zi.mainNet5d;
        th.strength = r.score;
        th.strengthFactors = r.factors;
      }
      themes.splice(0, themes.length, ...rankThemesByStrength(themes));

    // ===== V13-5（P0）Step 4：LLM 批量研判 + 关联度验证（correlation<0.5 → 回避并过滤） =====
    // v9.75（深化）：Step4 已激活（日期修复后 ztPool 非空），给 LLM 喂真实行情证据
    // （连板数/封单额/涨幅/hybk），避免 correlation/stopLoss/risk 全靠模型记忆编造
    const allPicks = [...themePicks.entries()].flatMap(([theme, picks]) => picks.map(p => ({ ...p, theme })));
    let stockVerdicts = [];
    if (allPicks.length > 0) {
      const pickRows = allPicks.map(p => {
        const s = (Array.isArray(arr) ? arr : []).find(x => String(x.code ?? x.c) === p.code);
        return {
          theme: p.theme, code: p.code, name: p.name, role: p.role,
          boards: s ? String(s.lbc ?? 1) : "?", sealFund: s ? String(s.fund ?? "?") : "?", pct: s ? String(s.zdp ?? "?") : "?", industry: s ? String(s.hybk ?? "?") : "?",
        };
      });
      const stockPrompt = `对以下主题选股做关联度验证+研判。每只股票必须是该主题的高关联标的（不是蹭概念）。已给真实数据：连板数boards/封单额sealFund/涨幅pct/所属行业industry。
${JSON.stringify(pickRows)}

输出严格JSON数组：
[{"code":"代码","correlation":0.0-1.0,"verdict":"可买|谨慎|回避","buyTrigger":"≤30字","stopLoss":"≤20字","risk":"≤30字"}]
correlation<0.5 的标的是低关联度蹭概念，verdict 必须"回避"。
correlation 必须基于行业归属（industry）与主题关联度判断，不得凭空捏造。`;
      try {
        const stockText = await callLLM(stockPrompt, { maxTokens: 4000, temperature: 0.2 });
        // v9.87.0（P1-8）：统一解析 + verdict 枚举/correlation clamp
        stockVerdicts = parseLLMJSON(stockText, SCHEMAS.stockSelect) ?? [];
      } catch { stockVerdicts = []; }
    }
    const verdictMap = new Map((Array.isArray(stockVerdicts) ? stockVerdicts : []).map(v => [String(v.code), v]));

    // Step 6：合并 + 落库（theme_analysis:日期:时分 + latest）—— 含 evidence(带URL)/picks(关联度)/etfs
    const result = {
      date: dateStr,
      time: new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(11, 16),
      round: label,
      llmDegraded: analysisLlmFailed, // v9.99.2（B2）：Step3 LLM 失败规则兜底标记（前端可显示"规则版"）
      themes: themes.map(t => {
        const a = analyses.find(x => x.theme === t.name) ?? {};
        const rawPicks = (themePicks.get(t.name) ?? []).map(p => {
          const v = verdictMap.get(p.code) ?? {};
          // v9.93.1（用户报障：无龙头标的）：LLM 失败时 correlation 恒 0 → 被下方 <0.5 全过滤 → picks 空。
          // 规则兜底关联度（基于角色：首选/接力/低吸），保证龙头标的始终可见；LLM 成功时以 LLM 值为准
          const ruleCorr = p.role === "首选" ? 0.7 : p.role === "接力" ? 0.6 : 0.5;
          return {
            ...p,
            correlation: v.correlation ?? ruleCorr,
            aiVerdict: v.verdict ?? (p.role === "首选" ? "可买" : "谨慎"),
            buyTrigger: v.buyTrigger ?? p.buyTrigger,
            stopLoss: v.stopLoss ?? p.stopLoss,
            risk: v.risk ?? p.risk,
          };
        });
        return {
          theme: t.name, heat: t.heat, trend: a.verdict === "风险警示" ? "down" : "up",
          verdict: a.verdict ?? "观察", fundAnalysis: a.fundAnalysis ?? "资金数据不足", action: a.action ?? "跟踪观察",
          // v9.136.0（主线单源）：主题强度分（与前端 calcMainlineStrength 同口径，排序键）
          ztCount: t.ztCount ?? 0, height: t.height ?? 0,
          strength: t.strength ?? 0, strengthFactors: t.strengthFactors ?? null,
          // V13-5：evidence 带 url（新闻可点击）；picks 过滤关联度<0.5（蹭概念不展示）；etfs
          evidence: t.evidence ?? [],
          picks: rawPicks.filter(p => (p.correlation ?? 0) >= 0.5),
          etfs: themeEtfs.get(t.name) ?? [],
        };
      }),
    };
    const hhmm = `${String(new Date().getHours()).padStart(2, "0")}${String(new Date().getMinutes()).padStart(2, "0")}`;
    await pool.query(
      `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now()) ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
      [`theme_analysis:${dateStr}:${hhmm}`, JSON.stringify(result)],
    );
    await pool.query(
      `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now()) ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
      ["theme_analysis:latest", JSON.stringify({ ...result, key: `theme_analysis:${dateStr}:${hhmm}` })],
    );
    console.log(`[cron] themeAnalysis(${label}): ${themes.length}主题 ${allPicks.length}标的`);
    return result;
  } catch (e) {
    console.error("[cron] themeAnalysis failed:", e.message);
    return null;
  }
}
module.exports = { runIntradayBrain, runProactiveStore, runThemeAnalysis };

