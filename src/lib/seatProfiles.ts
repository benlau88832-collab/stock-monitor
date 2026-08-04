// 席位档案：知名游资/机构营业部标签库（可自行扩充）
// 统一维护，龙虎榜组件和席位台账共同引用
// 注意：游资有合并/改名历史（国泰君安→国泰海通、华信证券更名等），同一席位的新旧名都应覆盖。

export interface SeatTag {
  keywords: string[];
  label: string;
  color: string;
  // 分类：机构/北向/知名游资/量化
  category: "institution" | "northbound" | "hotmoney" | "quant";
}

// ============== 颜色工具 ==============
// 不同游资用不同颜色，便于一眼分辨谁在买/谁在卖
const C = {
  inst: "bg-slate-500/20 text-slate-300",   // 机构专用
  north: "bg-sky-500/20 text-sky-300",       // 沪深股通
  fund: "bg-violet-500/20 text-violet-300",  // 知名游资（通用）
  top: "bg-rose-500/20 text-rose-300",       // 顶级游资（章盟主/赵老哥/炒股养家等）
  quant: "bg-fuchsia-500/20 text-fuchsia-300", // 量化
  hot1: "bg-amber-500/20 text-amber-300",    // 知名游资分支 1
  hot2: "bg-emerald-500/20 text-emerald-300", // 知名游资分支 2
  hot3: "bg-orange-500/20 text-orange-300",   // 知名游资分支 3
};

export const SEAT_PROFILES: SeatTag[] = [
  // ============== 机构 / 北向 ==============
  { keywords: ["机构专用"], label: "机构席位", color: C.inst, category: "institution" },
  { keywords: ["沪股通专用", "深股通专用"], label: "沪深股通", color: C.north, category: "northbound" },
  // QFII/社保/养老金专户
  { keywords: ["瑞银", "摩根大通", "摩根士丹利", "高盛", "美林", "巴克莱", "花旗", "汇丰"], label: "外资席位", color: C.north, category: "northbound" },
  // 量化
  { keywords: ["量化", "对冲", "AI智能"], label: "量化席位", color: C.quant, category: "quant" },

  // ============== 顶级游资（曝光度最高，5位） ==============
  // 章盟主（原国泰君安上海江苏路）
  { keywords: ["国泰海通上海江苏路", "国泰君安上海江苏路", "上海江苏路"], label: "章盟主", color: C.top, category: "hotmoney" },
  // 赵老哥（中国银河绍兴）
  { keywords: ["中国银河绍兴", "中国银河北京阜成路", "银河绍兴", "阜成路"], label: "赵老哥", color: C.top, category: "hotmoney" },
  // 炒股养家（华鑫证券上海分公司）
  { keywords: ["华鑫证券上海分公司", "华鑫上海分", "华鑫证券上海长宁"], label: "炒股养家", color: C.top, category: "hotmoney" },
  // 佛山无影脚（财通证券佛山新城等）
  { keywords: ["财通证券佛山新城", "财通佛山", "湘财证券佛山", "长城证券佛山", "佛山季华五路"], label: "佛山系", color: C.top, category: "hotmoney" },
  // 欢乐海（财通证券杭州延安路）
  { keywords: ["财通证券杭州延安路", "财通杭州延安路"], label: "欢乐海", color: C.top, category: "hotmoney" },

  // ============== 知名游资（次级，主流席位） ==============
  // 作手新一（财通证券杭州解放路）
  { keywords: ["财通证券杭州解放路", "财通杭州解放路", "华泰上海共和新路"], label: "作手新一", color: C.hot1, category: "hotmoney" },
  // 苏南帮（华泰证券苏州人民路）
  { keywords: ["华泰证券苏州人民路", "华泰苏州人民路", "东吴证券苏州"], label: "苏南帮", color: C.hot1, category: "hotmoney" },
  // 益田路荣超（招商证券深圳益田路）
  { keywords: ["招商证券深圳益田路", "招商益田路", "中信证券深圳益田路", "深圳益田路荣超"], label: "益田路荣超", color: C.hot1, category: "hotmoney" },
  // 思明南路（财通证券厦门思明南路）
  { keywords: ["财通证券厦门思明南路", "华鑫证券厦门思明南路"], label: "思明南路", color: C.hot1, category: "hotmoney" },
  // 章牛（国海证券济南）
  { keywords: ["国海证券济南"], label: "章牛", color: C.hot2, category: "hotmoney" },
  // 上海超短帮（东方证券上海分公司）
  { keywords: ["东方证券上海分公司", "东方证券上海浦东新区源深路", "上海源深路"], label: "上海超短帮", color: C.hot2, category: "hotmoney" },
  // 中信建投系（杭州庆春路、上海溧阳路等）
  { keywords: ["中信建投杭州庆春路", "中信证券上海溧阳路", "中信证券上海分公司"], label: "中信系游资", color: C.hot2, category: "hotmoney" },
  // 孙哥（中信证券上海溧阳路，单独标注可识别）
  { keywords: ["中信证券上海古北路", "中信证券上海溧阳路"], label: "孙哥", color: C.hot3, category: "hotmoney" },
  // 财通杭州系列（解放路、延安路、绍兴）— 赵老哥兄弟
  { keywords: ["财通证券绍兴", "财通证券杭州"], label: "财通杭州系", color: C.hot3, category: "hotmoney" },
  // 东兴证券系列
  { keywords: ["东兴证券北京"], label: "东兴北京系", color: C.hot3, category: "hotmoney" },
  // 太平洋证券系列
  { keywords: ["太平洋证券"], label: "太平洋系", color: C.hot3, category: "hotmoney" },
  // 拉萨帮（东方财富多个）
  { keywords: ["东方财富拉萨", "东财拉萨", "拉萨东环", "拉萨团结路", "拉萨金珠西路", "拉萨八一路"], label: "拉萨帮", color: C.fund, category: "hotmoney" },
  // 招商系（深圳蛇口工业八路等）
  { keywords: ["招商证券深圳蛇口工业八路", "招商证券深圳"], label: "招商深圳系", color: C.fund, category: "hotmoney" },
  // 中金财富系列
  { keywords: ["中国中金财富"], label: "中金财富系", color: C.fund, category: "hotmoney" },
  // 开源证券系
  { keywords: ["开源证券西安太华路", "开源证券"], label: "开源系", color: C.fund, category: "hotmoney" },
  // 国泰海通成都北一环
  { keywords: ["国泰海通成都北一环", "国泰君安成都北一环"], label: "成都北一环", color: C.fund, category: "hotmoney" },
  // 华泰南京太平南路
  { keywords: ["华泰证券南京太平南路", "华泰南京太平南路"], label: "南京太平南路", color: C.fund, category: "hotmoney" },
  // 华泰证券佛山
  { keywords: ["华泰证券佛山"], label: "华泰佛山", color: C.fund, category: "hotmoney" },
  // 平安证券系
  { keywords: ["平安证券深圳"], label: "平安深圳", color: C.fund, category: "hotmoney" },
  // 国海证券系
  { keywords: ["国海证券"], label: "国海系", color: C.fund, category: "hotmoney" },
  // 兴业证券系
  { keywords: ["兴业证券厦门", "兴业证券福州"], label: "兴业福建系", color: C.fund, category: "hotmoney" },
  // 申万宏源系
  { keywords: ["申万宏源证券上海", "申万宏源证券"], label: "申万宏源系", color: C.fund, category: "hotmoney" },
  // 海通证券系（合并前）
  { keywords: ["海通证券上海", "海通证券南京"], label: "海通系", color: C.fund, category: "hotmoney" },
];

