import { fetchBoardFundFlow, fetchBoardConstituents } from "@/lib/marketData";
import { judgeMainlineStage, boardWeight, evaluatePotentialStock } from "@/lib/analysis";
import type { MainlineBoard, PotentialStock } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [industry, concept, region] = await Promise.allSettled([
      fetchBoardFundFlow("industry", 10),
      fetchBoardFundFlow("concept", 10),
      fetchBoardFundFlow("region", 6),
    ]);

    const boards: MainlineBoard[] = [];
    for (const r of [industry, concept, region]) {
      if (r.status !== "fulfilled") continue;
      for (const b of r.value) {
        const { stage, reason } = judgeMainlineStage({
          pct: b.pct,
          mainNetPct: b.mainNetPct,
          mainNet5dPct: b.mainNet5dPct,
          mainNet10dPct: b.mainNet10dPct,
        });
        boards.push({
          code: b.code,
          name: b.name,
          boardType: b.boardType,
          pct: b.pct,
          mainNet: b.mainNet,
          mainNetPct: b.mainNetPct,
          mainNet5dPct: b.mainNet5dPct,
          mainNet10dPct: b.mainNet10dPct,
          stage,
          stageReason: reason,
          weight: boardWeight(stage),
        });
      }
    }
    boards.sort((a, b) => b.mainNet - a.mainNet);
    const topBoards = boards.slice(0, 15);

    // 潜力股：取主力净流入前 3 的板块，抓取各自成分股中资金流入最强的股票，再做一票否决过滤
    const leaderBoards = topBoards.filter((b) => b.weight === "推荐关注").slice(0, 3);
    const potential: PotentialStock[] = [];
    for (const board of leaderBoards) {
      try {
        const stocks = await fetchBoardConstituents(board.code, 6);
        for (const s of stocks) {
          potential.push(evaluatePotentialStock(s, board.name));
        }
      } catch {
        // 忽略单个板块成分股拉取失败
      }
    }
    // 去重（同一股票可能属于多个板块），保留第一次出现
    const seen = new Set<string>();
    const dedupedPotential = potential.filter((p) => {
      if (seen.has(p.code)) return false;
      seen.add(p.code);
      return true;
    });
    dedupedPotential.sort((a, b) => Number(a.vetoed) - Number(b.vetoed) || b.mainNet - a.mainNet);

    return Response.json({
      updatedAt: new Date().toISOString(),
      boards: topBoards,
      potential: dedupedPotential.slice(0, 15),
      source:
        "板块资金流：东方财富板块资金流接口（行业/概念/地域，今日+5日+10日主力净占比）；潜力股为领先板块成分股中资金流最强标的，经一票否决规则过滤",
    });
  } catch (e: any) {
    return Response.json(
      { updatedAt: new Date().toISOString(), boards: [], potential: [], message: "主线数据获取失败：" + (e?.message || "未知错误") },
      { status: 200 },
    );
  }
}
