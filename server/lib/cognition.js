// ============================================================
// server/lib/cognition.js —— 单一 AI 认知层（v9.115.0，S1-1）
// 架构定位：全站唯一的"市场理解"对象。作战卡/决策卡/精灵/复盘/问答/盯价
//   均消费同一份 MarketCognition，而非各自取数各自判（终审 D-01 之上延伸）。
// 设计原则：① 不可变快照；② 每字段带溯源(Provenance: source/asOf/stale/
//   confidence/sampleSize/caliber)；③ 单调版本号 + 内容哈希保证一致性。
// 纯函数：无 I/O、无 LLM、秒级、可回测 —— 输入相同输出相同（双端同构 golden）。
// 移植说明：源 = 参考实现 src/lib/cognition/builder.ts（TS→CJS 三步：去类型/
//   import→require/module.exports）；raw 数据源 = server/lib/brainContext.js 的
//   buildBrainContext() PG 聚合输出（只换数据源，下游零改动）。
// 口径说明：情绪温度计复用真实口径 upRatio*40+limitScore*1.3+avgPct*0.8+20；
//   PG 无涨跌家数/平均涨幅 → 真实场景以 PG 落库 sentiment 为准（适配层注入 _pg.sentiment）
// ============================================================

/** 轻量确定性哈希（非密码学，仅用于一致性校验）—— 与前端同构实现保持一致 */
function hashString(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return (h >>> 0).toString(16).padStart(8, "0");
}

function pgProvenance(asOf, sampleSize, caliber, confidence = 0.92) {
  return { source: "pg", asOf, stale: false, confidence, sampleSize, caliber };
}
function derivedProvenance(asOf, caliber, confidence = 0.8) {
  return { source: "derived", asOf, stale: false, confidence, sampleSize: 0, caliber };
}

/** 情绪周期判定 —— 游资短线核心：把"情绪温度计"映射到买卖点坐标系 */
function deriveSentimentStage(score, premium, brokenRate) {
  // v9.115.0（S1-1 验收③）：premium<0（昨日涨停今日负溢价=接力亏钱）强制压制阶段 → 退潮/分歧，
  //   高温度分不得掩盖亏钱效应（审查官验收口径：premium<0 时 stage 必须落入 退潮/分歧）
  if (score < 30) return "冰点";
  if (score < 45) return "退潮";
  if (premium < 0) return brokenRate > 0.15 ? "分歧" : "退潮";
  if (score > 82 && premium > 3) return brokenRate > 0.15 ? "分歧" : "高潮";
  if (score > 65) return "发酵";
  return "启动";
}

function buildMainline(raw) {
  const sorted = [...(raw.mainlines ?? [])].sort((a, b) => (b.strength ?? 0) - (a.strength ?? 0));
  const top = sorted[0];
  if (!top) {
    return {
      value: { primaryTheme: "数据不足", ladder: { tier1: [], tier2: [], tier3: [] }, strength: 0, hotspotRotation: "轮动" },
      provenance: derivedProvenance(raw.asOf, "主线数据缺失（PG theme_analysis 空）"),
    };
  }
  const value = {
    primaryTheme: top.name,
    ladder: {
      tier1: top.leaders ?? [],
      tier2: top.followers ?? [],
      tier3: sorted.slice(1).map((m) => m.name),
    },
    strength: top.strength,
    hotspotRotation: sorted[0].strength - (sorted[2]?.strength ?? 0) > 20 ? "持续" : "轮动",
  };
  return { value, provenance: pgProvenance(raw.asOf, raw.mainlines.length, "题材梯队按强度排序，leader/follower 由涨停池归因") };
}

function buildSentiment(raw) {
  const s = raw.sentimentRaw ?? {};
  // v9.115.0（S1-1 口径适配）：PG 落库情绪分（brainContext market.sentiment）为准 ——
  //   PG 无涨跌家数/平均涨幅，upRatio/avgPct 公式在真实场景不可用；演示/测试入参不带 _pg 时走公式口径
  const score = raw._pg?.sentiment != null
    ? Math.round(raw._pg.sentiment)
    : Math.round((s.upRatio ?? 0) * 40 + (s.limitScore ?? 0) * 1.3 + (s.avgPct ?? 0) * 0.8 + 20);
  const brokenRate = raw._pg?.blastedRate != null
    ? raw._pg.blastedRate / 100
    : (raw.limit?.broken?.length ?? 0) / Math.max(1, (raw.limit?.up?.length ?? 0) + (raw.limit?.broken?.length ?? 0));
  const value = {
    stage: deriveSentimentStage(score, s.premium ?? 0, brokenRate),
    score,
    upRatio: s.upRatio ?? null,
    limitScore: s.limitScore ?? null,
    avgPct: s.avgPct ?? null,
    premium: s.premium ?? null,
    // v9.115.0（S1-3）：炸板率 0-100 暴露（助手快照行/决策层消费；认知层统一口径）
    blastedRate: Math.round(brokenRate * 1000) / 10,
  };
  return {
    value,
    provenance: pgProvenance(raw.asOf, raw.breadth?.total ?? 0, "情绪温度计=upRatio*40+limitScore*1.3+avgPct*0.8+20；真实场景以 PG 落库 sentiment 为准"),
  };
}

