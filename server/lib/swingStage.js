// ============================================================
// v9.142.0 swing stage model (server CJS port of src/lib/swingStage.ts)
// Pure functions used by the server direction engine.
// ============================================================

function sma(values, period) {
  if (values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) sum += values[i];
  return sum / period;
}

function clamp(v, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, v));
}

function recentRange(bars, n, excludeLast = true) {
  const slice = excludeLast ? bars.slice(-(n + 1), -1) : bars.slice(-n);
  let high = -Infinity, low = Infinity;
  for (const b of slice) {
    if (b.high > high) high = b.high;
    if (b.low < low) low = b.low;
  }
  return { high, low };
}

function avgVolume(bars, n, excludeLast = true) {
  const slice = excludeLast ? bars.slice(-(n + 1), -1) : bars.slice(-n);
  if (slice.length === 0) return 0;
  return slice.reduce((s, b) => s + b.volume, 0) / slice.length;
}

function detectPlatform(bars, window = 20, maxAmp = 0.12) {
  if (bars.length < window + 1) return null;
  const r = recentRange(bars, window);
  const base = r.low > 0 ? r.low : 1;
  const amp = (r.high - r.low) / base;
  if (amp > maxAmp) return null;
  const first = bars[bars.length - window - 1];
  const last = bars[bars.length - 2];
  const drift = (last.close - first.close) / (first.close > 0 ? first.close : 1);
  if (drift < -0.1) return null;
  return { platform: [r.low, r.high], days: window };
}

function detectBreakout(bars, platform, volRatioThreshold = 1.8) {
  if (bars.length < 2) return { broken: false, volRatio: 0 };
  const last = bars[bars.length - 1];
  const prevAvg = avgVolume(bars, 10);
  const volRatio = prevAvg > 0 ? last.volume / prevAvg : 0;
  const broken = last.close > platform[1] && last.volume > 0 && volRatio >= volRatioThreshold;
  return { broken, volRatio };
}

function detectFirstLimitUp(bars, limitPct = 9.5) {
  if (bars.length < 2) return { isFirst: false, pct: 0 };
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  if (prev.close <= 0) return { isFirst: false, pct: 0 };
  const pct = (last.close - prev.close) / prev.close * 100;
  const prevPct = prev.close > 0 && bars.length >= 3 ? (prev.close - bars[bars.length - 3].close) / bars[bars.length - 3].close * 100 : 0;
  return { isFirst: pct >= limitPct && prevPct < limitPct - 0.5, pct };
}

function detectFirstBoardDipBuy(bars, limitPct = 9.5) {
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
  const ma5 = sma(bars.map((b) => b.close), 5);
  const ma10 = sma(bars.map((b) => b.close), 10);
  const dipLine = Math.max(ma5 ?? 0, ma10 ?? 0);
  const todayPct = (today.close - yesterday.close) / yesterday.close * 100;
  const holdLine = today.low <= dipLine && today.close >= dipLine * 0.985;
  const notChasing = todayPct < limitPct - 0.5;
  return { hit: holdLine && notChasing, note: holdLine && notChasing ? `首板次日回踩${dipLine.toFixed(2)}（MA5/10）企稳` : "回踩未到位或已再封板" };
}

function classifySwingPhase(bars) {
  if (!bars || bars.length < 30) {
    return { phase: "数据不足", confidence: 0, buyPoint: null, ma5: null, ma10: null, ma20: null, ma60: null, biasMa20: null, signals: ["K线不足30根"] };
  }
  const closes = bars.map((b) => b.close);
  const ma5 = sma(closes, 5);
  const ma10 = sma(closes, 10);
  const ma20 = sma(closes, 20);
  const ma60 = sma(closes, 60);
  const last = bars[bars.length - 1];
  const price = last.close;
  const biasMa20 = ma20 && ma20 > 0 ? (price - ma20) / ma20 * 100 : null;
  const signals = [];

  const platform = detectPlatform(bars);
  let buyPoint = null;
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
    signals.push(`放量首板（${pct.toFixed(1)}%）`);
    if (!buyPoint) buyPoint = "放量首板";
  }
  const dip = detectFirstBoardDipBuy(bars);
  if (dip.hit) {
    signals.push(dip.note);
    buyPoint = "首板次日低吸";
  }

  if (ma5 != null && ma20 != null && price < ma20 && ma5 < ma20) {
    signals.push(`跌破MA20(${ma20.toFixed(2)})且MA5<MA20`);
    return { phase: "退潮", confidence: clamp(75 + (biasMa20 != null ? Math.abs(biasMa20) * 2 : 0)), buyPoint: null, platform: platform?.platform ?? null, platformDays: platform?.days, ma5, ma10, ma20, ma60, biasMa20, signals };
  }
  if (biasMa20 != null && biasMa20 > 18) {
    signals.push(`偏离MA20达${biasMa20.toFixed(0)}%（加速赶顶风险）`);
    return { phase: "加速", confidence: 70, buyPoint: null, platform: platform?.platform ?? null, platformDays: platform?.days, ma5, ma10, ma20, ma60, biasMa20, signals };
  }
  if (ma5 != null && ma10 != null && ma20 != null && ma5 > ma10 && ma10 > ma20 && price > ma20) {
    signals.push(`多头排列（MA5>MA10>MA20）`);
    const dipBuy = price >= (ma10 ?? 0) * 0.99 && price <= (ma10 ?? 0) * 1.03;
    if (dipBuy) {
      signals.push("回踩 MA10 企稳（主升回踩买点）");
      buyPoint = "主升回踩";
    }
    return { phase: "主升", confidence: 75, buyPoint, platform: platform?.platform ?? null, platformDays: platform?.days, ma5, ma10, ma20, ma60, biasMa20, signals };
  }
  if (buyPoint) {
    return { phase: "启动", confidence: 80, buyPoint, platform: platform?.platform ?? null, platformDays: platform?.days, ma5, ma10, ma20, ma60, biasMa20, signals };
  }
  signals.push("横盘整理，等待启动信号（平台突破/放量首板）");
  return { phase: "底部整理", confidence: 55, buyPoint: null, platform: platform?.platform ?? null, platformDays: platform?.days, ma5, ma10, ma20, ma60, biasMa20, signals };
}

function analyzeSwing(bars) {
  return classifySwingPhase(bars);
}

module.exports = { classifySwingPhase, analyzeSwing, detectPlatform, detectBreakout, detectFirstLimitUp, detectFirstBoardDipBuy };
