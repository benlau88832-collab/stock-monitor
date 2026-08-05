// ============================================================
// 诱多探测引擎（v9.27 · P0-4）
// 背景：用户核心诉求"第一时间识别启动/分歧/诱多"，此前诱多只有一句
//   文案（anomalyTier "防诱多"），没有任何特征工程。
// 本模块：纯函数，输入个股实时/日线特征，输出诱多判定（类型+置信度+原因）。
// 与 anomalyTier（异动分级）联动：命中诱多 → 强制"禁止追高·疑似诱多"。
// 纯函数，不碰 DOM/localStorage/网络
// ============================================================

export type TrapType = "诱多拉升" | "假封板" | "尾盘抢筹出货" | "无明显诱多";

export interface TrapInput {
  code: string;
  name: string;
  /** 涨幅 %（10 代表涨停） */
  pct: number;
  /** 封单金额（元）；无封单=0 */
  sealFund?: number;
  /** 成交额（元） */
  amount?: number;
  /** 当日炸板次数 zbc */
  blastCount?: number;
  /** 主力净占比 %（可为负） */
  mainNetPct?: number;
  /** 散户净占比 %（诱多 = 主力出散户进） */
  retailNetPct?: number;
  /** 是否属今日主线内（主线内诱多置信度更高，因骗线目的性强） */
  isMainline?: boolean;
  /** 分钟级（预留，待实时分时源接入） */
  last30minPct?: number;
  /** 封单相对峰值衰减 %（预留） */
  sealFundDropPct?: number;
}

export interface TrapVerdict {
  isTrap: boolean;
  type: TrapType;
  /** 0-100 */
  confidence: number;
  reason: string;
}

// ============================================================
// 判定规则（游资实战口径）——按置信度从高到低短路
// ============================================================
export function detectTrap(input: TrapInput): TrapVerdict {
  const { pct, sealFund = 0, amount = 0, blastCount = 0, mainNetPct = 0, retailNetPct = 0, isMainline = false, last30minPct, sealFundDropPct } = input;
  const nearLimit = pct >= 9.5; // 近涨停（主板口径；20cm 股由调用方换算 pct 后再入）
  const noTrap = (type: TrapType, reason: string): TrapVerdict => ({ isTrap: false, type, confidence: 0, reason });

  // ---- 假封板：近涨停但封单薄（<成交额5%）且反复开板（炸板≥2） ----
  if (nearLimit && blastCount >= 2 && amount > 0 && sealFund / amount < 0.05) {
    const conf = Math.min(92, 70 + blastCount * 8 + (isMainline ? 6 : 0));
    return {
      isTrap: true, type: "假封板", confidence: conf,
      reason: `近涨停但封单仅${(sealFund / Math.max(1, amount) * 100).toFixed(1)}%成交额且已炸板${blastCount}次，封板脆弱，多为诱多出货`,
    };
  }

  // ---- 诱多拉升：涨幅≥7 但主力净流出且散户净流入（主力出散户进） ----
  if (pct >= 7 && mainNetPct < 0 && retailNetPct > 0) {
    const conf = Math.min(95, 75 + Math.abs(mainNetPct) * 3 + (isMainline ? 8 : 0));
    return {
      isTrap: true, type: "诱多拉升", confidence: conf,
      reason: `涨${pct.toFixed(1)}%但主力净占比${mainNetPct.toFixed(1)}%（流出）而散户净占比${retailNetPct.toFixed(1)}%（接盘），典型主力出货散户接筹`,
    };
  }

  // ---- 量价背离：涨幅≥7 但主力净流出（无散户数据时的近似） ----
  if (pct >= 7 && mainNetPct < 0) {
    return {
      isTrap: true, type: "诱多拉升", confidence: 70,
      reason: `涨${pct.toFixed(1)}%但主力净占比${mainNetPct.toFixed(1)}%（净流出），量价背离，拉升缺乏主力承接`,
    };
  }

  // ---- 尾盘抢筹出货：尾盘30分钟急拉但全天主力净流出（预留分时源） ----
  if (last30minPct != null && last30minPct >= 3 && mainNetPct < 0) {
    return {
      isTrap: true, type: "尾盘抢筹出货", confidence: 78,
      reason: `尾盘30分钟拉涨${last30minPct.toFixed(1)}%但全天主力净占比${mainNetPct.toFixed(1)}%（流出），尾盘拉升掩护出货概率高`,
    };
  }

  // ---- 封单快速衰减（预留：需分时封单峰值） ----
  if (sealFundDropPct != null && sealFundDropPct >= 60 && nearLimit) {
    return {
      isTrap: true, type: "假封板", confidence: 75,
      reason: `封单较峰值衰减${sealFundDropPct.toFixed(0)}%，封板资金快速撤离，开板风险高`,
    };
  }

  // ---- 未命中 ----
  if (nearLimit && blastCount >= 2 && amount > 0 && sealFund / amount >= 0.05) {
    // 有炸板但封单尚可 → 提示但不算诱多（分歧）
    return noTrap("无明显诱多", `虽炸板${blastCount}次但封单占比${(sealFund / amount * 100).toFixed(1)}%仍可，属正常分歧非诱多`);
  }
  return noTrap("无明显诱多", "未检测到诱多特征（封单/资金/量价结构正常）");
}

// ============================================================
// 主线级诱多预警：主线内诱多个股占比 ≥40% → 主线整体出货预警
// ============================================================
export interface MainlineTrapInput {
  mainline: string;
  verdicts: TrapVerdict[];
}

export function detectMainlineTrap(input: MainlineTrapInput): { flagged: boolean; rate: number; text: string } {
  const traps = input.verdicts.filter(v => v.isTrap);
  const rate = input.verdicts.length > 0 ? traps.length / input.verdicts.length : 0;
  if (rate >= 0.4 && traps.length >= 2) {
    return {
      flagged: true, rate,
      text: `⚠ 主线「${input.mainline}」诱多个股占比${(rate * 100).toFixed(0)}%（${traps.length}只），整体处于分歧/出货预警`,
    };
  }
  return { flagged: false, rate, text: "" };
}