/** 匹配席位标签（按优先级：顶级游资 > 知名游资 > 机构）
 *  v9.26.10：标准化去噪后匹配 —— 东财全称常含"证券/股份有限公司"等插入词，
 *  如"中国银河证券绍兴解放大道"对关键词"中国银河绍兴"的连续 includes 失败。
 *  策略：双方去除公司后缀词后，检查关键词所有 token 按序包含。 */
function normalizeDept(s: string): string {
  return s
    .replace(/股份有限公司/g, "")
    .replace(/有限责任公司/g, "")
    .replace(/有限公司/g, "")
    .replace(/证券营业部/g, "营业部")
    .replace(/证券股份/g, "")
    .replace(/证券/g, "");
}

/** 宽松匹配：关键词的每一段（按"营业部/解放大道/绍兴"等分隔符拆）都按序出现在去噪后的全称里 */
function fuzzyMatch(deptNorm: string, kw: string): boolean {
  if (deptNorm.includes(kw)) return true; // 常规连续匹配优先
  // 拆关键词为 token（保留 2 字以上片段），逐个按序查找
  const tokens = kw.split(/[·,，、/（）()\s]+/).filter(t => t.length >= 2);
  if (tokens.length <= 1) return deptNorm.includes(kw);
  let idx = 0;
  for (const tok of tokens) {
    const found = deptNorm.indexOf(tok, idx);
    if (found < 0) return false;
    idx = found + tok.length;
  }
  return true;
}

export function matchSeatTag(deptName: string): SeatTag | null {
  const deptNorm = normalizeDept(deptName);
  for (const tag of SEAT_PROFILES) {
    if (tag.keywords.some(kw => fuzzyMatch(deptNorm, normalizeDept(kw)))) return tag;
  }
  return null;
}

/** 判断是否为游资席位（用于合力判断） */
export function isHotMoneySeat(deptName: string): boolean {
  const tag = matchSeatTag(deptName);
  return tag?.category === "hotmoney";
}

/** 判断是否为顶级游资（用于高亮显示） */
export function isTopHotMoney(deptName: string): boolean {
  const tag = matchSeatTag(deptName);
  return tag?.color === C.top;
}
