// v9.103.0（T-D1）：外围映射表类型声明（运行时数据在 overseas-map.js，前后端同源）
export interface OverseasMapItem {
  source: string;
  aBoard: string;
  stocks: string[];
  chain: string;
  weight: number;
  lag: string;
  confidence: string;
  kws: string[];
}
export declare const OVERSEAS_MAP: OverseasMapItem[];
export declare function matchOverseas(text: string): OverseasMapItem[];
