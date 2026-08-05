// ============================================================
// 极端板识别引擎（v9.32.1 · 缺口1）
// 游资价值：
//   - 核按钮：昨日涨停（尤其高位≥2板）今日开盘/当前秒跌停 —— 退潮最强信号
//   - 地天板：今日触及跌停后拉回涨停 —— 弱转强极致信号
//   - 天地板：今日触及涨停后跌停 —— 冲高回落强出货
// 纯函数，不碰 DOM/localStorage/网络
// ============================================================

export type ExtremeType = "核按钮" | "地天板" | "天地板" | "无";

export interface ExtremeInput {
  code: string;
  name: string;
  /** 昨日是否涨停 */
  yesterdayZt: boolean;
  /** 昨日连板数（昨日 lbc） */
  yesterdayHeight: number;
  /** 今日开盘涨幅 %（无开盘数据传 null，用当前涨幅近似） */
  todayOpenPct: number | null;
  /** 当前涨幅 % */
  todayPct: number;
  /** 今日最低涨幅 %（无分时数据传 null） */
  todayLowPct: number | null;
  /** 今日最高涨幅 %（无分时数据传 null） */
  todayHighPct: number | null;
}

export interface ExtremeVerdict {
  type: ExtremeType;
  /** 0-100 */
  confidence: number;
  reason: string;
}

export function detectExtremeBoard(input: ExtremeInput): ExtremeVerdict {
  const { yesterdayZt, yesterdayHeight, todayOpenPct, todayPct, todayLowPct, todayHighPct } = input;
  const none: ExtremeVerdict = { type: "无", confidence: 0, reason: "" };

  // ---- 核按钮：昨日涨停 + 高位(≥2板) + 今日开盘/当前 ≤-9%（秒跌停） ----
  if (yesterdayZt && yesterdayHeight >= 2) {
    const openHit = todayOpenPct != null && todayOpenPct <= -9;
    const nowHit = todayPct <= -9;
    if (openHit || nowHit) {
      const conf = 75 + Math.min(20, yesterdayHeight * 5) + (openHit ? 5 : 0);
      return {
        type: "核按钮",
        confidence: Math.min(95, conf),
        reason: `昨${yesterdayHeight}板今日${todayOpenPct != null && todayOpenPct <= -9 ? `开盘-${Math.abs(todayOpenPct).toFixed(1)}%` : `跌${Math.abs(todayPct).toFixed(1)}%`}，高位核按钮（退潮信号）`,
      };
    }
  }

  // ---- 地天板：今日最低触及跌停（≤-9.5%）+ 当前接近涨停（≥9.5%） ----
  if (todayLowPct != null && todayLowPct <= -9.5 && todayPct >= 9.5) {
    return {
      type: "地天板", confidence: 88,
      reason: `最低${todayLowPct.toFixed(1)}%→现${todayPct.toFixed(1)}%，地天板（弱转强极致信号）`,
    };
  }

  // ---- 天地板：今日最高触及涨停（≥9.5%）+ 当前跌停（≤-9.5%） ----
  if (todayHighPct != null && todayHighPct >= 9.5 && todayPct <= -9.5) {
    return {
      type: "天地板", confidence: 88,
      reason: `最高${todayHighPct.toFixed(1)}%→现${todayPct.toFixed(1)}%，天地板（强出货）`,
    };
  }

  return none;
}

// ============================================================
// 批量检测（供 App.tsx 扫昨日涨停池）
// ============================================================
export interface ExtremeBatchResult {
  nuclear: ExtremeVerdict[];  // 核按钮（预警用）
  others: ExtremeVerdict[];   // 地天板/天地板（展示用）
}

export function detectExtremeBatch(
  yesterdayZt: Array<{ code: string; name?: string; lbc?: number }>,
  briefMap: Map<string, { price: number; pct: number }>,
): ExtremeBatchResult {
  const nuclear: ExtremeVerdict[] = [];
  const others: ExtremeVerdict[] = [];
  for (const y of yesterdayZt) {
    const brief = briefMap.get(String(y.code));
    if (!brief) continue;
    const v = detectExtremeBoard({
      code: String(y.code),
      name: y.name ?? "",
      yesterdayZt: true,
      yesterdayHeight: y.lbc ?? 1,
      todayOpenPct: null, // 无开盘数据，用当前涨幅近似（降置信）
      todayPct: brief.pct,
      todayLowPct: null,
      todayHighPct: null,
    });
    if (v.type === "核按钮") nuclear.push(v);
    else if (v.type !== "无") others.push(v);
  }
  return { nuclear, others };
}
