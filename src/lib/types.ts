export interface IndexQuote {
  code: string;
  name: string;
  price: number;
  pct: number;
  change: number;
}

export interface MarketBreadth {
  total: number;
  up: number;
  down: number;
  flat: number;
  limitUp: number;
  limitDown: number;
  avgPct: number;
}

export interface FundFlowRow {
  code: string;
  name: string;
  price?: number;
  pct?: number;
  mainNet: number;
  mainNetPct?: number;
  extraLargeNet?: number;
  largeNet?: number;
  mediumNet?: number;
  smallNet?: number;
  mainNet5d?: number;
  mainNet5dPct?: number;
  mainNet10d?: number;
  mainNet10dPct?: number;
  turnoverRate?: number;
  volumeRatio?: number;
  pe?: number;
}

export type Verdict = "danger" | "warning" | "caution" | "healthy" | "unknown";

export interface MarketFundStructure {
  available: boolean;
  message?: string;
  today: {
    mainNet: number;
    extraLargeNet: number;
    largeNet: number;
    mediumNet: number;
    smallNet: number;
  };
  mainNet5d: number;
  mainNet10d: number;
  north: {
    available: boolean;
    net: number;
    note: string;
  };
  verdict: Verdict;
  vetoTriggered: boolean;
  reasons: string[];
  actionHint: string;
}

export type MainlineStage = "启动期" | "发酵期" | "高潮期" | "退潮期" | "观察中";

export interface MainlineBoard {
  code: string;
  name: string;
  boardType: "industry" | "concept" | "region";
  pct: number;
  mainNet: number;
  mainNetPct: number;
  mainNet5dPct: number;
  mainNet10dPct: number;
  stage: MainlineStage;
  stageReason: string;
  weight: "推荐关注" | "谨慎参与" | "降级观察";
}

export interface PotentialStock {
  code: string;
  name: string;
  price: number;
  pct: number;
  mainNet: number;
  mainNetPct: number;
  turnoverRate: number;
  volumeRatio: number;
  pe: number | null;
  boardName: string;
  vetoed: boolean;
  vetoReasons: string[];
  crowding: "极度拥挤" | "偏高" | "正常";
  riskTags: string[];
}

export interface RiskItem {
  type: string;
  level: "high" | "medium" | "low";
  detail: string;
  source: string;
}

export interface StockRiskRadar {
  code: string;
  name: string;
  available: boolean;
  pledgeRatio: number | null;
  pledgeDate: string | null;
  items: RiskItem[];
  vetoTriggered: boolean;
}
