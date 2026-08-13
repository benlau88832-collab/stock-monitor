// ============================================================
// v9.138.0（波段重构·阶段一）：波段位置模型 —— 平台突破/放量首板后低吸打法
// 定位：把"个股/板块处于主升哪个阶段"变成可判定的纯函数。
//   游资波段视角（持股 3 天-1 个月）：底部整理 → 启动（平台突破/放量首板）→
//   主升（沿 MA10 上行）→ 加速（偏离 MA20 过大/滞涨）→ 退潮（破 MA20/量价背离）
// 数据输入：日K OHLCV 序列（升序，至少 60 根）—— 与 server/lib/indicators.js 同源（腾讯/push2his）
// 纯函数：无 I/O、无 DOM，可单测；UI 层负责拉数据装配
// ============================================================

export interface KlineBar {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
}

export type SwingPhase = "底部整理" | "启动" | "主升" | "加速" | "退潮" | "数据不足";

export interface SwingStageResult {
  phase: SwingPhase;
  /** 阶段置信 0-100 */
  confidence: number;
  /** 买点类型（启动阶段给出）：平台突破 / 首板次日低吸 / 主升回踩 / 无买点 */
  buyPoint: string | null;
  /** 平台区间（启动判定用）：[低, 高]，无平台则 null */
  platform?: [number, number] | null;
  /** 平台整理天数 */
  platformDays?: number;
  /** 关键均线 */
  ma5: number | null;
  ma10: number | null;
  ma20: number | null;
  ma60: number | null;
  /** 现价相对 MA20 偏离%（加速判定） */
  biasMa20: number | null;
  /** 信号明细（UI 展示"为什么判这个阶段"） */
  signals: string[];
}

// ---------- 工具 ----------
function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) sum += values[i];
  return sum / period;
}

function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v));
}

/** 近 N 根的最高/最低（不含最后一根，用于平台/突破判定） */
function recentRange(bars: KlineBar[], n: number, excludeLast = true): { high: number; low: number } {
  const slice = excludeLast ? bars.slice(-(n + 1), -1) : bars.slice(-n);
  let high = -Infinity, low = Infinity;
  for (const b of slice) {
    if (b.high > high) high = b.high;
    if (b.low < low) low = b.low;
  }
  return { high, low };
}

/** 近 N 根平均成交量（不含最后一根） */
function avgVolume(bars: KlineBar[], n: number, excludeLast = true): number {
  const slice = excludeLast ? bars.slice(-(n + 1), -1) : bars.slice(-n);
  if (slice.length === 0) return 0;
  return slice.reduce((s, b) => s + b.volume, 0) / slice.length;
}

// ---------- 平台识别（横盘整理） ----------
// 平台 = 近 N 日（默认 20）振幅收敛（(高-低)/低 < 阈值 12%）且未大涨大跌
export function detectPlatform(bars: KlineBar[], window = 20, maxAmp = 0.12): { platform: [number, number]; days: number } | null {
  if (bars.length < window + 1) return null;
  const r = recentRange(bars, window);
  const base = r.low > 0 ? r.low : 1;
  const amp = (r.high - r.low) / base;
  if (amp > maxAmp) return null;
  // 平台期不能整体单边大跌（收盘从高点到低点跌幅有限）
  const first = bars[bars.length - window - 1];
  const last = bars[bars.length - 2];
  const drift = (last.close - first.close) / (first.close > 0 ? first.close : 1);
  if (drift < -0.1) return null; // 平台期跌超 10% 不算整理
  return { platform: [r.low, r.high], days: window };
}

// ---------- 突破检测（放量突破平台高点） ----------
export function detectBreakout(bars: KlineBar[], platform: [number, number], volRatioThreshold = 1.8): { broken: boolean; volRatio: number } {
  if (bars.length < 2) return { broken: false, volRatio: 0 };
  const last = bars[bars.length - 1];
  const prevAvg = avgVolume(bars, 10);
  const volRatio = prevAvg > 0 ? last.volume / prevAvg : 0;
  const broken = last.close > platform[1] && last.volume > 0 && volRatio >= volRatioThreshold;
  return { broken, volRatio };
}

// ---------- 放量首板判定（涨停/接近涨停 + 放量，昨日非涨停） ----------
export function detectFirstLimitUp(bars: KlineBar[], limitPct = 9.5): { isFirst: boolean; pct: number } {
  if (bars.length < 2) return { isFirst: false, pct: 0 };
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  if (prev.close <= 0) return { isFirst: false, pct: 0 };
  const pct = (last.close - prev.close) / prev.close * 100;
  const prevPct = prev.close > 0 && bars.length >= 3 ? (prev.close - bars[bars.length - 3].close) / bars[bars.length - 3].close * 100 : 0;
  const isFirst = pct >= limitPct && prevPct < limitPct - 0.5; // 今日涨停/近涨停，昨日未涨停
  return { isFirst, pct };
}

