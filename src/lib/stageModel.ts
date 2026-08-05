// ============================================================
// 单一权威阶段模型（v9.27 · P0-3）
// 背景：此前"主线阶段"概念在全仓库有 6 套互不一致的词表与判定
//   （App.tsx judgeMainlineStage / MainlineRanking inferStage / mainline.ts 兜底 /
//    themeScore stageMap / emotionCycle / llmNewsIntelligence cycleStage），
//    同一主线在不同卡片显示不同阶段词，决策大脑"精神分裂"。
// 本模块收敛为唯一词表 + 三个入口（板块资金级/强度级/市场级），
//   所有 UI 与评分消费同一份输出。
// 纯函数，不碰 DOM/localStorage/网络
// ============================================================

/** 权威词表：五态 + 观察中（信号不一致时的兜底态） */
export type MainlineStage = "启动期" | "发酵期" | "高潮期" | "分歧期" | "退潮期" | "观察中";

export const MAINLINE_STAGES: MainlineStage[] = ["启动期", "发酵期", "高潮期", "分歧期", "退潮期"];

export interface StageVerdict {
  stage: MainlineStage;
  /** 一句话原因（≤30字，供卡片展示） */
  reason: string;
  /** 证据链（具体数据，供证据卡展示） */
  evidence: string[];
}

// ============================================================
// 入口 1：板块资金级（原 App.tsx judgeMainlineStage）
// 输入：单板块的涨幅 + 主力净占比（今/5d/10d）
// ============================================================
export interface StageFundsInput {
  pct: number;
  mainNetPct: number;
  mainNet5dPct: number;
  mainNet10dPct: number;
}

export function stageOfFunds(b: StageFundsInput): StageVerdict {
  const { pct, mainNetPct, mainNet5dPct, mainNet10dPct } = b;
  const base = [`涨幅${pct.toFixed(1)}%`, `主力净占比${mainNetPct.toFixed(2)}%`, `5日${mainNet5dPct.toFixed(2)}%`];

  // 1) 退潮期：今日与近5日主力净占比均为负 → 资金持续撤出
  if (mainNetPct < 0 && mainNet5dPct < 0)
    return { stage: "退潮期", reason: "今日与近5日主力净占比均为负，资金持续撤出", evidence: [...base, "5日资金持续为负，趋势向下"] };

  // 2) 分歧期：高位放量但主力不跟（量价背离）→ 原"高潮期"语义修正为分歧/出货预警
  if (pct >= 7 && (mainNetPct < 0 || mainNetPct < mainNet5dPct - 1))
    return { stage: "分歧期", reason: "涨幅放大但今日主力净占比走弱甚至转负，量价背离，警惕高位分歧", evidence: [...base, "涨幅≥7%但主力未同步跟进，疑似出货分歧"] };

  // 3) 高潮期：5日资金显著为正 + 今日继续净流入 + 涨幅放大 → 真正的情绪高潮
  if (mainNet5dPct >= 1.5 && mainNetPct > 0 && pct >= 5)
    return { stage: "高潮期", reason: "近5日主力资金持续显著流入且今日涨幅放大，情绪进入高潮", evidence: [...base, "5日资金≥1.5%且今日净流入+涨幅≥5%，主升加速"] };

  // 4) 发酵期：5日/10日资金持续为正且在走强
  if (mainNet5dPct > 3 && mainNet10dPct > 1 && mainNetPct > 0)
    return { stage: "发酵期", reason: "近5日、近10日主力净占比持续为正且在走强", evidence: [...base, "5日>3%且10日>1%，资金中期持续流入"] };

  // 5) 启动期：今日资金刚转正，5日累计尚小
  if (mainNetPct > 0 && Math.abs(mainNet5dPct) < 1.5)
    return { stage: "启动期", reason: "今日资金净流入转正，但近5日累计净占比尚小", evidence: [...base, "资金刚转正，5日累计<1.5%，处于点火初期"] };

  // 6) 观察中：信号不够一致
  return { stage: "观察中", reason: "资金与涨幅信号不够一致，暂无法给出明确阶段判断", evidence: base };
}

// ============================================================
// 入口 2：强度级（原 MainlineRanking.tsx inferStage）
// 输入：主线强度分 + 涨停家数 + 离场信号
// ============================================================
export interface StageStrengthInput {
  exitSignal?: boolean;
  strengthScore?: number;
  score?: number;
  ztCount?: number;
}

export function stageOfStrength(c: StageStrengthInput): MainlineStage {
  if (c.exitSignal) return "退潮期";
  const s = c.strengthScore ?? c.score ?? 0;
  if (s >= 80) return "高潮期";        // 原"加速" → 高潮期
  if (s >= 60) return "发酵期";        // 原"主升" → 发酵期
  if ((c.ztCount ?? 0) >= 5) return "分歧期";
  return "启动期";
}

// ============================================================
// 入口 3：市场情绪级对齐映射（emotionCycle 五档 → 权威词表）
// 说明：情绪周期是"市场维度"，主线阶段是"题材维度"，判定逻辑各自保留，
//       仅词表对齐，避免同一屏出现"启动 vs 启动期"两种写法。
// ============================================================
export function emotionToStage(p: string): MainlineStage {
  switch (p) {
    case "启动": return "启动期";
    case "主升": return "发酵期";
    case "分歧": return "分歧期";
    case "退潮": return "退潮期";
    case "冰点": return "退潮期"; // 冰点是退潮的极值
    default: return "观察中";
  }
}

