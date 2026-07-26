import { fetchGlobalNews } from "@/lib/marketData";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const news = await fetchGlobalNews(15);
    return Response.json({
      updatedAt: new Date().toISOString(),
      news,
      available: news.length > 0,
      source: "东方财富 7×24 全球财经快讯（仅作参考，不构成决策依据）",
    });
  } catch (e: any) {
    return Response.json({ updatedAt: new Date().toISOString(), news: [], available: false, message: e?.message }, { status: 200 });
  }
}
