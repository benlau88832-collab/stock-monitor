// 题材梯队纯函数：输入涨停池数组，输出按行业(hybk)分组的题材梯队
// 为什么是纯函数：不碰 DOM / localStorage / 网络，便于单测与多处复用
// v11-11（P0）：分组改用全站唯一分类器 classifyStock（hybk 折叠到大类）
import { classifyStock } from "./classifyStock";

/** 涨停池单股原始数据（与 api.ts ZTPool 字段对齐） */
export interface ZTPoolItem {
  c: string;    // 代码
  n: string;    // 名称
  p: number;    // 价格(×1000)
  zdp: number;  // 涨幅
  lbc: number;  // 连板数
  fbt: number;  // 首封时间 HHMMSS
  lbt: number;  // 最后封板时间
  fund: number; // 封板资金(元)
  zbc: number;  // 炸板次数
  hybk: string; // 所属行业
  amount: number; // 成交额
  hs: number;   // 换手率
}

/** 题材组内单股视图 */
export interface ThemeStock {
  code: string;
  name: string;
  price: number;       // 已除1000
  pct: number;         // 涨幅%
  boardCount: number;  // 连板数
  firstBoardTime: string; // HH:MM:SS 格式
  sealFund: number;    // 封板资金(元)
  turnoverRate: number; // 换手率
  amount: number;      // 成交额(元)
  blastCount: number;  // 炸板次数
}

/** 梯队分层统计 */
export interface TierCounts {
  first: number;   // 首板数(lbc=1)
  second: number;  // 二板数(lbc=2)
  thirdPlus: number; // 三板及以上(lbc≥3)
}

/** 单个题材组输出 */
export interface ThemeGroup {
  theme: string;       // 行业名(hybk)
  height: number;      // 组内最高连板数
  count: number;       // 组内涨停总数
  tiers: TierCounts;   // 梯队层级统计
  /** 组内 fbt 最早的个股 = 先锋 */
  pioneer: { code: string; name: string; firstBoardTime: string } | null;
  /** 组内成交额最大的个股 = 中军 */
  bellwether: { code: string; name: string; amount: number } | null;
  /** 组内全部个股（按 lbc 降序） */
  stocks: ThemeStock[];
  /** 梯队是否断档：高度≥2但缺少某一层 */
  gapTiers: number[]; // 缺失的层级编号(1=首板,2=二板 等)
}

/** 格式化封板时间：093012 → "09:30:12" */
function fmtFbt(t: number): string {
  const s = String(t).padStart(6, "0");
  return `${s.slice(0, 2)}:${s.slice(2, 4)}:${s.slice(4, 6)}`;
}

/**
 * 将涨停池原始数据按 hybk 分组，计算梯队信息
 * 排序规则：height 降序 → 组内涨停数降序
 */
export function buildThemeLadder(pool: ZTPoolItem[]): ThemeGroup[] {
  if (!pool || pool.length === 0) return [];

  // v11-11（P0）：按 classifyStock 唯一分类器分组（hybk 折叠到大类：通信设备→通信）
  const groupMap = new Map<string, ZTPoolItem[]>();
  for (const item of pool) {
    const key = classifyStock(String(item.c ?? ""), [], item.hybk).mainline;
    const arr = groupMap.get(key) ?? [];
    arr.push(item);
    groupMap.set(key, arr);
  }

  return buildGroupsFromMap(groupMap);
}

// ============== v9.26.15 方案A：概念级聚类 ==============
/**
 * 按"概念归属"聚类（一对多展开：一只涨停股可属多个概念）
 * 与开盘啦/同花顺口径一致 —— 解决 hybk 行业粒度太细、无法识别"通信/AI应用/算力"等概念的问题
 * @param pool    涨停池原始数据
 * @param conceptOf  code → 折叠后的概念大类列表（来自 datacenter RPT_F10_CORETHEME_BOARDTYPE + conceptGroups 折叠）
 * @param fallback   无概念数据时的回退分组键（默认 hybk）
 */
export function buildThemeLadderByConcept(
  pool: ZTPoolItem[],
  conceptOf: (code: string) => string[] | null,
  fallback: (item: ZTPoolItem) => string = (item) => item.hybk || "其他",
): ThemeGroup[] {
  if (!pool || pool.length === 0) return [];

  const groupMap = new Map<string, ZTPoolItem[]>();
  for (const item of pool) {
    const concepts = conceptOf(String(item.c ?? ""));
    const keys = concepts && concepts.length > 0 ? concepts : [fallback(item)];
    for (const key of keys) {
      const arr = groupMap.get(key) ?? [];
      arr.push(item);
      groupMap.set(key, arr);
    }
  }

  return buildGroupsFromMap(groupMap);
}

