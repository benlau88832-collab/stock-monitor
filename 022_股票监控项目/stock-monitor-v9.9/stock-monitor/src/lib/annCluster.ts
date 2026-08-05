// ============================================================
// 公告类型聚类 + 密度预警（v9.32.1 · 缺口7）
// 游资价值：
//   - 某股突然连续发 3 条公告 = 可能有大事（密集公告预警）
//   - 按 业绩/重组/增减持/融资/诉讼监管 聚类比单条排序更易抓重点
// 纯函数，不碰 DOM/localStorage/网络
// ============================================================

export type AnnCategory = "业绩" | "重组" | "增减持" | "融资" | "诉讼监管" | "其他";

export function clusterAnnouncement(title: string, columnName = ""): AnnCategory {
  const t = `${title} ${columnName}`;
  if (/业绩|净利润|营收|预增|预减|扭亏|减亏|年报|季报|财报/.test(t)) return "业绩";
  if (/重组|并购|吸收合并|分立|资产置换/.test(t)) return "重组";
  if (/增持|减持|回购|股权变动|举牌/.test(t)) return "增减持";
  if (/定增|配股|可转债|融资|发债|募资/.test(t)) return "融资";
  if (/立案|诉讼|仲裁|行政处罚|警示函|问询|监管|违规/.test(t)) return "诉讼监管";
  return "其他";
}

/** 聚类标签配色（组件复用） */
export const ANN_CATEGORY_META: Record<AnnCategory, { color: string; short: string }> = {
  业绩:     { color: "bg-emerald-500/20 text-emerald-300", short: "业绩" },
  重组:     { color: "bg-violet-500/20 text-violet-300", short: "重组" },
  增减持:   { color: "bg-amber-500/20 text-amber-300", short: "增减持" },
  融资:     { color: "bg-sky-500/20 text-sky-300", short: "融资" },
  诉讼监管: { color: "bg-rose-500/20 text-rose-300", short: "监管" },
  其他:     { color: "bg-slate-500/20 text-slate-400", short: "其他" },
};

export interface AnnDensityResult {
  /** 该股 24h 内公告条数 */
  density: number;
  /** 是否密集（≥3 条 = 可能有大事） */
  alert: boolean;
}

export function detectAnnDensity(
  code: string,
  anns: Array<{ stockCode: string; time?: string }>,
): AnnDensityResult {
  const now = Date.now();
  const recent = anns.filter(a => {
    if (String(a.stockCode) !== String(code)) return false;
    const t = a.time ? new Date(a.time.replace(" ", "T")).getTime() : NaN;
    return !Number.isNaN(t) && t > now - 24 * 3600 * 1000;
  });
  return { density: recent.length, alert: recent.length >= 3 };
}