// ============================================================
// 入口 4：市场级完整判定（报告 P0-3 建议版，供后续增强接入）
// 输入：涨停家数/高度/炸板率/晋级率/溢价/资金（主线或市场均可）
// 阈值采用游资共识口径
// ============================================================
export interface StageMarketInput {
  ztCountToday: number;
  ztCountYesterday?: number | null;
  heightToday?: number;
  heightYesterday?: number | null;
  blastedRateToday?: number | null;
  blastedRatePrev?: number | null;
  promotionRate?: number | null;   // 2板→3板晋级率 0~1
  premiumAvg?: number | null;      // 昨日涨停今日平均溢价 %
  mainNetPct: number;              // 主线主力净占比 %
  mainNet5dPct?: number;
}

export function classifyStage(input: StageMarketInput): StageVerdict {
  const zt = input.ztCountToday;
  const ztPrev = input.ztCountYesterday;
  const ztYoY = ztPrev != null && ztPrev > 0 ? (zt - ztPrev) / ztPrev : null;
  const blasted = input.blastedRateToday ?? null;
  const blastedUp = input.blastedRatePrev != null && blasted != null && blasted > input.blastedRatePrev;
  const promo = input.promotionRate ?? null;
  // premium 预留：溢价走弱是分歧重要信号，后续接入后启用
  const height = input.heightToday ?? 0;

  // 退潮：龙头断板 + 涨停骤降 + 资金连日净流出
  if (ztYoY != null && ztYoY < -0.3 && input.mainNetPct < 0)
    return { stage: "退潮期", reason: "涨停数环比大幅萎缩且主力净占比转负，主线退潮", evidence: [`涨停${zt}只环比${(ztYoY * 100).toFixed(0)}%`, `主力净占比${input.mainNetPct.toFixed(2)}%`] };
  // 分歧：炸板率环比升≥10pp 或 涨停环比降≥30% 或 晋级率骤降，但龙头仍在
  if ((blasted != null && blastedUp && blasted - (input.blastedRatePrev ?? 0) >= 10) ||
      (ztYoY != null && ztYoY <= -0.3) ||
      (promo != null && promo < 0.15 && promo > 0.02))
    return { stage: "分歧期", reason: "炸板率攀升/涨停萎缩/晋级率骤降，多空换手加剧", evidence: [
      blasted != null ? `炸板率${blasted.toFixed(0)}%` : `涨停${zt}只`,
      promo != null ? `晋级率${(promo * 100).toFixed(0)}%` : `最高${height}板`,
    ] };
  // 高潮：高度见顶不再升 + 量价背离（涨幅大但资金走弱）
  if (height >= 4 && input.heightYesterday != null && height <= input.heightYesterday && input.mainNetPct < 0)
    return { stage: "高潮期", reason: "连板高度不再抬升且资金走弱，情绪高潮后的转折临界", evidence: [`最高${height}板（未创新高）`, `主力净占比${input.mainNetPct.toFixed(2)}%（转弱）`] };
  // 发酵：涨停环比↑ + 晋级率≥30% + 资金为正
  if ((ztYoY != null && ztYoY > 0) || (promo != null && promo >= 0.3)) {
    if (input.mainNetPct > 0)
      return { stage: "发酵期", reason: "涨停环比上升/晋级率健康且资金持续流入，主线发酵", evidence: [`涨停${zt}只`, `晋级率${promo != null ? (promo * 100).toFixed(0) + "%" : "—"}`, `主力净占比${input.mainNetPct.toFixed(2)}%`] };
  }
  // 启动：昨日无/少涨停，今日 ≥3 首板且资金刚转正
  if ((ztPrev == null || ztPrev < 5) && zt >= 3 && input.mainNetPct > 0 && Math.abs(input.mainNet5dPct ?? 0) < 1.5)
    return { stage: "启动期", reason: "昨日涨停稀少今日明显增多且资金刚转正，题材点火", evidence: [`昨日${ztPrev ?? 0}只→今日${zt}只`, `主力净占比${input.mainNetPct.toFixed(2)}%（转正）`] };
  // 兜底
  return { stage: "观察中", reason: "信号不足以给出明确阶段判断", evidence: [`涨停${zt}只`, `主力净占比${input.mainNetPct.toFixed(2)}%`] };
}

// ============================================================
// 阶段配色/权重表（组件与评分共用，保证显示一致）
// ============================================================
export const STAGE_COLOR: Record<string, string> = {
  启动期: "bg-sky-500/20 text-sky-300",
  发酵期: "bg-amber-500/20 text-amber-300",
  高潮期: "bg-rose-500/20 text-rose-300",
  分歧期: "bg-violet-500/20 text-violet-300",
  退潮期: "bg-emerald-500/20 text-emerald-300",
  观察中: "bg-slate-500/20 text-slate-400",
};

/** 消息维度按阶段浮动权重（与 themeScore.ts 共用，防止再次漂移） */
export const NEWS_WEIGHT_BY_STAGE: Record<string, number> = {
  启动期: 0.30,
  发酵期: 0.20,
  高潮期: 0.10,
  分歧期: 0.15,
  退潮期: 0.15,
  观察中: 0.20,
};

/** 阶段分数映射（themeScore.ts stageMap 共用） */
export const STAGE_SCORE_MAP: Record<string, number> = {
  启动期: 100,
  发酵期: 80,
  分歧期: 50,
  高潮期: 30,
  退潮期: 0,
  观察中: 50,
};
