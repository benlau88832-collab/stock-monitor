// ============================================================
// server/lib/cognition.js —— 单一 AI 认知层（v9.115.0，S1-1）
// 架构定位：全站唯一的"市场理解"对象。作战卡/决策卡/精灵/复盘/问答/盯价
//   均消费同一份 MarketCognition，而非各自取数各自判（终审 D-01 之上延伸）。
// 设计原则：① 不可变快照；② 每字段带溯源(Provenance: source/asOf/stale/
//   confidence/sampleSize/caliber)；③ 单调版本号 + 内容哈希保证一致性。
// 纯函数：无 I/O、无 LLM、秒级、可回测 —— 输入相同输出相同（双端同构 golden）。
// v9.128.0（一致性审查 P1-9）：原"源=参考实现 src/lib/cognition/builder.ts"指向不存在文件——
//   认知层为服务端单源（前端消费 /api/cognition），无 TS 参考实现。
//   raw 数据源 = server/lib/brainContext.js 的
//   buildBrainContext() PG 聚合输出（只换数据源，下游零改动）。
// 口径说明：情绪温度计复用真实口径 upRatio*40+limitScore*1.3+avgPct*0.8+20；
//   PG 无涨跌家数/平均涨幅 → 真实场景以 PG 落库 sentiment 为准（适配层注入 _pg.sentiment）
// ============================================================
const { BLAST_DIVERGE_PCT, BLAST_RISK_PCT } = require("./thresholds"); // v9.135.0（阈值收口）

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
  if (premium < 0) return brokenRate > BLAST_DIVERGE_PCT / 100 ? "分歧" : "退潮";
  if (score > 82 && premium > 3) return brokenRate > BLAST_DIVERGE_PCT / 100 ? "分歧" : "高潮";
  if (score > 65) return "发酵";
  return "启动";
}

function buildMainline(raw) {
  // v9.130.0（终审 N1）：与 brainContext mainlines.top 同排序键（heat 降序）+ name tie-breaker 保证确定性
  //   —— 同一 theme_analysis 输入下，认知层 primaryTheme 必须与大脑快照 top1 完全一致
  const sorted = [...(raw.mainlines ?? [])].sort((a, b) => (b.strength ?? 0) - (a.strength ?? 0) || String(a.name ?? "").localeCompare(String(b.name ?? "")));
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
    ? Math.max(0, Math.min(100, Math.round(raw._pg.sentiment))) // v9.128.0（一致性审查 P0-1 连带）：clamp 0-100——
      // 实测前端上传的 sentiment:键 曾注入 140 分（前端公式与认知层公式不同源的交叉污染实锤）
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
  // v9.123.0（卓越审查 P0-3）：明暗盘明细缺失时按净额方向诚实输出"流入/流出"——
  //   此前 gap 恒 0 → signal 恒"中性" → 资金维共振/主力资金规则在生产永久哑火
  const hasGap = funds.some((b) => b.darkLightGap != null);
  const signal = !hasGap
    ? (net > 0 ? "流入" : net < 0 ? "流出" : "数据不足")
    : (gap > 10 && net > 0 ? "吸筹" : gap > 0 && net > 0 ? "洗盘" : gap < 0 && net < 0 ? "出货" : "中性");
  return {
    value: { netFlow: Math.round(net * 10) / 10, darkVsLight: Math.round(gap * 10) / 10, signal },
    provenance: pgProvenance(raw.asOf, funds.length, "明暗盘：暗盘=超大+大单 明盘=中+小单，方向相反绝对值大→洗/出；明细缺失→按净额方向流入/流出", 0.85),
  };
}

