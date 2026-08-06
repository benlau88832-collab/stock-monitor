// 情绪分按交易日冻结存储（替代旧的 prev_sentiment 每60秒覆盖bug）
// P2 新增：日内轨迹采样（5分钟节流）+ 动量判断 + 仓位建议
import { localDateStr, localDateStrOffset, getBJDate, getBJWeekday } from "./format";
import { SENTI_EXTREME_GREED, SENTI_GREED, SENTI_NEUTRAL_HIGH, SENTI_FEAR } from "./thresholds";
const PREFIX = "sentiment:";
const INTRADAY_PREFIX = "sentiment_intraday:"; // sentiment_intraday:YYYY-MM-DD = [{t:"HH:MM", s:score}]

function todayKey(): string { return localDateStr(); }

export function saveTodaySentiment(score: number): void {
  if (score === 50) return;
  localStorage.setItem(PREFIX + todayKey(), String(score));
  localStorage.removeItem("prev_sentiment"); // 清理旧key
}

// ============== P2 日内轨迹 ==============
export interface IntradayPoint { t: string; s: number }

/** 日内采样（5分钟节流）：盘中每次刷新情绪分时记录，用于画日内折线+动量 */
export function recordIntradaySentiment(score: number): void {
  if (!Number.isFinite(score) || score <= 0) return;
  try {
    const key = INTRADAY_PREFIX + todayKey();
    let pts: IntradayPoint[] = [];
    try { pts = JSON.parse(localStorage.getItem(key) || "[]"); } catch { pts = []; }
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    // 5分钟节流：与上一条间隔 <5min 则覆盖（避免高频刷新堆积）
    const last = pts[pts.length - 1];
    if (last && last.t === hhmm) return;
    if (last) {
      const [lh, lm] = last.t.split(":").map(Number);
      const [ch, cm] = hhmm.split(":").map(Number);
      if (ch * 60 + cm - (lh * 60 + lm) < 5) {
        last.t = hhmm; last.s = score; // 更新时间+值
        localStorage.setItem(key, JSON.stringify(pts));
        return;
      }
    }
    pts.push({ t: hhmm, s: score });
    if (pts.length > 80) pts = pts.slice(-80); // 保留约一整天
    localStorage.setItem(key, JSON.stringify(pts));
  } catch { /* 静默 */ }
}

