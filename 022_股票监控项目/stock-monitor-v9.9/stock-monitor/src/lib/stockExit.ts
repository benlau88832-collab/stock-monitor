// ============================================================
// 个股级离场引擎（v9.27 · P1-7）
// 背景：此前 exitSignal.ts 只做"主线级"离场（炸板率/涨停数/高度/资金环比），
//   但用户持仓是个股——需要"我手里这只票什么时候跑"。
// 本模块：输入持仓成本 + 个股实时特征 + 主线龙头状态，输出离场预警 + 建议减仓比例。
// 纯函数，不碰 DOM/localStorage/网络
// ============================================================

export type ExitLevel = "red" | "yellow" | "none";

export interface StockExitInput {
  code: string;
  name: string;
  /** 持仓成本（无持仓 = null，此时不触发成本止损规则） */
  cost?: number | null;
  /** 当前价 */
  price: number;
  /** 涨幅 % */
  pct: number;
  /** 主力净占比 %（可为负） */
  mainNetPct?: number;
  /** 散户净占比 % */
  retailNetPct?: number;
  /** 主力净流入额（元） */
  mainNet?: number;
  /** 近5日主力净额 */
  mainNet5d?: number;
  /** 近10日主力净额 */
  mainNet10d?: number;
  /** 封单金额（元） */
  sealFund?: number;
  /** 成交额（元） */
  amount?: number;
  /** 所在主线龙头是否仍封板/走强（false = 龙头熄火；null = 未知） */
  leaderAlive?: boolean | null;
  /** 是否该股自身就是龙头 */
  isLeader?: boolean;
  /** 所在主线名 */
  mainline?: string | null;
}

export interface StockExitVerdict {
  shouldExit: boolean;
  level: ExitLevel;
  /** 触发原因（合并多条） */
  reasons: string[];
  /** 建议减仓比例 %（0-100） */
  suggestedCutPct: number;
}

// ============================================================
// 判定规则（从重到轻短路，多条命中取最高级）
// ============================================================
export function checkStockExit(input: StockExitInput): StockExitVerdict {
  const { cost, price, pct, mainNetPct = 0, retailNetPct = 0, mainNet = 0, mainNet5d = 0, mainNet10d = 0, sealFund = 0, amount = 0, leaderAlive, isLeader = false, mainline } = input;

  const reasons: string[] = [];
  let level: ExitLevel = "none";
  let cutPct = 0;

  // 1) 诱多出货：涨≥7% 但主力流出 + 散户接盘（联动 trapDetector 语义）
  if (pct >= 7 && mainNetPct < 0 && retailNetPct > 0) {
    level = "red";
    reasons.push(`涨${pct.toFixed(1)}%但主力净占比${mainNetPct.toFixed(1)}%（流出）散户${retailNetPct.toFixed(1)}%（接盘），诱多出货结构`);
    cutPct = 100;
  }
  // 2) 龙头熄火：所在主线龙头断板/走弱，跟风票立即离场
  if (level === "none" && leaderAlive === false && !isLeader) {
    level = "red";
    reasons.push(`所在主线「${mainline ?? "未知"}」龙头熄火，跟风票失去锚定，立即离场`);
    cutPct = 100;
  }
  // 3) 封单消失：近涨停但封单/成交 <2%（封板被砸穿）
  if (level === "none" && pct >= 9.5 && amount > 0 && sealFund / amount < 0.02) {
    level = "red";
    reasons.push(`近涨停但封单仅${(sealFund / amount * 100).toFixed(1)}%成交额，封板即将/已被砸穿`);
    cutPct = 100;
  }
  // 4) 破成本硬止损：跌破成本 3% 以上（持仓必需）
  if (level === "none" && cost != null && cost > 0 && price > 0) {
    const lossPct = (price - cost) / cost * 100;
    if (lossPct <= -3) {
      level = "red";
      reasons.push(`已跌破持仓成本${lossPct.toFixed(1)}%（>3% 止损线）`);
      cutPct = 100;
    } else if (lossPct <= -1.5) {
      level = "yellow";
      reasons.push(`逼近持仓成本止损线（${lossPct.toFixed(1)}%）`);
      cutPct = 30;
    }
  }
  // 5) 资金持续流出：主力 今/5日/10日 全负 → 中等级别预警
  if (level === "none" && mainNet < 0 && mainNet5d < 0 && mainNet10d < 0) {
    level = "yellow";
    reasons.push("主力今日/5日/10日持续净流出，资金面恶化");
    cutPct = 30;
  }
  // 6) 主力净占比转负（无成本时的弱信号）
  if (level === "none" && mainNetPct < -2) {
    level = "yellow";
    reasons.push(`主力净占比${mainNetPct.toFixed(1)}%（转弱）`);
    cutPct = 20;
  }
  // 7) 高位放量滞涨：涨≥7% 但主力不跟（量价背离轻信号）
  if (level === "none" && pct >= 7 && mainNetPct < 0) {
    level = "yellow";
    reasons.push(`涨${pct.toFixed(1)}%但主力净占比${mainNetPct.toFixed(1)}%（净流出），量价背离`);
    cutPct = 20;
  }

  if (level === "none") {
    return { shouldExit: false, level: "none", reasons: [], suggestedCutPct: 0 };
  }
  return { shouldExit: true, level, reasons, suggestedCutPct: cutPct };
}

// ============================================================
// 便捷：离场徽章样式（组件复用）
// ============================================================
export function exitBadge(v: StockExitVerdict): { label: string; cls: string } {
  if (v.level === "none") return { label: "", cls: "" };
  if (v.level === "red") return { label: `🚨 立即离场（减${v.suggestedCutPct}%）`, cls: "bg-rose-500/20 text-rose-300 border-rose-500/40" };
  return { label: `⚠ 减仓观察（减${v.suggestedCutPct}%）`, cls: "bg-amber-500/20 text-amber-300 border-amber-500/40" };
}
