// ============================================================
// v9.97.0（批次 2）：技术指标快照（tinavi indicators.ts 移植，服务端纯函数）
// MA5/10/20/60、MACD(12,26,9)、RSI(6,14 Wilder)、KDJ(9)、BOLL(20,2)
// 输出：{ name, value, bias: bull|bear|neutral } 信号数组（分维度打标，聚合层加权）
// 日K 数据源：腾讯 web.ifzq.gtimg.cn fqkline（push2his 断源 fallback，服务端直连）
// ============================================================
const { getJson } = require("./outbound");

// ---------- 基础 ----------
function sma(values, period) {
  if (values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) sum += values[i];
  return sum / period;
}

function ema(values, period) {
  if (values.length === 0) return null;
  const k = 2 / (period + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

function emaSeries(values, period) {
  const out = [];
  if (values.length === 0) return out;
  let e = values[0];
  out.push(e);
  const k = 2 / (period + 1);
  for (let i = 1; i < values.length; i++) { e = values[i] * k + e * (1 - k); out.push(e); }
  return out;
}

function stddev(values, mean) {
  if (values.length === 0) return 0;
  let s = 0;
  for (const v of values) s += (v - mean) * (v - mean);
  return Math.sqrt(s / values.length);
}

// ---------- 信号数组（tinavi computeIndicatorSnapshot 对照） ----------
// 输入：收盘价序列 closes（升序，至少 60 根）
function computeIndicatorSignals(closes) {
  if (!closes || closes.length < 30) return { signals: [], snapshot: null };
  const c = closes;
  const last = c[c.length - 1];
  const signals = [];
  const snapshot = { close: last, ma5: null, ma10: null, ma20: null, ma60: null, macd: null, rsi6: null, rsi14: null, kdj: null, boll: null };

  // MA
  const ma5 = sma(c, 5), ma10 = sma(c, 10), ma20 = sma(c, 20), ma60 = c.length >= 60 ? sma(c, 60) : null;
  snapshot.ma5 = ma5; snapshot.ma10 = ma10; snapshot.ma20 = ma20; snapshot.ma60 = ma60;
  if (ma5 != null && ma20 != null) {
    signals.push({ name: "MA5/20", value: `MA5 ${ma5.toFixed(2)} / MA20 ${ma20.toFixed(2)}`, bias: ma5 > ma20 ? "bull" : ma5 < ma20 ? "bear" : "neutral" });
  }

  // MACD(12,26,9)：DIF/DEA/MACD 柱
  if (c.length >= 35) {
    const difSeries = [];
    const ema12 = emaSeries(c, 12), ema26 = emaSeries(c, 26);
    for (let i = 0; i < c.length; i++) difSeries.push((ema12[i] ?? ema12[ema12.length - 1]) - (ema26[i] ?? ema26[ema26.length - 1]));
    const deaSeries = emaSeries(difSeries, 9);
    const dif = difSeries[difSeries.length - 1], dea = deaSeries[deaSeries.length - 1];
    snapshot.macd = { dif, dea, hist: (dif - dea) * 2 };
    signals.push({ name: "MACD", value: `DIF ${dif.toFixed(3)} / DEA ${dea.toFixed(3)}`, bias: dif > dea ? "bull" : "bear" });
  }

  // RSI(6,14 Wilder)
  const rsi = (period) => {
    if (c.length < period + 1) return null;
    let gain = 0, loss = 0;
    for (let i = c.length - period; i < c.length; i++) {
      const d = c[i] - c[i - 1];
      if (d > 0) gain += d; else loss -= d;
    }
    if (gain + loss === 0) return 50;
    return gain / (gain + loss) * 100;
  };
  const rsi6 = rsi(6), rsi14 = rsi(14);
  snapshot.rsi6 = rsi6; snapshot.rsi14 = rsi14;
  if (rsi14 != null) {
    signals.push({ name: "RSI14", value: rsi14.toFixed(1), bias: rsi14 >= 70 ? "bear" : rsi14 <= 30 ? "bull" : "neutral" });
  }
  if (rsi6 != null && rsi14 != null) {
    signals.push({ name: "RSI6/14", value: `${rsi6.toFixed(1)}/${rsi14.toFixed(1)}`, bias: rsi6 > rsi14 ? "bull" : "bear" });
  }

  // KDJ(9)：K/D/J 金叉死叉
  if (c.length >= 20) {
    let k = 50, d = 50;
    for (let i = c.length - 9; i < c.length; i++) {
      const win = c.slice(Math.max(0, i - 8), i + 1);
      const low = Math.min(...win), high = Math.max(...win);
      const rsv = high > low ? (c[i] - low) / (high - low) * 100 : 50;
      k = k * 2 / 3 + rsv / 3;
      d = d * 2 / 3 + k / 3;
    }
    const j = 3 * k - 2 * d;
    snapshot.kdj = { k, d, j };
    signals.push({ name: "KDJ", value: `K ${k.toFixed(1)} / D ${d.toFixed(1)}`, bias: k > d ? "bull" : "bear" });
  }

  // BOLL(20,2)
  if (c.length >= 20) {
    const mid = sma(c, 20);
    if (mid != null) {
      const win = c.slice(-20);
      const sd = stddev(win, mid);
      const upper = mid + 2 * sd, lower = mid - 2 * sd;
      snapshot.boll = { mid, upper, lower };
      signals.push({ name: "BOLL", value: `上 ${upper.toFixed(2)} / 中 ${mid.toFixed(2)} / 下 ${lower.toFixed(2)}`, bias: last >= upper ? "bear" : last <= lower ? "bull" : "neutral" });
    }
  }

  return { signals, snapshot };
}

// ---------- 服务端日K 获取（腾讯 fqkline，push2his 断源兜底） ----------
// param 格式：sh600721,day,,,320,qfq → 返回 {"sh600721":{"qfqday":[[date,open,close,high,low,volume],...]}}
async function fetchDailyKline(code) {
  const market = code.startsWith("6") ? "sh" : "sz";
  const symbol = `${market}${code}`;
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},day,,,320,qfq`;
  const { data } = await getJson(url, { timeout: 8000 });
  // 腾讯返回 {code,msg,data:{symbol:{qfqday:[...]}}} —— getJson 已剥一层，再取 data.data
  const inner = data?.data ?? data;
  const node = inner?.[symbol]?.qfqday || inner?.[symbol]?.day;
  if (!Array.isArray(node) || node.length === 0) return [];
  // [date, open, close, high, low, volume, ...]
  return node.map(r => ({
    date: String(r[0]),
    open: Number(r[1]), close: Number(r[2]), high: Number(r[3]), low: Number(r[4]), volume: Number(r[5]) || 0,
  })).filter(k => Number.isFinite(k.close) && k.close > 0);
}

/** 聚合端点用：拉日K → 指标快照 + 信号数组（失败返回 null 不阻塞其余维度） */
async function computeIndicatorsFor(code) {
  try {
    const klines = await fetchDailyKline(code);
    if (klines.length < 30) return { klines, signals: [], snapshot: null, error: klines.length === 0 ? "日K获取失败" : "日K样本不足" };
    const closes = klines.map(k => k.close);
    const { signals, snapshot } = computeIndicatorSignals(closes);
    return { klines: klines.slice(-120), signals, snapshot, error: null };
  } catch (e) {
    return { klines: [], signals: [], snapshot: null, error: e.message };
  }
}

module.exports = { computeIndicatorSignals, fetchDailyKline, computeIndicatorsFor };