/** 取指定日期日内轨迹（缺省今天） */
export function loadIntradaySeries(dateStr?: string): IntradayPoint[] {
  try {
    const key = INTRADAY_PREFIX + (dateStr ?? todayKey());
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

/** 最近 N 分钟的动量判断：取首尾两个采样斜率（符号决定方向） */
export type Momentum = "heating" | "cooling" | "flat" | "none";

export function computeMomentum(pts: IntradayPoint[], windowMin = 30): { momentum: Momentum; delta: number } {
  if (pts.length < 2) return { momentum: "none", delta: 0 };
  const end = pts[pts.length - 1];
  // 找到 windowMin 分钟前或更早的采样点
  const [eh, em] = end.t.split(":").map(Number);
  const endMin = eh * 60 + em;
  let startPt = pts[0];
  for (let i = pts.length - 2; i >= 0; i--) {
    const [h, m] = pts[i].t.split(":").map(Number);
    if (endMin - (h * 60 + m) >= windowMin) { startPt = pts[i]; break; }
  }
  const delta = end.s - startPt.s;
  if (delta >= 2) return { momentum: "heating", delta };
  if (delta <= -2) return { momentum: "cooling", delta };
  return { momentum: "flat", delta };
}

// ============== P2 仓位建议（情绪分 + 动量 + 闸门系数） ==============
// 十年机构视角：静态情绪分是"温度计"，仓位还要看"温度变化方向"。
// 规则（可调）：
//   - 情绪≥65 且升温 → 进攻仓位（上限 100%）
//   - 情绪≥65 但降温 → 获利了结（上限 60%）
//   - 情绪 35-65 → 中性（上限 70%，动量修正 ±10%）
//   - 情绪<35 且降温 → 防守（上限 30%）
//   - 情绪<35 但升温 → 试探（上限 40%）
// 再叠加闸门系数：final = base% × gateFactor（gateFactor≤0.5 时强制 ≤30%）
export interface PositionAdvice {
  positionPct: number;   // 建议总仓位 0-100
  label: string;
  hint: string;
}

export function suggestPosition(
  sentiment: number | null,
  momentum: Momentum,
  gateFactor: number | null,
): PositionAdvice {
  if (sentiment == null || !Number.isFinite(sentiment) || sentiment <= 0) {
    return { positionPct: 0, label: "数据不足", hint: "情绪数据缺失，无法给出仓位建议" };
  }
  let base = 70; let label = "中性仓位"; let hint = "情绪中性，保持常规仓位";
  // v9.62（V9-L1）：情绪分档阈值统一引用 thresholds.ts
  if (sentiment >= SENTI_EXTREME_GREED) {
    // v9.26.13：极度贪婪不再"禁新开仓"，而是"控仓兑现"（向确定性龙头集中）
    if (momentum === "heating") { base = 50; label = "控仓兑现"; hint = "情绪极度贪婪且升温，已重仓者分批兑现，轻仓者不追高"; }
    else if (momentum === "cooling") { base = 40; label = "减仓兑现"; hint = "情绪贪婪且降温，获利了结是上策"; }
    else { base = 50; label = "控仓兑现"; hint = "情绪极度贪婪，向确定性龙头集中，戒追高"; }
  } else if (sentiment >= SENTI_GREED) {
    if (momentum === "heating") { base = 90; label = "偏进攻"; hint = "情绪贪婪且升温，可适度加仓但严守纪律"; }
    else if (momentum === "cooling") { base = 60; label = "获利了结"; hint = "情绪贪婪但降温，注意兑现利润"; }
    else { base = 75; label = "偏进攻"; hint = "情绪贪婪但动量平稳，仓位适中偏高"; }
  } else if (sentiment >= SENTI_NEUTRAL_HIGH) {
    if (momentum === "heating") { base = 75; label = "偏进攻"; hint = "情绪中性偏多且升温，可适度加仓"; }
    else if (momentum === "cooling") { base = 50; label = "偏防守"; hint = "情绪中性但降温，收缩战线"; }
    else { base = 65; label = "中性"; hint = "情绪中性，按节奏操作"; }
  } else if (sentiment >= SENTI_FEAR) {
    // v9.26.13：恐慌+升温 = 反向机会（巴菲特"别人恐惧我贪婪"），不是被动空仓
    if (momentum === "heating") { base = 50; label = "反向试探"; hint = "情绪恐慌但升温，关注超跌反弹机会（龙头优先）"; }
    else if (momentum === "cooling") { base = 25; label = "防守仓位"; hint = "情绪低迷且继续降温，轻仓等待"; }
    else { base = 35; label = "防守仓位"; hint = "情绪低迷，保持低仓位，避免抄底"; }
  } else {
    // 极度恐慌（<25）：不再空仓，按"超跌机会"理解：恐慌极值=逆向买入窗口
    if (momentum === "heating") { base = 40; label = "反向机会"; hint = "情绪极度恐慌但升温，分批建仓优质超跌股（白马/龙头）"; }
    else if (momentum === "cooling") { base = 15; label = "轻仓观望"; hint = "情绪极度恐慌且降温，保留现金等反转信号"; }
    else { base = 25; label = "反向机会"; hint = "情绪极度恐慌（逆向窗口），关注ETF与白马蓝筹的左侧机会"; }
  }
  // 闸门系数叠加（熔断时强制压缩）
  if (gateFactor != null) {
    const capped = Math.round(base * gateFactor);
    base = gateFactor <= 0.5 ? Math.min(base, 35) : capped;
    if (gateFactor <= 0.3) { label = "闸门熔断"; hint = "闸门系数极低（熔断触发），强制低仓位"; }
  }
  return { positionPct: Math.max(0, Math.min(100, base)), label, hint };
}

export function loadPrevTradingDaySentiment(): { score: number; date: string } | null {
  for (let i = 1; i <= 10; i++) {
    const dateStr = localDateStrOffset(i);
    // v9.60（V9-D3）：周末判定用北京时间（getBJDate），替代本机 getDay() 时区偏移
    // v9.63-fix（补丁）：显式 getBJWeekday
    const bj = getBJDate(new Date(dateStr + "T00:00:00"));
    const day = getBJWeekday(bj);
    if (day === 0 || day === 6) continue;
    const val = localStorage.getItem(PREFIX + dateStr);
    if (val != null) {
      const score = Number(val);
      if (Number.isFinite(score)) return { score, date: dateStr };
    }
  }
  return null;
}
