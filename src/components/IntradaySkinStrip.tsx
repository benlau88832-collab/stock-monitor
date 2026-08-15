// ============================================================
// IntradaySkinStrip.tsx —— 盘中皮肤水平条（v9.149.0 B2）
// 把原来埋在"完整驾驶舱"折叠里的盘中组件（指数带/涨停温度/异动条）提为第一层下方一条水平条。
// 结构：横向网格 3 个（IndexStrip / LimitTempBar / AnomalyStrip）；GateGauge 因依赖 gate 计算留在研究台。
// ============================================================
import { IndexStrip, LimitTempBar, AnomalyStrip, type WatchStockBrief } from "./dashboard/DashboardWidgets";
import type { OverviewData } from "../lib/marketTypes";

interface Props {
  overview: OverviewData | null;
  watchStocks: WatchStockBrief[];
  mainlines: string[];
}

export default function IntradaySkinStrip({ overview, watchStocks, mainlines }: Props) {
  if (!overview) return null;
  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-3 rounded-xl border border-white/10 bg-white/5 p-2">
      <IndexStrip overview={overview} />
      <LimitTempBar overview={overview} />
      <AnomalyStrip stocks={watchStocks} mainlines={mainlines} ztPool={overview?.limitPool?.rawZTPool ?? []} />
    </div>
  );
}
