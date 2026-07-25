import { fetchIndexOverview, fetchMarketBreadth } from "@/lib/marketData";

export const dynamic = "force-dynamic";

export async function GET() {
  const [indicesResult, breadthResult] = await Promise.allSettled([
    fetchIndexOverview(),
    fetchMarketBreadth(),
  ]);

  const indices = indicesResult.status === "fulfilled" ? indicesResult.value : [];
  const breadth = breadthResult.status === "fulfilled" ? breadthResult.value : null;

  // 情绪温度计：结合涨跌家数占比、涨停跌停家数、指数涨跌幅 综合打分 0-100
  let sentiment = 50;
  let sentimentLabel = "数据不足";
  if (breadth && breadth.total > 0) {
    const upRatio = breadth.up / breadth.total;
    const limitScore = Math.max(-20, Math.min(20, (breadth.limitUp - breadth.limitDown) * 1.5));
    const avgPctScore = Math.max(-15, Math.min(15, breadth.avgPct * 4));
    sentiment = Math.round(upRatio * 60 + limitScore + avgPctScore + 20);
    sentiment = Math.max(0, Math.min(100, sentiment));
    if (sentiment >= 70) sentimentLabel = "偏热（注意追高风险）";
    else if (sentiment >= 55) sentimentLabel = "偏暖";
    else if (sentiment >= 40) sentimentLabel = "中性";
    else if (sentiment >= 25) sentimentLabel = "偏冷";
    else sentimentLabel = "极度悲观（警惕恐慌）";
  }

  return Response.json({
    updatedAt: new Date().toISOString(),
    indices,
    indicesAvailable: indicesResult.status === "fulfilled",
    breadth,
    breadthAvailable: breadthResult.status === "fulfilled",
    sentiment,
    sentimentLabel,
    source: "东方财富 push2 行情接口（实时）",
  });
}
