import { db } from "@/db";
import { watchlist } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { fetchStockOne } from "@/lib/marketData";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await db.select().from(watchlist).orderBy(desc(watchlist.createdAt));
    return Response.json({ items: rows });
  } catch (e: any) {
    return Response.json({ items: [], message: e?.message }, { status: 200 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const code = String(body.code || "").trim();
    if (!/^\d{6}$/.test(code)) {
      return Response.json({ message: "股票代码格式不正确，应为 6 位数字" }, { status: 400 });
    }
    const quote = await fetchStockOne(code);
    const name = quote?.name || String(body.name || code);
    await db
      .insert(watchlist)
      .values({ code, name })
      .onConflictDoNothing({ target: watchlist.code });
    const rows = await db.select().from(watchlist).orderBy(desc(watchlist.createdAt));
    return Response.json({ items: rows });
  } catch (e: any) {
    return Response.json({ message: "添加失败：" + (e?.message || "未知错误") }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get("code");
    if (!code) return Response.json({ message: "缺少 code 参数" }, { status: 400 });
    await db.delete(watchlist).where(eq(watchlist.code, code));
    const rows = await db.select().from(watchlist).orderBy(desc(watchlist.createdAt));
    return Response.json({ items: rows });
  } catch (e: any) {
    return Response.json({ message: "删除失败：" + (e?.message || "未知错误") }, { status: 500 });
  }
}
