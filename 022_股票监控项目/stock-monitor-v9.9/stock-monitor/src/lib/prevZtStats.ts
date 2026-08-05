// ============================================================
// v9.36（B2）：昨日涨停统计纯函数（从 App.tsx refreshAll 抽取）
// 计算：溢价均值 / 溢价4档分布 / 核按钮预警 / 晋级率
// 输入昨日涨停快照 + 今日行情 brief + 今日涨停池 → 输出统计结果
// ============================================================

export interface PrevZtStatsInput {
  /** 昨日涨停快照（loadPrevZTSnapshot 结果，含 c/n/lbc） */
  prevZTPool: Array<{ c: string; n?: string; lbc?: number }> | null;
  /** 今日涨停池原始数据（limitPool.rawZTPool，含 c/lbc） */
  todayRawPool: Array<{ c: string; lbc?: number }> | null;
  /** 昨日涨停股今日行情（code → { pct }，来自 fetchStockBriefBatch） */
  briefMap: Map<string, { pct: number }>;
}

export interface PrevZtStatsResult {
  /** 溢价均值（昨日涨停股今日平均涨幅%） */
  premiumAvg: number | null;
  /** 溢价 4 档分布（焖面<-5 / -5~0 / 0~3 / >3） */
  premiumDist: { ltNeg5: number; neg5to0: number; zeroTo3: number; gt3: number } | null;
  /** 核按钮预警（昨≥2板 今日跌≤-9%）：["名称(3板跌-9.5%)", ...] */
  nuclearAlerts: string[];
  /** 晋级率（昨日首板今日继续封板比例，0~1） */
  promotionRate: number | null;
}

export function computePrevZtStats(input: PrevZtStatsInput): PrevZtStatsResult {
  const { prevZTPool, todayRawPool, briefMap } = input;
  const result: PrevZtStatsResult = { premiumAvg: null, premiumDist: null, nuclearAlerts: [], promotionRate: null };
  if (!prevZTPool || prevZTPool.length === 0) return result;

  // 昨日涨停股代码（去重）
  const codes = [...new Set(prevZTPool.map(s => String(s.c)))];

  // 溢价均值 + 4 档分布
  if (codes.length > 0 && briefMap.size > 0) {
    let pctSum = 0, pctCount = 0;
    const dist = { ltNeg5: 0, neg5to0: 0, zeroTo3: 0, gt3: 0 };
    for (const code of codes) {
      const brief = briefMap.get(code);
      if (brief && Number.isFinite(brief.pct)) {
        pctSum += brief.pct;
        pctCount++;
        if (brief.pct < -5) dist.ltNeg5++;
        else if (brief.pct < 0) dist.neg5to0++;
        else if (brief.pct <= 3) dist.zeroTo3++;
        else dist.gt3++;
      }
    }
    result.premiumAvg = pctCount > 0 ? Math.round(pctSum / pctCount * 100) / 100 : null;
    if (pctCount > 0) result.premiumDist = dist;
  }

  // 核按钮检测：昨≥2板 今日跌≤-9%（秒跌停 = 退潮最强信号）
  const nukes: string[] = [];
  for (const s of prevZTPool) {
    const lbc = s.lbc ?? 1;
    if (lbc >= 2) {
      const brief = briefMap.get(String(s.c));
      if (brief && brief.pct <= -9) {
        nukes.push(`${s.n ?? s.c}(${lbc}板跌${brief.pct.toFixed(1)}%)`);
      }
    }
  }
  result.nuclearAlerts = nukes.slice(0, 8);

  // 晋级率：昨日首板（lbc===1）今日继续涨停（lbc>=2）的比例
  const yesterdayFirstBoard = prevZTPool.filter(s => (s.lbc ?? 1) === 1);
  if (yesterdayFirstBoard.length > 0 && todayRawPool && todayRawPool.length > 0) {
    const todayPoolCodes = new Map<string, number>();
    for (const s of todayRawPool) {
      todayPoolCodes.set(String(s.c), s.lbc ?? 1);
    }
    let promoted = 0;
    for (const s of yesterdayFirstBoard) {
      const todayLbc = todayPoolCodes.get(String(s.c));
      if (todayLbc != null && todayLbc >= 2) promoted++;
    }
    result.promotionRate = Math.round(promoted / yesterdayFirstBoard.length * 1000) / 1000;
  }
  return result;
}
