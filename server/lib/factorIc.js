// ============================================================
// v9.42：因子 IC 服务端评估（与 src/lib/factorLib.ts 同构）
// 幻方"因子会失效"在线监测的权威落库端：
//   cron 15:40 读最近 N 个交易日 kv（market_daily + sentiment）
//   → 滚动窗口 IC 评估 → 落 kv_store:factor_ic:YYYY-MM-DD
// 前端 FactorHealthPanel 读历史 factor_ic:日期 序列画"因子失效曲线"，
// 不再依赖用户打开页面（server 永不缺数据）。
// ============================================================

// ---------- 因子注册表（与前端 factorLib.ts 保持同构，改动需同步） ----------
const FACTORS = [
  { id: "blast_high", name: "炸板率偏高", desc: "炸板率≥35% 情绪分歧", expectedDir: -1, extract: r => (r.blastedRate != null && r.blastedRate >= 35) ? 1 : 0 },
  { id: "blast_low", name: "炸板率偏低", desc: "炸板率<20% 封板健康", expectedDir: 1, extract: r => (r.blastedRate != null && r.blastedRate < 20) ? 1 : 0 },
  { id: "zt_many", name: "涨停家数多", desc: "涨停≥50 普涨", expectedDir: 1, extract: r => (r.ztCount != null ? r.ztCount : null) },
  { id: "height_high", name: "连板高度强", desc: "最高板≥5", expectedDir: 1, extract: r => (r.maxBoardHeight != null ? r.maxBoardHeight : null) },
  { id: "premium_pos", name: "溢价为正", desc: "昨日涨停今日平均溢价>0", expectedDir: 1, extract: r => (r.premiumAvg != null ? r.premiumAvg : null) },
  { id: "promo_healthy", name: "晋级率健康", desc: "首板晋级率≥30%", expectedDir: 1, extract: r => (r.promotionRate != null && r.promotionRate >= 0.3) ? 1 : 0 },
  { id: "senti_extreme", name: "情绪极值", desc: "情绪≥70 或 ≤30", expectedDir: -1, extract: r => (r.sentiment != null && (r.sentiment >= 70 || r.sentiment <= 30)) ? 1 : 0 },
  { id: "seal_decay", name: "封单衰减", desc: "盘中封单衰减预警数", expectedDir: -1, extract: r => (r.sealDecayCount != null ? r.sealDecayCount : null) },
  { id: "lhb_boost", name: "席位加持", desc: "涨停股龙虎榜净买数", expectedDir: 1, extract: r => (r.lhbBoostCount != null ? r.lhbBoostCount : null) },
  { id: "fund_streak", name: "资金连续流入", desc: "主线行业连续净流入天数", expectedDir: 1, extract: r => (r.fundInflowStreak != null ? r.fundInflowStreak : null) },
  { id: "nuclear", name: "核按钮", desc: "高位股秒跌停数", expectedDir: -1, extract: r => (r.nuclearCount != null ? r.nuclearCount : null) },
];

// ---------- Spearman 秩相关（与前端一致） ----------
function spearman(xs, ys) {
  const n = xs.length;
  if (n < 3) return 0;
  const rank = (arr) => {
    const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const ranks = new Array(n);
    for (let i = 0; i < n; i++) ranks[idx[i][1]] = i + 1;
    return ranks;
  };
  const rx = rank(xs), ry = rank(ys);
  const mx = rx.reduce((s, v) => s + v, 0) / n, my = ry.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  if (dx === 0 || dy === 0) return 0;
  return num / Math.sqrt(dx * dy);
}

/** 单窗口因子 IC：pairs=[{x,y}]（x=因子值，y=次日延续 0/1），按 expectedDir 对齐 */
function computeWindowIc(factor, pairs) {
  const n = pairs.length;
  let ic = 0;
  if (n >= 3) {
    const raw = spearman(pairs.map(p => p.x), pairs.map(p => p.y));
    ic = factor.expectedDir * raw;
  }
  ic = Math.round(ic * 1000) / 1000;
  // v9.77（A9-7 修复）：样本不足(n<5) ≠ 因子失效 —— 原 `|| n < 5` 把数据积累期全标"失效"，
  //   导致启动日志"9/11 因子失效"、AI 预注入被误导降置信。只有 n≥5 且 |IC|<0.05 才算真失效。
  const decayed = n >= 5 && Math.abs(ic) < 0.05;
  const reversed = n >= 5 && ic <= -0.05; // v9.42：方向反转（持续负 IC → 需复核/反向使用）
  return { ic, samples: n, decayed, reversed };
}