function buildCapital(raw) {
  const funds = raw.boardFund ?? [];
  const net = funds.reduce((a, b) => a + (b.bigNet ?? 0), 0);
  const gap = funds.reduce((a, b) => a + (b.darkLightGap ?? 0), 0);
  const signal = gap > 10 && net > 0 ? "吸筹" : gap > 0 && net > 0 ? "洗盘" : gap < 0 && net < 0 ? "出货" : "中性";
  return {
    value: { netFlow: Math.round(net * 10) / 10, darkVsLight: Math.round(gap * 10) / 10, signal },
    provenance: pgProvenance(raw.asOf, funds.length, "明暗盘：暗盘=超大+大单 明盘=中+小单，方向相反绝对值大→洗/出", 0.85),
  };
}

function buildRisk(raw) {
  const traps = [];
  const brokenRate = raw._pg?.blastedRate != null
    ? raw._pg.blastedRate / 100
    : (raw.limit?.broken?.length ?? 0) / Math.max(1, (raw.limit?.up?.length ?? 0) + (raw.limit?.broken?.length ?? 0));
  if (brokenRate > 0.2) traps.push("炸板率偏高");
  if ((raw.sentimentRaw?.premium ?? 0) < 0) traps.push("昨日涨停今日负溢价(接力亏钱)");
  if ((raw.boardFund ?? []).some((b) => b.signal === "出货")) traps.push("部分板块主力出货");
  const level = traps.length >= 3 ? "极高" : traps.length === 2 ? "高" : traps.length === 1 ? "中" : "低";
  // 情绪闸门：启动/发酵/高潮阶段且无极高危险 → 放开
  const gateOpen = !traps.includes("昨日涨停今日负溢价(接力亏钱)") && level !== "极高";
  return {
    value: { level, traps, gateOpen },
    provenance: derivedProvenance(raw.asOf, "风险项=规则触发(炸板率/溢价/板块出货)，闸门=情绪阶段×风险等级"),
  };
}

function buildLeader(raw) {
  const up = raw.limit?.up ?? [];
  const byRelay = [...up].sort((a, b) => (b.relay ?? 0) - (a.relay ?? 0));
  const top = byRelay[0];
  if (!top) {
    return {
      value: { name: "—", code: "", height: 0, relayOk: false },
      provenance: derivedProvenance(raw.asOf, "涨停池无数据（PG zt_snapshot 空）"),
    };
  }
  return {
    value: {
      name: top.name,
      code: top.code,
      height: top.relay ?? 1,
      relayOk: (raw.sentimentRaw?.premium ?? 0) > 0 && (raw.limit?.broken?.length ?? 0) <= 1,
    },
    provenance: pgProvenance(raw.asOf, up.length, "龙头=涨停池最高连板，接力环境=溢价>0且炸板≤1"),
  };
}

/**
 * 全站唯一认知构建入口（纯函数）
 * @param {object} raw 原始快照（演示=构造对象；真实=buildBrainContext 输出经 rawFromBrainContext 适配）
 * @param {number} version 单调递增版本号
 * @returns {object} MarketCognition { version, hash, generatedAt, session, asOf, mainline, sentiment, capital, risk, leader }
 */
function buildCognition(raw, version) {
  const mainline = buildMainline(raw);
  const sentiment = buildSentiment(raw);
  const capital = buildCapital(raw);
  const risk = buildRisk(raw);
  const leader = buildLeader(raw);
  const payload = JSON.stringify({
    v: version,
    asOf: raw.asOf,
    m: mainline.value,
    s: sentiment.value,
    c: capital.value,
    r: risk.value,
    l: leader.value,
  });
  return {
    version,
    hash: hashString(payload),
    generatedAt: raw.asOf,
    asOf: raw.asOf,
    session: { phase: "盘中", window: "09:30-11:30", decisionWindow: false, note: "认知已锁定，全站消费 v" + version },
    mainline,
    sentiment,
    capital,
    risk,
    leader,
  };
}

/** 一致性校验：前端拿到的认知 hash 必须等于后端 —— 防"双端认知漂移" */
function verifyCognition(c, expectedHash) {
  return !!c && c.hash === expectedHash;
}

