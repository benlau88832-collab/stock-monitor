// 席位档案：知名游资/机构营业部标签库（可自行扩充）
// 统一维护，龙虎榜组件和席位台账共同引用

export interface SeatTag {
  keywords: string[];
  label: string;
  color: string;
  // 分类：机构/北向/知名游资/量化
  category: "institution" | "northbound" | "hotmoney" | "quant";
}

export const SEAT_PROFILES: SeatTag[] = [
  // 机构
  { keywords: ["机构专用"], label: "机构席位", color: "bg-slate-500/20 text-slate-300", category: "institution" },
  // 北向
  { keywords: ["沪股通专用", "深股通专用"], label: "沪深股通", color: "bg-slate-500/20 text-slate-300", category: "northbound" },
  // 知名游资营业部
  { keywords: ["华鑫证券上海分公司", "华鑫上海分"], label: "知名游资", color: "bg-amber-500/20 text-amber-300", category: "hotmoney" },
  { keywords: ["东方财富拉萨"], label: "拉萨帮", color: "bg-amber-500/20 text-amber-300", category: "hotmoney" },
  { keywords: ["国泰海通上海江苏路", "国泰君安上海江苏路"], label: "章盟主", color: "bg-amber-500/20 text-amber-300", category: "hotmoney" },
  { keywords: ["中国银河绍兴"], label: "赵老哥", color: "bg-amber-500/20 text-amber-300", category: "hotmoney" },
  { keywords: ["华泰南京太平南路", "华泰证券南京太平南路"], label: "知名游资", color: "bg-amber-500/20 text-amber-300", category: "hotmoney" },
  { keywords: ["中信建投杭州"], label: "知名游资", color: "bg-amber-500/20 text-amber-300", category: "hotmoney" },
  { keywords: ["国泰海通成都北一环", "国泰君安成都北一环"], label: "知名游资", color: "bg-amber-500/20 text-amber-300", category: "hotmoney" },
  { keywords: ["开源证券西安太华路"], label: "知名游资", color: "bg-amber-500/20 text-amber-300", category: "hotmoney" },
  { keywords: ["中国中金财富深圳深南大道"], label: "知名游资", color: "bg-amber-500/20 text-amber-300", category: "hotmoney" },
  { keywords: ["东方证券上海浦东新区源深路"], label: "知名游资", color: "bg-amber-500/20 text-amber-300", category: "hotmoney" },
  { keywords: ["招商证券深圳蛇口工业八路"], label: "知名游资", color: "bg-amber-500/20 text-amber-300", category: "hotmoney" },
  { keywords: ["中信证券上海溧阳路"], label: "知名游资", color: "bg-amber-500/20 text-amber-300", category: "hotmoney" },
  // 量化
  { keywords: ["量化", "对冲"], label: "量化席位", color: "bg-slate-500/20 text-slate-300", category: "quant" },
];

/** 匹配席位标签 */
export function matchSeatTag(deptName: string): SeatTag | null {
  for (const tag of SEAT_PROFILES) {
    if (tag.keywords.some(kw => deptName.includes(kw))) return tag;
  }
  return null;
}

/** 判断是否为游资席位（用于合力判断） */
export function isHotMoneySeat(deptName: string): boolean {
  const tag = matchSeatTag(deptName);
  return tag?.category === "hotmoney";
}
