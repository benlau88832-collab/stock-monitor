import { fetchMarketMainFund, fetchNorthbound } from "@/lib/marketData";
import { judgeMarketStructure, upsertSnapshot, getRecentSnapshots } from "@/lib/analysis";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [agg, north] = await Promise.all([fetchMarketMainFund(), fetchNorthbound()]);

    await upsertSnapshot({
      scope: "market",
      code: "SH_SZ",
      name: "沪深两市",
      mainNet: agg.mainNet,
      mainNet5d: agg.mainNet5d,
      mainNet10d: agg.mainNet10d,
      extraLargeNet: agg.extraLargeNet,
      largeNet: agg.largeNet,
      mediumNet: agg.mediumNet,
      smallNet: agg.smallNet,
      northNet: north.available ? north.net : null,
    });

    const structure = judgeMarketStructure({
      mainNet: agg.mainNet,
      extraLargeNet: agg.extraLargeNet,
      largeNet: agg.largeNet,
      mediumNet: agg.mediumNet,
      smallNet: agg.smallNet,
      mainNet5d: agg.mainNet5d,
      mainNet10d: agg.mainNet10d,
      northAvailable: north.available,
      northNet: north.net,
      northNote: north.note,
    });

    const history = await getRecentSnapshots("market", "SH_SZ", 5);

    return Response.json({
      updatedAt: new Date().toISOString(),
      structure,
      history: history.map((h) => ({
        date: h.tradeDate,
        mainNet: h.mainNet,
        smallNet: h.smallNet,
      })),
      source:
        "沪深两市主力/超大单/大单/中单/小单净流入合计：东方财富指数级资金流接口（沪市+深市代理）；北向资金：东方财富沪深港通接口",
    });
  } catch (e: any) {
    return Response.json(
      { updatedAt: new Date().toISOString(), structure: null, message: "资金结构数据获取失败：" + (e?.message || "未知错误") },
      { status: 200 },
    );
  }
}