function buildRisk(raw) {
  const traps = [];
  const brokenRate = raw._pg?.blastedRate != null
    ? raw._pg.blastedRate / 100
    : (raw.limit?.broken?.length ?? 0) / Math.max(1, (raw.limit?.up?.length ?? 0) + (raw.limit?.broken?.length ?? 0));
  if (brokenRate > BLAST_RISK_PCT / 100) traps.push("炸板率偏高");
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
      // v9.123.0（卓越审查 P1-4）：溢价数据缺失标记——premium=null 时 relayOk 恒 false，
      //   下游规则须区分"数据缺失"与"接力转弱"（盘前溢价未就绪不应误报断板告警）
      relayData: (raw.sentimentRaw?.premium ?? null) == null ? "missing" : "ok",
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
function buildCognition(raw, version, session) {
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
    // v9.123.0（卓越审查 P1-1）：session 由调用方注入（proactiveSession.currentSession 真实时段）——
    //   缺省保持"盘中"仅作纯函数兼容（生产调用点必须注入，此前硬编码导致盘前/盘后认知时段错标）
    session: session ?? { phase: "盘中", window: "09:30-11:30", decisionWindow: false, note: "认知已锁定，全站消费 v" + version },
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
    boardFund: (ctx.boardFund?.items ?? []).map((b) => {
      // v9.115.0（S1-1 单位对齐）：fund_streak.items.mainNet 单位=元（东财 f62），认知层口径=亿（演示/展示统一）
      // v9.123.0（卓越审查 P0-3）：明暗盘真实计算——暗盘=超大+大单，明盘=中+小单；
      //   明细字段缺失 → darkLightGap=null（buildCapital 诚实降级为"流入/流出"，此前硬编码 0 → 恒"中性"）
      const hasGap = [b.superBig, b.big, b.mid, b.small].every((v) => v != null);
      return {
        name: b.board ?? "",
        bigNet: (b.mainNet ?? 0) / 1e8,
        darkLightGap: hasGap ? ((b.superBig ?? 0) + (b.big ?? 0) - (b.mid ?? 0) - (b.small ?? 0)) / 1e8 : null,
        signal: "中性",
      };
    }),
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

/** v9.120.0（卓越 S1-1b）：读上一版认知（id 倒数第 2 行，computeDelta 环比用）；无历史 → null */
async function prevCognition(pool) {
  const r = await pool.query("SELECT payload FROM cognition_snapshots ORDER BY id DESC LIMIT 2 OFFSET 1");
  if (!r.rows?.length) return null;
  try { return JSON.parse(r.rows[0].payload); } catch { return null; }
}

/**
 * v9.128.0（一致性审查 P0-3）：新鲜认知读取 —— 全站认知消费点统一入口。
 * 盘中时段（竞价/早盘/盘中/午后/尾盘）表内行 asOf 陈旧 >staleMs（cron 认知链与盘中精灵
 *   共享 LOCK_INTRADAY 被持续 skip，实测陈旧 11.5h）→ 即时重建并落库；非盘中/新鲜 → 返回表行。
 * 重建节流：asOf 是"数据时间"（盘后数据恒昨日），不能作重建判据 → 模块级 5min 节流
 *   （否则每次请求都重建、version 无限膨胀）。
 */
let _lastRebuildAt = 0;
async function getFreshCognition(pool, staleMs = 30 * 60 * 1000) {
  const latest = await latestCognition(pool);
  const asOfMs = latest?.asOf ? new Date(latest.asOf).getTime() : 0;
  const { currentSession } = require("./proactiveSession"); // 惰性 require，保持模块纯函数性
  const inSession = ["竞价", "早盘", "盘中", "午后", "尾盘"].includes(currentSession().phase);
  const fresh = Number.isFinite(asOfMs) && Date.now() - asOfMs <= staleMs;
  if (latest && (!inSession || fresh)) return latest;
  if (Date.now() - _lastRebuildAt < 5 * 60 * 1000) return latest; // 5min 节流：数据时间旧≠行旧
  _lastRebuildAt = Date.now();
  const { buildBrainContext } = require("./brainContext");
  const ctx = await buildBrainContext(pool);
  const cog = buildCognition(rawFromBrainContext(ctx), await nextVersion(pool), currentSession());
  await persistCognition(pool, cog).catch(() => {});
  return cog;
}

module.exports = {
  buildCognition, verifyCognition, rawFromBrainContext, hashString, deriveSentimentStage,
  nextVersion, persistCognition, latestCognition, prevCognition, getFreshCognition,
};
