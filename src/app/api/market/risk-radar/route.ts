import { fetchPledgeRatio, fetchFinanceIndicator, fetchAnnouncementRisk, fetchStockBatch } from "@/lib/marketData";
import type { RiskItem, StockRiskRadar } from "@/lib/types";
import { db } from "@/db";
import { watchlist } from "@/db/schema";

export const dynamic = "force-dynamic";

async function buildRiskRadar(code: string, name: string): Promise<StockRiskRadar> {
  const [pledge, finance, ann] = await Promise.all([
    fetchPledgeRatio(code),
    fetchFinanceIndicator(code),
    fetchAnnouncementRisk(code),
  ]);

  const items: RiskItem[] = [];

  if (pledge.ratio != null) {
    if (pledge.ratio >= 50) {
      items.push({
        type: "股权质押风险",
        level: "high",
        detail: `控股股东/重要股东质押比例达 ${pledge.ratio}%（${pledge.date}），平仓风险较高`,
        source: "东方财富股权质押数据",
      });
    } else if (pledge.ratio >= 30) {
      items.push({
        type: "股权质押风险",
        level: "medium",
        detail: `质押比例 ${pledge.ratio}%（${pledge.date}），需持续关注`,
        source: "东方财富股权质押数据",
      });
    }
  }

  if (ann.available) {
    if (ann.reduction.length) {
      items.push({
        type: "大股东减持窗口",
        level: "high",
        detail: `近期公告：${ann.reduction[0].title}（${ann.reduction[0].date}）`,
        source: "东方财富公告",
      });
    }
    if (ann.regulatory.length) {
      items.push({
        type: "监管/问询风险",
        level: "high",
        detail: `近期公告：${ann.regulatory[0].title}（${ann.regulatory[0].date}）`,
        source: "东方财富公告",
      });
    }
  }

  if (finance) {
    if ((finance.cashFlowPerShare != null && finance.cashFlowPerShare < 0) || (finance.cashFlowToRevenue != null && finance.cashFlowToRevenue < 0)) {
      items.push({
        type: "现金流恶化预警",
        level: "medium",
        detail: `最近报告期（${finance.reportDate}）经营性现金流为负，需关注造血能力`,
        source: "东方财富财务主要指标",
      });
    }
    if ((finance.currentRatio != null && finance.currentRatio < 1) || (finance.quickRatio != null && finance.quickRatio < 0.8)) {
      items.push({
        type: "短期偿债压力",
        level: "medium",
        detail: `流动比率 ${finance.currentRatio ?? "N/A"} / 速动比率 ${finance.quickRatio ?? "N/A"}（${finance.reportDate}），短期偿债能力偏弱`,
        source: "东方财富财务主要指标",
      });
    }
    if (finance.debtRatio != null && finance.debtRatio > 70) {
      items.push({
        type: "资产负债率偏高",
        level: "low",
        detail: `资产负债率 ${finance.debtRatio.toFixed(1)}%（${finance.reportDate}）`,
        source: "东方财富财务主要指标",
      });
    }
  }

  return {
    code,
    name,
    available: true,
    pledgeRatio: pledge.ratio,
    pledgeDate: pledge.date,
    items,
    vetoTriggered: items.some((i) => i.level === "high"),
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const codesParam = searchParams.get("codes");
  let codes: { code: string; name: string }[] = [];

  if (codesParam) {
    codes = codesParam
      .split(",")
      .filter(Boolean)
      .map((c) => ({ code: c.trim(), name: c.trim() }));
  } else {
    try {
      const rows = await db.select().from(watchlist).limit(10);
      codes = rows.map((r) => ({ code: r.code, name: r.name }));
    } catch {
      codes = [];
    }
  }

  if (!codes.length) {
    return Response.json({ updatedAt: new Date().toISOString(), items: [], message: "暂无自选股，请先在设置中添加监控标的" });
  }

  try {
    const quotes = await fetchStockBatch(codes.map((c) => c.code));
    const nameMap = new Map(quotes.map((q) => [q.code, q.name]));
    const results = await Promise.all(
      codes.map((c) => buildRiskRadar(c.code, nameMap.get(c.code) || c.name)),
    );
    return Response.json({
      updatedAt: new Date().toISOString(),
      items: results,
      source: "质押：东方财富股权质押数据中心；减持/监管：东方财富公告标题扫描；现金流/偿债：东方财富财务主要指标",
    });
  } catch (e: any) {
    return Response.json(
      { updatedAt: new Date().toISOString(), items: [], message: "风险雷达数据获取失败：" + (e?.message || "未知错误") },
      { status: 200 },
    );
  }
}
