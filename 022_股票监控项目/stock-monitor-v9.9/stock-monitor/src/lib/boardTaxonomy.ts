// 全局板块分类模块（全仓唯一分类源）
// 彻底区分"行业/题材/风格标签/地域"

// ============== 类型 ==============
export type BoardKind = "industry" | "theme" | "style" | "region";

// ============== 白名单（可维护：命中即判 "theme"） ==============
// 如想炒次新行情可填"次新股"，临时加入后重新构建即可
export const BOARD_WHITELIST: string[] = [];

// ============== 风格/标签黑名单（判 "style"） ==============
const STYLE_NAMES: string[] = [
  // 指数成分标签
  "融资融券", "MSCI中国", "富时罗素", "标准普尔", "沪股通", "深股通",
  "HS300", "深成500", "上证180", "中证500", "中证1000", "深证100",
  "上证50", "创业成份", "创业板综", "AH股", "B股",
  // 风格/规模分类
  "大盘股", "中盘股", "小盘股", "大盘成长", "大盘价值", "中盘成长",
  "中盘价值", "小盘成长", "小盘价值", "百元股",
  // 持股主体标签
  "基金重仓", "社保重仓", "险资重仓", "券商重仓", "QFII重仓",
  "证金持股", "养老金持股", "国家队", "举牌", "机构重仓",
  // 行为标签
  "增持回购", "送转预期", "高送转", "壳资源", "低价股", "摘帽",
  // 昨日行情标签
  "昨日高振幅", "昨日涨停", "昨日跌停", "昨日连板", "昨日触板",
  "东方财富热股", "周期股", "消费风格", "科技风格", "金融风格",
  "红利破净股", "红利风格",
];

// ============== 模式规则 ==============
// 含4位年份且含"报/季"（如 "2026中报预增"）
const REPORT_PERIOD_RE = /\d{4}.*(报|季)/;
// 业绩变动标签
const PERFORMANCE_RE = /预增|预减|预升|预降|扭亏|续亏|首亏|减亏|预盈/;
// "重仓/持股"结尾
const HOLDING_END_RE = /(重仓|持股)$/;
// "增持/回购"结尾
const BUYBACK_END_RE = /(增持|回购)$/;
// "次新股""ST""破净"开头
const SPECIAL_START_RE = /^(次新股|ST|破净)/;
// "板块"二字结尾（地域板块如"安徽板块""浙江板块"）
const REGION_END_RE = /板块$/;

// ============== 核心分类函数 ==============
/**
 * 判定板块类型
 * @param name 板块名称
 * @param channel 数据频道来源（industry=t:2, concept=t:3, region=t:1）
 */
export function classifyBoard(name: string, channel?: "industry" | "concept" | "region"): BoardKind {
  // 1. 白名单优先
  if (BOARD_WHITELIST.includes(name)) return "theme";

  // 2. 频道直判
  if (channel === "region") return "region";

  // 3. 规则判 "style"
  // 3a. 名单匹配
  if (STYLE_NAMES.some(kw => name.includes(kw))) return "style";
  // 3b. 模式规则
  if (REPORT_PERIOD_RE.test(name)) return "style";
  if (PERFORMANCE_RE.test(name)) return "style";
  if (HOLDING_END_RE.test(name)) return "style";
  if (BUYBACK_END_RE.test(name)) return "style";
  if (SPECIAL_START_RE.test(name)) return "style";
  // 以"板块"结尾判地域
  if (REGION_END_RE.test(name)) return "region";
  // 下划线结尾通常是指数标签
  if (name.endsWith("_")) return "style";

  // 4. industry 频道判行业
  if (channel === "industry") return "industry";

  // 5. 剩余 concept 频道判题材
  return "theme";
}

/** 兼容包装：保持现有调用方签名不变 */
export function isRealConceptBoard(name: string): boolean {
  return classifyBoard(name) === "theme";
}