/** 从"分组名 → 涨停股[]"构建 ThemeGroup[]（公共逻辑：高度/先锋/中军/梯队/断档/排序） */
function buildGroupsFromMap(groupMap: Map<string, ZTPoolItem[]>): ThemeGroup[] {
  const groups: ThemeGroup[] = [];

  for (const [theme, items] of groupMap) {
    // 计算高度（组内最高连板数）
    let height = 0;
    let minFbt = Infinity; // 用于找先锋
    let maxAmount = -1;    // 用于找中军
    let pioneerItem: ZTPoolItem | null = null;
    let bellwetherItem: ZTPoolItem | null = null;

    const tiers: TierCounts = { first: 0, second: 0, thirdPlus: 0 };

    for (const item of items) {
      const lbc = item.lbc ?? 1;
      if (lbc > height) height = lbc;
      if (lbc === 1) tiers.first++;
      else if (lbc === 2) tiers.second++;
      else tiers.thirdPlus++;

      // 先锋 = fbt 最小（最早封板）
      const fbt = item.fbt ?? 999999;
      if (fbt < minFbt) {
        minFbt = fbt;
        pioneerItem = item;
      }
      // 中军 = 成交额最大
      const amt = item.amount ?? 0;
      if (amt > maxAmount) {
        maxAmount = amt;
        bellwetherItem = item;
      }
    }

    // 转换为 ThemeStock 并按 lbc 降序排列
    const stocks: ThemeStock[] = items
      .map((item) => ({
        code: String(item.c ?? ""),
        name: String(item.n ?? ""),
        price: (item.p ?? 0) / 1000,
        pct: item.zdp ?? 0,
        boardCount: item.lbc ?? 1,
        firstBoardTime: fmtFbt(item.fbt ?? 0),
        sealFund: item.fund ?? 0,
        turnoverRate: item.hs ?? 0,
        amount: item.amount ?? 0,
        blastCount: item.zbc ?? 0,
      }))
      .sort((a, b) => b.boardCount - a.boardCount || b.amount - a.amount);

    // 检测断档：高度≥2 时，检查从1到height的每一层是否有股票
    const gapTiers: number[] = [];
    if (height >= 2) {
      // 统计每个层级的数量
      const tierMap = new Map<number, number>();
      for (const item of items) {
        const lbc = item.lbc ?? 1;
        tierMap.set(lbc, (tierMap.get(lbc) ?? 0) + 1);
      }
      for (let lvl = 1; lvl < height; lvl++) {
        if (!tierMap.has(lvl)) {
          gapTiers.push(lvl);
        }
      }
    }

    groups.push({
      theme,
      height,
      count: items.length,
      tiers,
      pioneer: pioneerItem
        ? { code: String(pioneerItem.c), name: String(pioneerItem.n), firstBoardTime: fmtFbt(pioneerItem.fbt ?? 0) }
        : null,
      bellwether: bellwetherItem
        ? { code: String(bellwetherItem.c), name: String(bellwetherItem.n), amount: bellwetherItem.amount ?? 0 }
        : null,
      stocks,
      gapTiers,
    });
  }

  // 排序：height 降序 → count 降序
  groups.sort((a, b) => b.height - a.height || b.count - a.count);

  return groups;
}

// ============== 断板检测 ==============
/** 昨日快照中 lbc≥3 但今日不在池中的个股 */
export interface BrokenBoardItem {
  code: string;
  name: string;
  yesterdayLbc: number;
}

/**
 * 比对昨日快照与今日池，找出断板个股
 * @param yesterdayPool 昨日涨停池原始数据
 * @param todayPool    今日涨停池原始数据
 */
export function detectBrokenBoards(
  yesterdayPool: ZTPoolItem[],
  todayPool: ZTPoolItem[],
): BrokenBoardItem[] {
  if (!yesterdayPool || yesterdayPool.length === 0) return [];

  const todayCodes = new Set(todayPool.map((item) => String(item.c)));
  const broken: BrokenBoardItem[] = [];

  for (const item of yesterdayPool) {
    const lbc = item.lbc ?? 1;
    if (lbc >= 3 && !todayCodes.has(String(item.c))) {
      broken.push({
        code: String(item.c),
        name: String(item.n),
        yesterdayLbc: lbc,
      });
    }
  }

  // 按昨日连板数降序
  broken.sort((a, b) => b.yesterdayLbc - a.yesterdayLbc);

  return broken;
}

