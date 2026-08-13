// ============================================================
// 个股评分 · 四象限判断（v9.65 V1-M2：全项目唯一来源）
// v9.137.0（审查 P1-06 修复）：删除死代码 computeStockScores/buildVetoList/StockInput 等 ——
//   原实现全项目零生产调用（grep 0 引用），而 StockWatchlist.tsx 自建同名 buildVetoList
//   （签名/逻辑不同，带公告/新闻/解禁扫描与颜色）才是活实现。双实现并行漂移已收敛：
//   否决逻辑单源 = StockWatchlist.buildVetoList；本文件仅保留被 App.tsx:639/654 消费的
//   judgeFlowType（四象限口径唯一来源，防 drift）。
// ============================================================

export function judgeFlowType(openNet: number, darkNet: number): string {
  if (openNet >= 0 && darkNet >= 0) return "共振流入（看多）";
  if (openNet < 0 && darkNet < 0) return "共振流出（看空）";
  if (openNet >= 0 && darkNet < 0) return "主力承接（分歧偏多）";
  return "主力撤离（分歧偏空）";
}