// ---------- kv_store 读取（value 可能为对象或 {__raw} 字符串） ----------
async function kvRead(pool, key) {
  const r = await pool.query("SELECT value FROM kv_store WHERE key = $1", [key]);
  const v = r.rows[0]?.value;
  if (v && typeof v === "object" && "__raw" in v) return v.__raw;
  return v;
}

/** 北京日期 YYYYMMDD（与 cron.js 同款） */
function bjDate() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

/**
 * 因子健康度评估（盘后落库用）
 * 读最近 days 个自然日的 kv（market_daily + sentiment）→ 组装日行
 * → 每因子取最近 window 个有样本的交易日算滚动 IC → 快照
 * 输出：{ date, window, items:[{id,name,ic,samples,decayed}], decayedCount, total }
 */
async function evaluateFactorIc({ pool, days = 30, window = 10 }) {
  const today = bjDate();
  const todayStr = `${today.slice(0, 4)}-${today.slice(4, 6)}-${today.slice(6, 8)}`;
  const dateKeys = [];
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  for (let i = days - 1; i >= 0; i--) {
    const t = new Date(d); t.setDate(t.getDate() - i);
    const ds = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
    dateKeys.push(ds);
  }

  // 批量拉取当日指标（容错：单日失败跳过）
  const rows = [];
  for (const ds of dateKeys) {
    let sentiment = null;
    let md = null;
    try { sentiment = Number(await kvRead(pool, `sentiment:${ds}`) ?? NaN); if (!Number.isFinite(sentiment)) sentiment = null; } catch { /* skip */ }
    try { md = await kvRead(pool, `market_daily:${ds}`); } catch { /* skip */ }
    if (sentiment == null && !md) continue; // 当日完全无数据 → 跳过
    rows.push({
      date: ds,
      sentiment,
      blastedRate: md?.blastedRate ?? null,
      ztCount: md?.ztCount ?? null,
      maxBoardHeight: md?.maxBoardHeight ?? null,
      premiumAvg: md?.premiumAvg ?? null,
      promotionRate: md?.promotionRate ?? null,
      sealDecayCount: md?.sealDecayCount ?? null,
      lhbBoostCount: md?.lhbBoostCount ?? null,
      fundInflowStreak: md?.fundInflowStreak ?? null,
      nuclearCount: md?.nuclearCount ?? null,
    });
  }
  rows.sort((a, b) => a.date < b.date ? -1 : 1);

  // 次日主线延续标签（v9.59-fix V8-1：与前端 markNextWin 一致 —— 次日涨停数 ≥ 今日 80% = 延续；
  //   弃情绪代理：主线退潮但大盘情绪涨会误判延续）
  const marked = rows.map((r, i) => {
    const next = rows[i + 1];
    const win = (r.ztCount != null && next?.ztCount != null)
      ? (next.ztCount >= r.ztCount * 0.8 ? 1 : 0)
      : null;
    return { ...r, nextMainlineWin: win };
  });

  // 每因子：取最近 window 个含有效样本的日 → 算滚动 IC
  const items = FACTORS.map(f => {
    // v9.59-fix（V8-2）：数据源缺失（extract 全 null，如 sealDecay 无真实预警源）→ missing，不判失效
    const hasData = marked.some(r => f.extract(r) != null);
    if (!hasData) {
      return { id: f.id, name: f.name, ic: 0, samples: 0, decayed: false, reversed: false, missing: true };
    }
    const pairs = [];
    for (let i = marked.length - 1; i >= 0 && pairs.length < window; i--) {
      const r = marked[i];
      if (r.nextMainlineWin == null) continue;
      const x = f.extract(r);
      if (x == null) continue;
      pairs.push({ x, y: r.nextMainlineWin });
    }
    pairs.reverse();
    const { ic, samples, decayed, reversed } = computeWindowIc(f, pairs);
    return { id: f.id, name: f.name, ic, samples, decayed, reversed: reversed ?? false };
  });

  return {
    date: todayStr,
    window,
    items,
    decayedCount: items.filter(i => i.decayed).length,
    total: items.length,
  };
}

/** 落库 kv_store:factor_ic:日期（幂等 upsert） */
async function saveFactorIc(pool) {
  const snap = await evaluateFactorIc({ pool });
  await pool.query(
    `INSERT INTO kv_store(key,value,updated_at) VALUES($1,$2,now())
     ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=now()`,
    [`factor_ic:${snap.date}`, JSON.stringify(snap)],
  );
  console.log(`[cron] factor_ic ${snap.date}: ${snap.decayedCount}/${snap.total} 因子失效`);
  return snap;
}

module.exports = { FACTORS, evaluateFactorIc, saveFactorIc, computeWindowIc };