// ============== 高低切切换检测（纯函数） ==============
// 条件A（旧主线熄火）：近5日主力净流入 Top3 题材，今日涨幅<0
//   且组内合计成交额 > 近5日均值×1.2（放量不涨）
// 条件B（新题材脉冲）：某题材昨日涨停 0 只、今日 ≥3 只首板
// A+B → amber 级; 仅B → info 级

/** 板块资金流数据（从 App.tsx 的 MainlineData.boards 透传） */
export interface BoardFlowBrief {
  name: string;       // 板块名
  pct: number;        // 今日涨幅
  mainNet5d: number;  // 近5日主力净流入
}

// ---- 阈值常量（提取为常量便于调参和审计） ----

/** 条件A：近5日净流入 Top N 题材算"旧主线" */
const OLD_MAINLINE_TOP_N = 3;
/** 条件A：今日涨幅低于此值视为"不涨"（%）
 *  依据：板块涨幅 <0% 说明资金已经在获利了结 */
const OLD_MAINLINE_PCT_THRESHOLD = 0;
/** 条件A：成交额放量倍率阈值（相对近5日均值）
 *  依据：1.2x 放量说明参与度高但拉不动，机构可能在出货 */
/** 条件B：新题材今日首板最低数量
 *  依据：≥3只首板说明非偶发，有板块效应 */
const NEW_THEME_MIN_FIRST_BOARD = 3;

export interface HighLowSwitchResult {
  /** 条件A命中的旧主线题材 */
  stalledOld: string[];
  /** 条件B命中的新题材名 */
  pulseNew: string[];
  /** 是否 A+B 同时成立 */
  fullSwitch: boolean;
  /** 无昨日快照 → true */
  noYesterdayData: boolean;
}

/**
 * 检测高低切切换信号
 * @param boards     今日概念板块资金流 Top 排序（从 mainline.boards 获取）
 * @param todayPool  今日涨停池原始数据
 * @param yesterdayPool 昨日涨停池原始数据（null=无快照）
 */
export function detectHighLowSwitch(
  boards: BoardFlowBrief[],
  todayPool: ZTPoolItem[],
  yesterdayPool: ZTPoolItem[] | null,
): HighLowSwitchResult {
  const result: HighLowSwitchResult = {
    stalledOld: [],
    pulseNew: [],
    fullSwitch: false,
    noYesterdayData: !yesterdayPool || yesterdayPool.length === 0,
  };

  // ---- 条件A：旧主线熄火 ----
  // 取近5日主力净流入 Top3 的板块
  const sorted5d = [...boards].sort((a, b) => b.mainNet5d - a.mainNet5d);
  const top3Old = sorted5d.slice(0, OLD_MAINLINE_TOP_N);
  for (const board of top3Old) {
    // 今日涨幅 < 0
    if (board.pct < OLD_MAINLINE_PCT_THRESHOLD) {
      // 注意：成交额放量需要历史均值数据，但现有板块接口无直接均值字段
      // 这里用 mainNet5d > 0 作为"曾经是热门"的代理，涨幅转负作为核心信号
      // 更精确的放量判断留待接入板块日成交额历史后升级
      result.stalledOld.push(board.name);
    }
  }

  // ---- 条件B：新题材脉冲 ----
  if (!result.noYesterdayData && yesterdayPool) {
    // 昨日按 hybk 统计涨停数
    const yesterdayThemeCounts = new Map<string, number>();
    for (const item of yesterdayPool) {
      const key = item.hybk || "其他";
      yesterdayThemeCounts.set(key, (yesterdayThemeCounts.get(key) ?? 0) + 1);
    }

    // 今日按 hybk 统计首板数（lbc=1）
    const todayFirstBoard = new Map<string, number>();
    for (const item of todayPool) {
      if ((item.lbc ?? 1) === 1) {
        const key = item.hybk || "其他";
        todayFirstBoard.set(key, (todayFirstBoard.get(key) ?? 0) + 1);
      }
    }

    // 昨日 0 只 且 今日 ≥3 只首板
    for (const [theme, count] of todayFirstBoard) {
      const yesterdayCount = yesterdayThemeCounts.get(theme) ?? 0;
      if (yesterdayCount === 0 && count >= NEW_THEME_MIN_FIRST_BOARD) {
        result.pulseNew.push(theme);
      }
    }
  }

  // ---- 综合判断 ----
  result.fullSwitch = result.stalledOld.length > 0 && result.pulseNew.length > 0;

  return result;
}