// ---------- 首板次日低吸买点（昨日放量首板，今日回踩不破 5/10 日线） ----------
export function detectFirstBoardDipBuy(bars: KlineBar[], limitPct = 9.5): { hit: boolean; note: string } {
  if (bars.length < 12) return { hit: false, note: "数据不足" };
  const yesterday = bars[bars.length - 2];
  const prev = bars[bars.length - 3];
  if (!prev || prev.close <= 0) return { hit: false, note: "数据不足" };
  const yPct = (yesterday.close - prev.close) / prev.close * 100;
  const isYFirstBoard = yPct >= limitPct && bars.length >= 4
    ? (prev.close - bars[bars.length - 4].close) / bars[bars.length - 4].close * 100 < limitPct - 0.5
    : true;
  if (!isYFirstBoard) return { hit: false, note: "昨日非首板" };
  const today = bars[bars.length - 1];
  const ma5 = sma(bars.map(b => b.close), 5);
  const ma10 = sma(bars.map(b => b.close), 10);
  const dipLine = Math.max(ma5 ?? 0, ma10 ?? 0);
  // 今日回踩：收盘不破 5/10 日线（或最低点触及后收回），且未再涨停（避免追板）
  const todayPct = (today.close - yesterday.close) / yesterday.close * 100;
  const holdLine = today.low <= dipLine && today.close >= dipLine * 0.985;
  const notChasing = todayPct < limitPct - 0.5;
  return { hit: holdLine && notChasing, note: holdLine && notChasing ? `首板次日回踩${dipLine.toFixed(2)}（MA5/10）企稳` : "回踩未到位或已再封板" };
}

// ---------- 主升/加速/退潮判定 ----------
export function classifySwingPhase(bars: KlineBar[]): SwingStageResult {
  if (!bars || bars.length < 30) {
    return { phase: "数据不足", confidence: 0, buyPoint: null, ma5: null, ma10: null, ma20: null, ma60: null, biasMa20: null, signals: ["K线不足 30 根"] };
  }
  const closes = bars.map(b => b.close);
  const ma5 = sma(closes, 5);
  const ma10 = sma(closes, 10);
  const ma20 = sma(closes, 20);
  const ma60 = sma(closes, 60);
  const last = bars[bars.length - 1];
  const price = last.close;
  const biasMa20 = ma20 && ma20 > 0 ? (price - ma20) / ma20 * 100 : null;
  const signals: string[] = [];

  // 启动检测：平台突破 或 放量首板
  const platform = detectPlatform(bars);
  let buyPoint: string | null = null;
  if (platform) {
    const { broken, volRatio } = detectBreakout(bars, platform.platform);
    signals.push(`平台整理${platform.days}日（${platform.platform[0].toFixed(2)}-${platform.platform[1].toFixed(2)}）`);
    if (broken) {
      signals.push(`放量突破平台高点（量比${volRatio.toFixed(1)}）`);
      buyPoint = "平台突破";
    }
  }
  const { isFirst, pct } = detectFirstLimitUp(bars);
  if (isFirst) {
    signals.push(`放量首板（+${pct.toFixed(1)}%）`);
    if (!buyPoint) buyPoint = "放量首板";
  }
  const dip = detectFirstBoardDipBuy(bars);
  if (dip.hit) {
    signals.push(dip.note);
    buyPoint = "首板次日低吸";
  }

  // 阶段判定（优先级：退潮 > 加速 > 主升 > 启动 > 底部整理）
  // 退潮：跌破 MA20 且 MA5 < MA20（短期趋势破坏）
  if (ma5 != null && ma20 != null && price < ma20 && ma5 < ma20) {
    signals.push(`跌破MA20(${ma20.toFixed(2)})且MA5<MA20`);
    return { phase: "退潮", confidence: clamp(75 + (biasMa20 != null ? Math.abs(biasMa20) * 2 : 0)), buyPoint: null, platform: platform?.platform ?? null, platformDays: platform?.days, ma5, ma10, ma20, ma60, biasMa20, signals };
  }
  // 加速：价格远离 MA20（>18%）且 MA5 陡峭上行 → 警惕滞涨（波段客此时不追，考虑减）
  if (biasMa20 != null && biasMa20 > 18) {
    signals.push(`偏离MA20达${biasMa20.toFixed(0)}%（加速赶顶风险）`);
    return { phase: "加速", confidence: 70, buyPoint: null, platform: platform?.platform ?? null, platformDays: platform?.days, ma5, ma10, ma20, ma60, biasMa20, signals };
  }
  // 主升：MA5 > MA10 > MA20 多头排列且价格在 MA20 上方 —— 优先于启动判定
  // （持续上涨途中也会出现单日大阳，若已多头排列则属主升中的加速段而非新启动）
  if (ma5 != null && ma10 != null && ma20 != null && ma5 > ma10 && ma10 > ma20 && price > ma20) {
    signals.push(`多头排列（MA5>MA10>MA20）`);
    const dipBuy = price >= (ma10 ?? 0) * 0.99 && price <= (ma10 ?? 0) * 1.03;
    if (dipBuy) {
      signals.push("回踩 MA10 企稳（主升回踩买点）");
      buyPoint = "主升回踩";
    }
    return { phase: "主升", confidence: 75, buyPoint, platform: platform?.platform ?? null, platformDays: platform?.days, ma5, ma10, ma20, ma60, biasMa20, signals };
  }
  // 启动：平台突破/放量首板/首板低吸买点成立（仅在未形成多头排列时——刚启动的第一波）
  if (buyPoint) {
    return { phase: "启动", confidence: 80, buyPoint, platform: platform?.platform ?? null, platformDays: platform?.days, ma5, ma10, ma20, ma60, biasMa20, signals };
  }
  // 底部整理：价格在 MA20 附近横盘
  signals.push("横盘整理，等待启动信号（平台突破/放量首板）");
  return { phase: "底部整理", confidence: 55, buyPoint: null, platform: platform?.platform ?? null, platformDays: platform?.days, ma5, ma10, ma20, ma60, biasMa20, signals };
}

// ---------- 便捷：给定日K数组直接出结果（UI 装配用） ----------
export function analyzeSwing(bars: KlineBar[]): SwingStageResult {
  return classifySwingPhase(bars);
}
