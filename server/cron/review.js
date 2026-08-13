// ============================================================
// server/cron/review.js —— 领域模块（v9.139.0 阶段二 #16，split-cron.js 自动拆分）
// 行为与原 cron.js 逐字一致；原文件已只留调度注册
// ============================================================
const B = require("./base");
const { contentKey, httpsGet, bjDate, bjDateStr, EM_UT, detectSealDecayServer, markCronStep, hasCronStep, isTradingDayCN, getJson, getJsonWithFallback, requestRaw, parseLLMJSON, SCHEMAS, withPgLock, LOCK_CRON_MAIN, LOCK_THEME, LOCK_WATCH, LOCK_INTRADAY, callLLM, saveFactorIc } = B;
const { rankStrongAnnouncements } = require("./news");


// ---------- 自动 LLM 分析（可选：配了 key 才调用；无 key 走规则版标注） ----------
// 分析结果写入 kv_store: llm_analysis:YYYY-MM-DD
// v9.26.5：接入真实 LLM（AI_API_KEY 配置在 server/.env 时自动启用）
async function analyzeDaily({ pool }) {
  try {
    const date = bjDate();
    const dateStr = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
    const newsR = await pool.query("SELECT * FROM news WHERE time >= $1 ORDER BY time DESC LIMIT 100", [dateStr]);
    const annR = await pool.query("SELECT * FROM announcements WHERE time >= $1 ORDER BY time DESC LIMIT 100", [dateStr]);

    const strongNews = newsR.rows.filter(n => n.stars >= 3).slice(0, 10).map(n => n.title);
    // v9.28（P2-5）：强催化公告改用"LLM评分优先 + 扩展正则兜底"（替换原粗筛正则）
    const strongAnn = await rankStrongAnnouncements(pool, dateStr);

    // v9.26.5：配了服务端 Key → 真实调用 LLM 生成当日市场分析；否则规则版标注
    let llmText = "规则版（未配置服务端 LLM Key，前端 AI 功能可正常使用配置的 Key）";
    if (process.env.AI_API_KEY) {
      try {
        llmText = await callLLM(JSON.stringify({
          strongNews,
          strongAnn,
          newsTotal: newsR.rows.length,
          annTotal: annR.rows.length,
        }));
      } catch (e) {
        llmText = `LLM调用失败(${e.message})，本次为规则版快照`;
        console.error("[cron] analyze LLM failed:", e.message);
      }
    }

    const analysis = {
      date: dateStr,
      summary: `今日自动快照：涨停快照已存库 · 快讯${newsR.rows.length}条 · 公告${annR.rows.length}条 · 强催化公告${strongAnn.length}条`,
      strongAnn,
      strongNews,
      llm: llmText,
      createdAt: new Date().toISOString(),
    };
    await pool.query(
      `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now())
       ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
      [`llm_analysis:${dateStr}`, JSON.stringify(analysis)],
    );
    console.log(`[cron] analyze ${dateStr} done: ${strongAnn.length} strong ann`);
  } catch (e) {
    console.error("[cron] analyze failed:", e.message);
  }
}


// ---------- v9.33（缺口2）：盘后自动复盘（15:40 后） ----------
// v9.94.0（第四段）：盘后复盘升级为 13 维度结构化（tdxclaw 式）——
// 数据面全部来自现有 PG 数据源（不新增外部抓取），LLM 只负责研判文本；
// 落库 review:YYYY-MM-DD = { date, mainlines, text, dimensions:{d0..d11}, createdAt }
// 前端 DailySummary 同构渲染（服务端数据优先，AI 按钮仅做人工补全）
async function generateDailyReview({ pool }) {
  try {
    const date = bjDate();
    const dateStr = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
    const dayStart = `${dateStr} 00:00`;

    // ========== 维度数据采集（全部现有数据源） ==========
    // d0 数据完整性声明
    const d0 = { date: dateStr, generatedAt: new Date().toISOString(), sources: {} };

    // d3 涨跌停：zt_snapshot（涨停池）
    let snap = null, poolArr = [], blastedArr = [];
    try {
      const snapR = await pool.query("SELECT data FROM zt_snapshot WHERE date = $1 LIMIT 1", [dateStr]);
      snap = snapR.rows[0]?.data ?? null;
      poolArr = Array.isArray(snap?.pool) ? snap.pool : [];
      d0.sources.limitUp = poolArr.length;
    } catch { /* ignore */ }

    // d4 板块效应：涨停池按 hybk 分组（涨停数/龙头/最高连板）
    const themeMap = new Map();
    for (const p of poolArr) {
      const h = String(p.hybk || "未分类");
      if (!themeMap.has(h)) themeMap.set(h, []);
      themeMap.get(h).push({ name: String(p.n || p.name || ""), lbc: p.lbc ?? 0, code: p.code });
    }
    const d4Boards = [...themeMap.entries()]
      .map(([name, arr]) => ({
        name, count: arr.length,
        pct: Math.round(arr.length / Math.max(poolArr.length, 1) * 100),
        leaders: arr.slice(0, 3).map(x => x.name).join("/"),
        maxLbc: Math.max(...arr.map(x => x.lbc ?? 0)),
      }))
      .sort((a, b) => b.count - a.count).slice(0, 8);
    const mainlines = d4Boards.map(b => `${b.name}(${b.count}只)`).join("；") || "无";

    // d3 连板梯队：涨停池按 lbc 降序 TOP6
    const d3Ladder = poolArr
      .filter(p => (p.lbc ?? 0) >= 2)
      .sort((a, b) => (b.lbc ?? 0) - (a.lbc ?? 0))
      .slice(0, 6)
      .map(p => ({ name: String(p.n || p.name || ""), lbc: p.lbc ?? 0, hybk: p.hybk ?? "", pct: p.pct }));

    // d3 炸板池：zt_snapshot 的 blasted（若存在）+ 涨停池中高开板次
    try {
      const blastR = await pool.query("SELECT data FROM zt_snapshot WHERE date = $1", [dateStr]);
      const bsnap = blastR.rows[0]?.data;
      if (Array.isArray(bsnap?.blasted)) blastedArr = bsnap.blasted.slice(0, 5);
    } catch { /* ignore */ }

    // d2 主力资金 TOP20：fund_streak 行业（现有）+ 涨停池个股 fund 字段
    let fundItems = [];
    try {
      const fr = await pool.query("SELECT value FROM kv_store WHERE key = $1", [`fund_streak:${dateStr}`]);
      fundItems = (fr.rows[0]?.value?.items ?? []).slice(0, 8).map(x => ({ name: x.name, mainNet: x.mainNet }));
    } catch { /* ignore */ }
    const d2StockFund = poolArr
      .filter(p => (p.fund ?? 0) > 0)
      .sort((a, b) => (b.fund ?? 0) - (a.fund ?? 0))
      .slice(0, 10)
      .map(p => ({ name: String(p.n || p.name || ""), code: p.code, fund: p.fund ?? 0, pct: p.pct }));

    // d5 事件催化词频：news 标题关键词统计（涨停原因/快讯标题）
    let newsTitles = [];
    try {
      const nr = await pool.query("SELECT title FROM news WHERE time >= $1 LIMIT 500", [dayStart]);
      newsTitles = nr.rows.map(r => String(r.title || ""));
    } catch { /* ignore */ }
    const CATALYST_KEYS = ["创新药", "半导体", "芯片", "电力", "机器人", "PCB", "算力", "数据中心", "储能", "锂电", "光伏", "军工", "AI", "重组", "涨价", "业绩预增", "中标", "IPO", "出海", "消费", "医药", "光模块", "存储", "稀土", "钨", "铜"];
    const catMap = new Map();
    for (const t of newsTitles) {
      for (const k of CATALYST_KEYS) {
        if (t.includes(k)) catMap.set(k, (catMap.get(k) ?? 0) + 1);
      }
    }
    const d5Catalysts = [...catMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([kw, count]) => ({ kw, count }));

    // d6 异常检测：高炸板（涨停池高 lbc 但无延续）+ 高换手（pool 无换手字段则用 zttj）
    const d6Anomalies = poolArr
      .filter(p => (p.zttj?.ct ?? 0) > 5 || (p.lbc ?? 0) >= 5)
      .slice(0, 5)
      .map(p => ({ name: String(p.n || p.name || ""), reason: `连板${p.lbc ?? 0}板`, note: "高位股注意分歧" }));

    // d7 公告业绩：announcements（强催化 score 排序）
    let d7Anns = [];
    try {
      const ar = await pool.query(
        "SELECT stock_name, title, score FROM announcements WHERE time >= $1 AND score IS NOT NULL ORDER BY score DESC LIMIT 8",
        [dayStart],
      );
      d7Anns = ar.rows.map(r => ({ name: r.stock_name, title: String(r.title || "").slice(0, 60), score: r.score }));
    } catch { /* ignore */ }
    if (d7Anns.length === 0) {
      try {
        const la = await pool.query("SELECT value FROM kv_store WHERE key = $1", [`llm_analysis:${dateStr}`]);
        d7Anns = (la.rows[0]?.value?.strongAnn ?? []).slice(0, 8).map(a => {
          const s = String(a ?? "");
          const i = s.indexOf(":");
          return { name: i > 0 ? s.slice(0, i) : s, title: i > 0 ? s.slice(i + 1) : s, score: null };
        });
      } catch { /* ignore */ }
    }

    // d8 龙虎榜
    let d8Lhb = [];
    try {
      const lr = await pool.query("SELECT value FROM kv_store WHERE key = $1", [`lhb:${dateStr}`]);
      d8Lhb = (lr.rows[0]?.value?.items ?? []).slice(0, 8).map(x => ({
        name: x.name, code: x.code, netBuy: x.netBuy ?? 0, pct: x.pct,
      }));
    } catch { /* ignore */ }

    // d9 自选股/持仓：watchlist 当日快照（zt_snapshot 中匹配 + news 中提及）
    let watchR = null;
    try {
      watchR = await pool.query("SELECT value FROM kv_store WHERE key = 'stock_watchlist'");
    } catch { /* ignore */ }
    const watchList = Array.isArray(watchR?.rows?.[0]?.value) ? watchR.rows[0].value : [];
    const d9Watch = watchList.map(code => {
      const hit = poolArr.find(p => p.code === code);
      return { code, name: hit ? String(hit.n || hit.name || "") : code, pct: hit?.pct ?? null, lbc: hit?.lbc ?? 0 };
    }).filter(w => w.pct != null);

    // d10 催化日历：黑天鹅 + 强催化公告标题（近期事件）
    let d10Events = [];
    try {
      const bsR = await pool.query("SELECT value FROM kv_store WHERE key = $1", [`black_swan:${dateStr}`]);
      d10Events = (bsR.rows[0]?.value?.items ?? []).slice(0, 5).map(i => ({ title: i.title, name: i.name ?? "", level: "黑天鹅" }));
    } catch { /* ignore */ }

    // d11 次日关注：LLM 生成（依赖文本研判）+ 涨停池强资金兜底
    const d11Picks = d2StockFund.slice(0, 5).map(x => ({ name: x.name, code: x.code, fund: x.fund }));

    // ========== LLM 研判文本（4 段，与原逻辑一致） ==========
    let reviewText = "";
    const system = `你是10年经验的A股游资复盘分析师。基于今日收盘数据做盘后复盘。严格按以下四个标题输出，禁止增减标题，每段≤4行：【今日主线回顾】【错过与教训】【明日关注清单】【风险提示】。直接输出正文。`;
    const strongAnn = d7Anns.slice(0, 5).map(a => (a.name && a.title) ? `${a.name}:${a.title}` : String(a.title ?? "")).join("；");
    const blackSwans = d10Events.map(e => e.title).join("；");
    const userText = `日期：${dateStr}\n今日主线：${mainlines}\n涨停${poolArr.length}只\n板块TOP：${d4Boards.slice(0, 3).map(b => `${b.name}${b.count}只`).join("、")}\n连板梯队：${d3Ladder.map(x => `${x.name}${x.lbc}板`).join("、") || "无"}\n资金TOP：${d2StockFund.slice(0, 3).map(x => `${x.name}${(x.fund / 1e8).toFixed(1)}亿`).join("、")}\n强催化公告：${strongAnn || "无"}\n黑天鹅公告：${blackSwans || "无"}`;
    if (process.env.AI_API_KEY) {
      try { reviewText = await callLLM(userText, { system, maxTokens: 4000, temperature: 0.3 }); } // v9.107.0（全站助手）：复盘提档 2000→4000（原 v9.101.0 P1-06：1000→2000 复盘 empty content 根因）
      catch (e) { reviewText = `【今日主线回顾】${mainlines}\n【错过与教训】LLM调用失败(${e.message})\n【明日关注清单】请稍后重试\n【风险提示】炸板数据见情绪卡`; }
    } else {
      reviewText = `【今日主线回顾】规则版：${mainlines}\n【错过与教训】未配置服务端 LLM Key\n【明日关注清单】请配置 AI_API_KEY 后自动生成\n【风险提示】涨停${poolArr.length}只`;
    }

    // ========== 组装 13 维度结构 ==========
    const dimensions = {
      d0,                                        // 数据完整性声明
      d2: { fundBoards: fundItems, stockFundTop: d2StockFund },  // 主力资金
      d3: { limitUp: poolArr.length, ladder: d3Ladder, blasted: blastedArr },  // 涨跌停全景
      d4: { boards: d4Boards },                  // 板块效应
      d5: { catalysts: d5Catalysts },            // 事件催化词频
      d6: { anomalies: d6Anomalies },            // 异常检测
      d7: { anns: d7Anns },                      // 公告业绩
      d8: { lhb: d8Lhb },                        // 龙虎榜
      d9: { watch: d9Watch },                    // 自选股/持仓
      d10: { events: d10Events },                // 催化日历（黑天鹅）
      d11: { picks: d11Picks },                  // 次日关注（资金兜底）
      d12: { text: reviewText },                 // Agent 研判（LLM 文本）
    };

    const review = { date: dateStr, mainlines, text: reviewText, dimensions, createdAt: new Date().toISOString() };
    await pool.query(
      `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now())
       ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
      [`review:${dateStr}`, JSON.stringify(review)],
    );
    console.log(`[cron] review ${dateStr} saved (13维: 涨停${poolArr.length} 板块${d4Boards.length} 资金TOP${d2StockFund.length} 催化${d5Catalysts.length} 龙虎榜${d8Lhb.length})`);
  } catch (e) {
    console.error("[cron] review failed:", e.message);
  }
}