// ============================================================
// 适配层：buildBrainContext（PG 聚合）→ 认知层 raw 形状
// 只换数据源，buildCognition 纯函数下游零改动
// ============================================================
function rawFromBrainContext(ctx) {
  const m = ctx.market ?? {};
  const ladder = ctx.limitLadder ?? { total: 0, maxBoard: 0, ladder: [], boards: [], boardCounts: {} };
  const upRows = Array.isArray(ladder.ladder) ? ladder.ladder : [];
  // PG 无涨跌家数/平均涨幅/炸板明细：breadth/limit.broken 空缺，炸板率经 _pg.blastedRate 注入
  return {
    asOf: isoFromSources(ctx.sources?.market, ctx.date),
    indexes: [],
    breadth: { up: 0, down: 0, flat: 0, total: m.ztCount ?? 0 }, // 口径：PG 无全市场涨跌家数，total 用涨停池数占位（caliber 已注明）
    limit: {
      up: upRows.map((r) => ({ code: r.code, name: r.name, pct: 0, reason: r.hybk ?? "", relay: r.lbc ?? 1 })),
      down: [],
      broken: [],
    },
    sentimentRaw: {
      upRatio: null, limitScore: m.ztCount ?? null, avgPct: null, premium: m.premiumAvg ?? null,
    },
    mainlines: (ctx.mainlines?.top ?? []).map((t) => ({
      name: t.theme ?? "",
      strength: t.heat ?? 0,
      fundNet: 0,
      leaders: (t.picks ?? []).slice(0, 3).map((p) => p.name ?? "").filter(Boolean),
      followers: (t.picks ?? []).slice(3, 6).map((p) => p.name ?? "").filter(Boolean),
    })),
    boardFund: (ctx.boardFund?.items ?? []).map((b) => ({
      name: b.board ?? "",
      // v9.115.0（S1-1 单位对齐）：fund_streak.items.mainNet 单位=元（东财 f62），认知层口径=亿（演示/展示统一）
      bigNet: (b.mainNet ?? 0) / 1e8,
      darkLightGap: 0,
      signal: "中性",
    })),
    stocks: {},
    overseas: [],
    news: [],
    // 认知层内部使用（不对外）：PG 落库情绪分/炸板率/日期
    _pg: {
      sentiment: typeof m.sentiment === "number" ? m.sentiment : null,
      blastedRate: m.blastedRate ?? 0,
      date: ctx.date ?? null,
      fallbackDate: ctx.fallbackDate ?? null,
    },
  };
}

/** sources.market 时间戳 → ISO 字符串（日期带横杠）；缺失回退 ctx.date */
function isoFromSources(ts, dateStr) {
  if (typeof ts === "number" && Number.isFinite(ts) && ts > 0) {
    return new Date(ts).toISOString();
  }
  return dateStr ? `${dateStr}T00:00:00.000Z` : new Date().toISOString();
}

// ============================================================
// v9.115.0（S1-2）：认知落库 —— version 序列权威源 = 表 max(version)+1
// （cron 与 /api/cognition 共用同一序列，避免内存/表 version 漂移）
// ============================================================
/** 下一版本号：表内 max(version)+1（表空 → 1）；pool 注入便于单测 */
async function nextVersion(pool) {
  const r = await pool.query("SELECT COALESCE(MAX(version),0) AS v FROM cognition_snapshots");
  return Number(r.rows?.[0]?.v ?? 0) + 1;
}

/** 认知快照落库（INSERT 单行；payload 为完整 MarketCognition JSON，供回放/校验） */
async function persistCognition(pool, cog) {
  const r = await pool.query(
    `INSERT INTO cognition_snapshots(version,hash,as_of,primary_theme,sentiment_stage,capital_signal,risk_level,payload)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [
      cog.version,
      cog.hash,
      cog.asOf,
      cog.mainline?.value?.primaryTheme ?? null,
      cog.sentiment?.value?.stage ?? null,
      cog.capital?.value?.signal ?? null,
      cog.risk?.value?.level ?? null,
      JSON.stringify(cog),
    ],
  );
  return r.rows?.[0]?.id ?? null;
}

/** 读表内最新认知（cron 落库的权威版本）；无行 → null */
async function latestCognition(pool) {
  const r = await pool.query("SELECT payload FROM cognition_snapshots ORDER BY id DESC LIMIT 1");
  if (!r.rows?.length) return null;
  try { return JSON.parse(r.rows[0].payload); } catch { return null; }
}

module.exports = {
  buildCognition, verifyCognition, rawFromBrainContext, hashString, deriveSentimentStage,
  nextVersion, persistCognition, latestCognition,
};
