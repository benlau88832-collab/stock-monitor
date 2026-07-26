import { fetchGlobalIndices, fetchMarketTurnover } from "@/lib/marketData";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [globalResult, turnoverResult] = await Promise.allSettled([
      fetchGlobalIndices(),
      fetchMarketTurnover(),
    ]);

    const globalSignals = globalResult.status === "fulfilled" ? globalResult.value : [];
    const turnover = turnoverResult.status === "fulfilled" ? turnoverResult.value : { amount: 0, available: false };

    return Response.json({
      updatedAt: new Date().toISOString(),
      globalSignals,
      turnover,
      available: globalSignals.length > 0,
      source: "东方财富全球市场接口（实时数据）",
    });
  } catch (e: any) {
    return Response.json({
      updatedAt: new Date().toISOString(),
      globalSignals: [],
      turnover: { amount: 0, available: false },
      available: false,
      message: "全球信号数据获取失败：" + (e?.message || "未知错误"),
      source: "东方财富全球市场接口",
    }, { status: 200 });
  }
}