// ---------- v9.38.1（V3-12）：事件三级分类闭环（政策/行业/事件） ----------
// 盘后 cron 批量跑一次：读当日快讯 → 去重 → LLM 分级 → 落库 event_classify:日期
// 验收：一条"央行降准"新闻被分为政策级、beneficiaries 含银行/地产
async function runEventClassify({ pool }) {
  const date = bjDate();
  const dateStr = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  try {
    // 1. 读当日快讯（按 star 排序，取 top 30）
    const r = await pool.query(
      `SELECT title, time, stars FROM news
       WHERE time >= $1
       ORDER BY (stars IS NOT NULL) DESC, stars DESC, time DESC
       LIMIT 60`,
      [`${dateStr} 00:00:00`],
    );
    // 2. 去重（同标题前缀合并——同一事件多条快讯）
    const seen = new Set();
    const events = [];
    for (const row of r.rows) {
      const title = String(row.title || "").trim();
      if (!title) continue;
      const key = title.slice(0, 18); // 前缀去重
      if (seen.has(key)) continue;
      seen.add(key);
      events.push({ title: title.slice(0, 60), source: "东财快讯" });
      if (events.length >= 15) break; // 批量 15（太多会超 token 截断）
    }
    if (events.length === 0) {
      console.log("[cron] event_classify: 当日无快讯，跳过");
      return;
    }

    // JSON 容错解析：v9.87.0（P1-8）统一走 llmJson（含截断补 ] + level/catalystScore schema 归一化），
    // 原 parseLoose 内联实现移除

    // 3. LLM 三级分级（与前端 aiPrompts eventClassify 同构）；不可用 → 规则版
    let items = null;
    const system = `你是A股事件分级器。对以下新闻/公告事件做三级分类并评估影响。\n只返回JSON数组，无其他文字。`;
    const userText = `事件列表（标题|来源）：\n${events.map(e => `- ${e.title} | ${e.source}`).join("\n")}\n\n输出严格JSON数组，每事件一项：\n[{"title":"原标题","level":"政策|行业|事件","beneficiaries":["受益板块1","板块2"],"catalystScore":0-100,"timeSensitivity":"即时|短期|中长期","reason":"≤25字"}]\n分级规则：\n- 政策级：国务院/央行/证监会/发改委/国常会/部委发文 → beneficiaries 给受益行业清单\n- 行业级：产业链事件/涨价/订单/技术突破 → beneficiaries 给细分方向\n- 事件级：个股公告/中标/减持 → beneficiaries 给该股行业\ncatalystScore 按影响力度：国常会级 85-100 / 部委级 65-84 / 行业级 40-64 / 个股级 20-40`;
    if (process.env.AI_API_KEY) {
      try {
        const text = await callLLM(userText, { system, maxTokens: 4000, temperature: 0.1 }); // v9.107.0（全站助手）：事件分级提档 3000→4000
        const parsed = parseLLMJSON(text, SCHEMAS.eventClassify); // v9.89.0：修复 v9.87.0 残留（原 parseLoose 未定义，LLM 分级恒作废）
        // v9.85.2（P2-2）：LLM 分级结果标注 source/confidence
        if (parsed && parsed.length > 0) items = parsed.map(x => ({ ...x, source: "llm", confidence: "high" }));
      } catch (e) {
        console.warn("[cron] event_classify LLM 失败，走规则版:", e.message);
      }
    }
    if (!items) {
      // v9.85.2（P2-2）：规则版同样标注来源（前端可区分规则召回与 LLM 精分级）
      items = events.map(e => {
        const t = e.title;
        let level = "事件";
        if (/国务院|央行|证监会|发改委|国常会|部委|印发|通知|规划|试点|专项/.test(t)) level = "政策";
        else if (/产业链|涨价|订单|技术|量产|突破|扩产|招标/.test(t)) level = "行业";
        return { title: t.slice(0, 30), level, beneficiaries: [], catalystScore: level === "政策" ? 70 : level === "行业" ? 50 : 30, timeSensitivity: "短期", reason: "规则版分级", source: "rule", confidence: "medium" };
      });
    }

    // 4. 落库
    const payload = { date: dateStr, items, createdAt: new Date().toISOString() };
    await pool.query(
      `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now())
       ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
      [`event_classify:${dateStr}`, JSON.stringify(payload)],
    );
    const policyCount = items.filter(i => i.level === "政策").length;
    const indCount = items.filter(i => i.level === "行业").length;
    console.log(`[cron] event_classify ${dateStr}: ${items.length} 事件（政策${policyCount}/行业${indCount}/事件${items.length - policyCount - indCount}）`);
  } catch (e) {
    console.error("[cron] event_classify failed:", e.message);
  }
}
module.exports = { analyzeDaily, generateDailyReview, runEventClassify };

