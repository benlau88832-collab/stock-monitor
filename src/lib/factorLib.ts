// ============================================================
// v9.38（V3-8/9）：因子注册表 + IC 评估 + 衰减监测
// 幻方核心：因子库每周迭代 + 因子会失效（需在线监测 IC 衰减并降权）
// 落地：
//   - 注册 10+ 标准因子（封单衰减/梯队断档/晋级率/溢价/连板高度/席位加持/资金连续性/核按钮/炸板率/情绪极值）
//   - 每个因子对"次日主线延续"计算 IC（信息系数，Spearman 近似）
//   - 滚动 20 日 IC：|IC| 滑落 < 0.05 → 标"⚠ 因子疑似失效"并自动降权
// ============================================================

export interface FactorDef {
  id: string;
  name: string;
  /** 因子含义/触发条件说明 */
  desc: string;
  /** 期望方向：+1 = 因子值越大次日越可能延续；-1 = 越小越好 */
  expectedDir: 1 | -1;
  /** 从日行情行提取因子值（无数据返回 null） */
  extract: (row: FactorDayRow) => number | null;
}

export interface FactorDayRow {
  date: string;
  /** 次日主线是否延续（1=延续，0=未延续，null=未知） */
  nextMainlineWin: number | null;
  // 因子输入字段
  blastedRate?: number | null;      // 炸板率 %
  ztCount?: number | null;          // 涨停数
  maxBoardHeight?: number | null;   // 最高板
  premiumAvg?: number | null;       // 溢价均值
  promotionRate?: number | null;    // 晋级率 0~1
  sentiment?: number | null;        // 情绪分
  sealDecayCount?: number | null;   // 封单衰减预警数
  lhbBoostCount?: number | null;    // 龙虎榜加持涨停数
  fundInflowStreak?: number | null; // 主线行业连续流入天数
  nuclearCount?: number | null;     // 核按钮数
  /** v9.57（V8-1）：次日涨停数/最高板（loadFactorRows 从次日 market_daily 读取，供"主线延续"标签） */
  nextZtCount?: number | null;
  nextHeight?: number | null;
}

/** 因子库（注册表） */
export const FACTORS: FactorDef[] = [
  { id: "blast_high", name: "炸板率偏高", desc: "炸板率≥35% 情绪分歧", expectedDir: -1, extract: r => r.blastedRate != null && r.blastedRate >= 35 ? 1 : 0 },
  { id: "blast_low", name: "炸板率偏低", desc: "炸板率<20% 封板健康", expectedDir: 1, extract: r => r.blastedRate != null && r.blastedRate < 20 ? 1 : 0 },
  { id: "zt_many", name: "涨停家数多", desc: "涨停≥50 普涨", expectedDir: 1, extract: r => r.ztCount != null ? r.ztCount : null },
  { id: "height_high", name: "连板高度强", desc: "最高板≥5", expectedDir: 1, extract: r => r.maxBoardHeight != null ? r.maxBoardHeight : null },
  { id: "premium_pos", name: "溢价为正", desc: "昨日涨停今日平均溢价>0", expectedDir: 1, extract: r => r.premiumAvg != null ? r.premiumAvg : null },
  { id: "promo_healthy", name: "晋级率健康", desc: "首板晋级率≥30%", expectedDir: 1, extract: r => r.promotionRate != null && r.promotionRate >= 0.3 ? 1 : 0 },
  { id: "senti_extreme", name: "情绪极值", desc: "情绪≥70 或 ≤30", expectedDir: -1, extract: r => r.sentiment != null && (r.sentiment >= 70 || r.sentiment <= 30) ? 1 : 0 },
  { id: "seal_decay", name: "封单衰减", desc: "盘中封单衰减预警数", expectedDir: -1, extract: r => r.sealDecayCount != null ? r.sealDecayCount : null },
  { id: "lhb_boost", name: "席位加持", desc: "涨停股龙虎榜净买数", expectedDir: 1, extract: r => r.lhbBoostCount != null ? r.lhbBoostCount : null },
  { id: "fund_streak", name: "资金连续流入", desc: "主线行业连续净流入天数", expectedDir: 1, extract: r => r.fundInflowStreak != null ? r.fundInflowStreak : null },
  { id: "nuclear", name: "核按钮", desc: "高位股秒跌停数", expectedDir: -1, extract: r => r.nuclearCount != null ? r.nuclearCount : null },
];

