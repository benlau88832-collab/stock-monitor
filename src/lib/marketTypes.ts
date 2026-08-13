// ============================================================
// src/lib/marketTypes.ts —— 市场数据契约类型（v9.138.0 阶段二：#17 API 契约共享类型 落地）
// 背景：OverviewData/FundStructureData 等 6 个核心契约原定义在 App.tsx（God Component），
// 17 个组件 `import type from "../App"` 直连页面容器 —— 类型与实现耦合。
// 本文件为唯一权威定义；App.tsx 仅 re-export 保持既有 17 处导入兼容（零改动迁移）。
// 后续新组件一律从本文件导入，禁止再引 "../App"。
// ============================================================
import type {
  IndexQuote,
  MarketBreadth,
  LimitPoolSummary,
  FundSnapshot,
  BoardRankItem,
  BoardStock,
  GlobalIndex,
  BoardFlowItem,
} from "./api";

// ============== 溢价/晋级率计分常量（可调） ==============
/** 溢价因子：溢价1%计1分，clamp在±5（即溢价±5%封顶） */
export const PREMIUM_SCORE_MIN = -5;
export const PREMIUM_SCORE_MAX = 5;
/** 晋级率因子阈值：昨日首板今日继续封板的比例 → ≥50%→+5, ≥30%→+2.5, ≥15%→0, ≥5%→-2.5, <5%→-5 */
export const PROMO_TIER = [
  { threshold: 0.5,  score:  5   },
  { threshold: 0.3,  score:  2.5 },
  { threshold: 0.15, score:  0   },
  { threshold: 0.05, score: -2.5 },
] as const;
export const PROMO_FLOOR_SCORE = -5;

export interface SentimentFactors {
  upDownScore: number;
  limitScore: number;
  avgPctScore: number;
  indexScore: number;
  limitUpBonus: number;
  blastedPenalty: number;
  fundFlowScore: number;
  premiumScore: number;
  promotionScore: number;
}

export interface OverviewData {
  indices: IndexQuote[];
  breadth: MarketBreadth | null;
  sentiment: number | null;
  sentimentLabel: string;
  sentimentFactors: SentimentFactors | null;
  sentimentYesterday: number | null;
  limitPool: LimitPoolSummary | null;
  turnoverAmount: number;
  turnoverYesterday: number | null;
  turnoverAvg5d: number | null;
  premiumAvg: number | null;       // 昨日涨停股今日平均涨幅%
  premiumDist?: {
    ltNeg5: number;   // 昨日涨停今日 < -5%（焖面，亏钱效应）
    neg5to0: number;  // -5% ~ 0%（亏钱）
    zeroTo3: number;  // 0% ~ 3%（平/小赚）
    gt3: number;      // > 3%（连板高溢价，赚钱效应）
  } | null;           // v9.32.1：溢价分布（游资看第一眼的是分布不是均值）
  promotionRate: number | null;    // 2板→3板晋级率(0~1)
  maxBoardHeight: number | null;   // 今日最高连板
  /** v9.77（P0-5 修复）：本轮 overview 抓取完成的时间戳（ms），供组件显示"数据截至 X 秒前" */
  fetchedAt?: number;
  /** v9.85.0（P0-5）：本轮刷新多数数据源失败 → 保留旧值并标记过期（UI 显示"数据已过期"而非误导为最新） */
  stale?: boolean;
  /** v9.113.1（T1-1 D-01 收尾）：结构化字段（涨停/情绪/梯队/溢价/晋级率）数据源元信息 —— 角标显示 PG 快照 asOf；
   *  poolFromPg=true = 当前涨停池为 PG 派生（实时池不可用），UI 明示"PG 快照"不冒充实时 */
  pgMeta?: { source: "pg"; asOf: number; stale: boolean; poolFromPg: boolean } | null;
}

export interface FundStructureData {
  /** v9.53（V7-8）：关键资金字段缺失（东财改字段）→ UI 显示"数据缺失"而非误导 0 */
  dataMissing?: boolean;
  structure: {
    today: { mainNet: number; extraLargeNet: number; largeNet: number; mediumNet: number; smallNet: number };
    mainNet5d: number;
    mainNet10d: number;
    verdict: string;
    vetoTriggered: boolean;
    reasons: string[];
    actionHint: string;
  };
  history: FundSnapshot[];
  boardRank: {
    inflow: BoardRankItem[];
    outflow: BoardRankItem[];
  } | null;
  turnoverAmount: number; // 两市成交额（用于出货强度计算）
}

export interface DarkPoolData {
  // 明盘 = 超大单+大单（明面上的大资金行为）
  // 暗盘 = 中单+小单（看似散户，但可能包含主力拆单的隐蔽资金）
  // 资金总体 = 主力净流入（f62）
  totalFlow: number;      // 资金总体流向（主力净流入）
  openPoolToday: number;  // 今日明盘净流入（超大单+大单）
  darkPoolToday: number;  // 今日暗盘净流入（中单+小单）
  darkPool5d: number;     // 近5日主力净流入
  darkPool10d: number;    // 近10日主力净流入
  marketFlowType: string; // v9.101.0（P2-04 返工）：主力动向判断（四象限：共振流入/共振流出/主力承接/主力撤离）——原"同花顺6种组合"注释与实现不符
  topBoards: Array<{
    code: string;
    name: string;
    pct: number;
    openNet: number;    // 明盘净流入（超大单+大单）
    darkNet: number;    // 暗盘净流入（中单+小单）
    flowType: string;   // 主力动向判断
    boardType: string;
  }>;
  boardStocks: Record<string, BoardStock[]>;
}

export interface GlobalData {
  globalSignals: GlobalIndex[];
  commodities: GlobalIndex[];
  turnover: { amount: number; available: boolean };
}

export interface MainlineData {
  boards: Array<BoardFlowItem & { stage: string; stageReason: string; weight: string }>;
  potential: Array<{
    code: string; name: string; price: number; pct: number;
    mainNet: number; mainNetPct: number; turnoverRate: number; volumeRatio: number;
    pe: number | null; boardName: string; vetoed: boolean; vetoReasons: string[];
    crowding: string;
  }>;
}
