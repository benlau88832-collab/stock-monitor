import { fetchStockOne, fetchPledgeRatio, fetchAnnouncementRisk } from "@/lib/marketData";
import { upsertSnapshot, getRecentSnapshots } from "@/lib/analysis";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const clean = (code || "").trim();
  if (!/^\d{6}$/.test(clean)) {
    return Response.json({ message: "股票代码格式不正确，应为 6 位数字" }, { status: 400 });
  }

  try {
    const [quote, pledge, ann] = await Promise.all([
      fetchStockOne(clean),
      fetchPledgeRatio(clean),
      fetchAnnouncementRisk(clean),
    ]);

    if (!quote) {
      return Response.json({ message: "未获取到该股票行情，请检查代码是否正确" }, { status: 404 });
    }

    await upsertSnapshot({
      scope: "stock",
      code: clean,
      name: quote.name,
      pctChange: quote.pct,
      mainNet: quote.mainNet,
      mainNet5d: quote.mainNet5d,
      mainNet10d: quote.mainNet10d,
      extraLargeNet: quote.extraLargeNet,
      largeNet: quote.largeNet,
      mediumNet: quote.mediumNet,
      smallNet: quote.smallNet,
    });

    const mainOutRetailIn = (quote.mainNet ?? 0) < 0 && (quote.smallNet ?? 0) > 0;
    const persistentOutflow = (quote.mainNet5d ?? 0) < 0 && (quote.mainNet10d ?? 0) < 0;
    const vetoTriggered = mainOutRetailIn && persistentOutflow;

    const history = await getRecentSnapshots("stock", clean, 5);

    return Response.json({
      updatedAt: new Date().toISOString(),
      quote,
      vetoTriggered,
      vetoReason: vetoTriggered
        ? "今日主力净流出+散户净流入，且近5日/10日主力资金持续净流出，一票否决：不建议现在介入"
        : mainOutRetailIn
          ? "今日出现主力净流出+散户净流入迹象，需谨慎"
          : "未触发一票否决规则",
      pledge,
      announcements: ann,
      history: history.map((h) => ({ date: h.tradeDate, mainNet: h.mainNet, smallNet: h.smallNet, pct: h.pctChange })),
      source: "行情与资金流：东方财富 push2 接口；质押：东方财富数据中心；公告：东方财富公告接口",
    });
  } catch (e: any) {
    return Response.json({ message: "个股数据获取失败：" + (e?.message || "未知错误") }, { status: 200 });
  }
}