export interface FactorIC {
  factorId: string;
  factorName: string;
  expectedDir: 1 | -1;
  /** 样本数 */
  samples: number;
  /** IC（秩相关，-1~1；正=与期望方向一致） */
  ic: number;
  /** 滚动20日 |IC| 均值 */
  ic20d: number | null;
  /** 是否疑似失效（|IC20d| < 0.05 或样本<5） */
  decayed: boolean;
  /** 权重（未失效 1.0 / 失效 0.3） */
  weight: number;
}

/** 秩相关（Spearman 简化）：同秩后 Pearson */
function spearman(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  const rank = (arr: number[]): number[] => {
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

/** 计算单个因子 IC（按 expectedDir 对齐方向） */
export function computeFactorIC(factor: FactorDef, rows: FactorDayRow[]): FactorIC {
  const pairs = rows
    .filter(r => r.nextMainlineWin != null)
    .map(r => ({ x: factor.extract(r), y: r.nextMainlineWin! }))
    .filter(p => p.x != null) as Array<{ x: number; y: number }>;
  const n = pairs.length;
  let ic = 0;
  if (n >= 3) {
    const raw = spearman(pairs.map(p => p.x), pairs.map(p => p.y));
    ic = factor.expectedDir * raw; // 对齐方向：期望方向的 IC 为正
  }
  // 滚动 IC（历史由调用方传入最近 N 日；此处用单批样本近似 ic20d）
  const ic20d = n >= 5 ? ic : null;
  const decayed = (ic20d != null && Math.abs(ic20d) < 0.05) || n < 5;
  return {
    factorId: factor.id,
    factorName: factor.name,
    expectedDir: factor.expectedDir,
    samples: n,
    ic: Math.round(ic * 1000) / 1000,
    ic20d: ic20d != null ? Math.round(ic20d * 1000) / 1000 : null,
    decayed,
    weight: decayed ? 0.3 : 1.0,
  };
}

/** 全因子 IC 评估（供盘后落库/前端展示） */
export function evaluateAllFactors(rows: FactorDayRow[]): FactorIC[] {
  return FACTORS.map(f => computeFactorIC(f, rows));
}

/** 判定"次日主线延续"（简版：次日情绪分 ≥ 今日 → 延续）。由调用方填 row.nextMainlineWin */
export function markNextWin(rows: Array<Omit<FactorDayRow, "nextMainlineWin">>): FactorDayRow[] {
  // v9.57（V8-1）：标签改"主线次日是否真延续"—— 用涨停数维持判定（次日 ≥ 今日 80% = 延续），
  //   弃用"次日情绪 ≥ 今日情绪"代理（主线退潮但大盘情绪涨 → 旧标签误判延续）
  const out: FactorDayRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const cur = rows[i];
    const next = rows[i + 1];
    const win = (cur.ztCount != null && next?.ztCount != null)
      ? (next.ztCount >= cur.ztCount * 0.8 ? 1 : 0) // 次日涨停数未萎缩>20% = 主线延续
      : null;
    out.push({ ...cur, nextMainlineWin: win });
  }
  return out;
}

// ============================================================
// v9.42：滚动窗口 IC 序列 —— "因子失效曲线"数据源
// 幻方"哪些因子在失效"：对每个因子按滑动窗口逐日计算 IC，
// 输出随日期变化的序列（前端 FactorHealthPanel 画曲线 + 失效标注）。
// 与 server/lib/factorIc.js 同构（改动需同步）。
// ============================================================

export interface FactorIcPoint {
  /** 窗口结束日（取该行日期） */
  date: string;
  /** 滚动窗口 IC（已按 expectedDir 对齐，正=与期望方向一致） */
  ic: number;
  /** 窗口内有效样本数 */
  samples: number;
  /** 疑似失效（样本<5 或 |IC|<0.05） */
  decayed: boolean;
  /** v9.42：方向反转（样本≥5 且 IC≤-0.05）—— 因子有预测力但方向反了，需人工复核/反向使用 */
  reversed?: boolean;
}

/** 取截至 rowIndex（含）的最近 window 个有有效样本的日，返回 [x,y] 对（时间升序） */
function windowPairs(factor: FactorDef, rows: FactorDayRow[], rowIndex: number, window: number): Array<{ x: number; y: number }> {
  const pairs: Array<{ x: number; y: number }> = [];
  for (let j = rowIndex; j >= 0 && pairs.length < window; j--) {
    const r = rows[j];
    if (r.nextMainlineWin == null) continue;
    const x = factor.extract(r);
    if (x == null) continue;
    pairs.push({ x, y: r.nextMainlineWin });
  }
  return pairs.reverse();
}

/**
 * 滚动 IC 序列：rows 需按日期升序（且已 markNextWin）。
 * 从有 ≥3 个有效样本的日期开始，每天输出该因子最近 window 个交易日的滚动 IC。
 * 供"因子失效曲线"展示：|IC| 持续低于 0.05 → 因子正在失效。
 */
export function computeFactorIcSeries(factor: FactorDef, rows: FactorDayRow[], window = 10): FactorIcPoint[] {
  const out: FactorIcPoint[] = [];
  for (let i = 0; i < rows.length; i++) {
    const pairs = windowPairs(factor, rows, i, window);
    const n = pairs.length;
    if (n < 3) continue; // 样本不足不出点
    let ic = 0;
    if (n >= 3) {
      const raw = spearman(pairs.map(p => p.x), pairs.map(p => p.y));
      ic = factor.expectedDir * raw;
    }
    const decayed = (n >= 5 && Math.abs(ic) < 0.05) || n < 5;
    const reversed = n >= 5 && ic <= -0.05; // v9.42：方向反转（持续负 IC）
    out.push({ date: rows[i].date, ic: Math.round(ic * 1000) / 1000, samples: n, decayed, reversed });
  }
  return out;
}

/** 全因子滚动 IC 序列（面板一次拿全） */
export function evaluateFactorIcSeries(rows: FactorDayRow[], window = 10): Record<string, FactorIcPoint[]> {
  const out: Record<string, FactorIcPoint[]> = {};
  for (const f of FACTORS) out[f.id] = computeFactorIcSeries(f, rows, window);
  return out;
}

// ============================================================
// v9.44（③）：因子自动处置 —— 方向反转自动反向 + 长期失效自动退役
// 幻方"因子会过期"终极闭环：检测到后自动执行（连续反转≥3日→自动反向使用；
// 连续真失效≥5日→退役，不再参与决策），无需人工介入。
// ============================================================

export interface FactorAutoState {
  factorId: string;
  name: string;
  /** 连续 reversed ≥ flipDays → 已自动反向（expectedDir 取反使用，IC 按新方向显示） */
  flipped: boolean;
  /** 连续真失效（decayed 且样本≥5）≥ retireDays → 已退役（权重 0，不再参与决策） */
  retired: boolean;
  /** 有效方向（flipped 后取反） */
  effDir: 1 | -1;
  /** 按有效方向对齐的当前 IC（flipped 时取反；无样本为 null） */
  effIc: number | null;
  /** 从最新日往前连续反向的天数（遇到非反转即停） */
  revStreak: number;
  /** 从最新日往前连续真失效的天数（decayed 且 samples≥5，样本不足不累计） */
  decayStreak: number;
}

/** 从序列末尾统计连续满足条件的点数（遇到不满足即停） */
export function consecutiveFromEnd(pts: FactorIcPoint[], pred: (p: FactorIcPoint) => boolean): number {
  let n = 0;
  for (let i = pts.length - 1; i >= 0; i--) {
    if (pred(pts[i])) n++;
    else break;
  }
  return n;
}

/** 全因子自动处置判定（面板/Agent/快照共用）。pts 需含完整历史序列。 */
export function resolveAutoStates(
  seriesMap: Record<string, FactorIcPoint[]>,
  opts?: { flipDays?: number; retireDays?: number },
): FactorAutoState[] {
  const flipDays = opts?.flipDays ?? 3;
  const retireDays = opts?.retireDays ?? 5;
  return FACTORS.map(f => {
    const pts = seriesMap[f.id] ?? [];
    const revStreak = consecutiveFromEnd(pts, p => Boolean(p.reversed) && !p.decayed);
    // 退役只认"真失效"（样本≥5 且 |IC|<0.05）；样本不足（新因子积累期）不累计，避免误退役
    const decayStreak = consecutiveFromEnd(pts, p => p.decayed && p.samples >= 5);
    const retired = pts.length > 0 && decayStreak >= retireDays;
    const flipped = !retired && revStreak >= flipDays;
    const cur = pts[pts.length - 1];
    const effDir: 1 | -1 = flipped ? (f.expectedDir === 1 ? -1 : 1) : f.expectedDir;
    const effIc = cur ? (flipped ? Math.round(-cur.ic * 1000) / 1000 : cur.ic) : null;
    return { factorId: f.id, name: f.name, flipped, retired, effDir, effIc, revStreak, decayStreak };
  });
}
