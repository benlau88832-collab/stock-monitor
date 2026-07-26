import { fetchIndexOverview, fetchMarketBreadth } from "@/lib/marketData";

export const dynamic = "force-dynamic";

export async function GET() {
  const [indicesResult, breadthResult] = await Promise.allSettled([
    fetchIndexOverview(),
    fetchMarketBreadth(),
  ]);

  const indices = indicesResult.status === "fulfilled" ? indicesResult.value : [];
  const breadth = breadthResult.status === "fulfilled" ? breadthResult.value : null;

  // 情绪温度计：结合涨跌家数占比、涨跌停家数、主要指数涨跌幅 综合打分 0-100
  // 修正版：权重合理分配
  // 1. 涨跌比: 涨跌家数占比（0~100 区间映射到 0~40 分）  
  // 2. 涨跌停差: (涨停 - 跌停) 映射 ±15 分
  // 3. 平均涨跌幅: 映射 ±15 分
  // 4. 主要指数涨跌幅平均: 映射 ±15 分  
  // 5. 基础分 15
  let sentiment = 50;
  let sentimentLabel = "数据不足";
  if (breadth && breadth.total > 0) {
    const upRatio = breadth.up / breadth.total; // 0~1
    const downRatio = breadth.down / breadth.total;

    // 涨跌比得分：0~40分
    // upRatio=0.5 -> 20, upRatio=1 -> 40, upRatio=0 -> 0
    const upDownScore = upRatio * 40;

    // 涨停跌停得分：±15分
    const limitDiff = breadth.limitUp - breadth.limitDown;
    const limitScore = Math.max(-15, Math.min(15, limitDiff * 0.3));

    // 平均涨跌幅得分：±15分
    // avgPct 通常在 -5% ~ +5% 范围
    const avgPctScore = Math.max(-15, Math.min(15, breadth.avgPct * 3));

    // 主要指数涨跌幅得分：±15分
    let indexScore = 0;
    if (indices.length > 0) {
      const avgIndexPct = indices.reduce((s: number, idx: any) => s + (idx.pct ?? 0), 0) / indices.length;
      indexScore = Math.max(-15, Math.min(15, avgIndexPct * 5));
    }

    // 基础分 15
    sentiment = Math.round(upDownScore + limitScore + avgPctScore + indexScore + 15);
    sentiment = Math.max(0, Math.min(100, sentiment));

    if (sentiment >= 75) sentimentLabel = "极度亢奋（注意追高风险）";
    else if (sentiment >= 60) sentimentLabel = "偏热（注意控制仓位）";
    else if (sentiment >= 50) sentimentLabel = "偏暖";
    else if (sentiment >= 40) sentimentLabel = "中性";
    else if (sentiment >= 30) sentimentLabel = "偏冷";
    else if (sentiment >= 20) sentimentLabel = "恐慌（关注超跌机会）";
    else sentimentLabel = "极度悲观（警惕恐慌踩踏）";
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
