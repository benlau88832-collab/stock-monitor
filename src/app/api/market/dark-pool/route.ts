import { emGet } from "@/lib/em";
import { fetchBoardConstituents } from "@/lib/marketData";

export const dynamic = "force-dynamic";

// 暗池资金监控：改进版
// 明盘 = 中单(游资) + 小单(散户) 的净流入
// 暗盘 = 超大单 + 大单(主力/机构) 的净流入
// 判断逻辑：
// - 明盘流出、暗盘流入 => 暗盘>明盘 = 洗盘（主力悄悄吸筹）
// - 明盘流入、暗盘流出 => 暗盘流出>明盘 = 出货（主力借势撤退）
// - 明暗盘同向流入 = 共振做多
// - 明暗盘同向流出 = 共振做空
export async function GET() {
  try {
    // 使用东方财富行业板块资金流接口获取资金流向
    const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=30&po=1&np=1&fltt=2&invt=2&fid=f62&fs=m:90+t:2&fields=f12,f14,f3,f62,f66,f72,f78,f84,f164,f165,f174,f175`;
    const json = await emGet(url);
    const diff: any[] = json?.data?.diff ?? [];

    let totalOpenNet = 0;  // 明盘总净流入
    let totalDarkNet = 0;  // 暗盘总净流入
    let totalMainNet5d = 0;
    let totalMainNet10d = 0;
    const topBoards: any[] = [];

    for (const d of diff) {
      const boardName = d.f14 || d.f12;
      const mainNet = Number(d.f62) || 0;
      const extraLargeNet = Number(d.f66) || 0;
      const largeNet = Number(d.f72) || 0;
      const mediumNet = Number(d.f78) || 0;
      const smallNet = Number(d.f84) || 0;

      // 暗盘 = 超大单+大单（机构主力资金）
      const darkNet = extraLargeNet + largeNet;
      // 明盘 = 中单+小单（散户+游资）
      const openNet = mediumNet + smallNet;

      totalDarkNet += darkNet;
      totalOpenNet += openNet;
      totalMainNet5d += Number(d.f164) || 0;
      totalMainNet10d += Number(d.f174) || 0;

      // 判断明暗盘状态
      let flowType: string;
      if (darkNet > 0 && openNet < 0 && Math.abs(darkNet) > Math.abs(openNet) * 0.5) {
        flowType = "洗盘（暗盘流入+明盘流出）";
      } else if (darkNet < 0 && openNet > 0 && Math.abs(darkNet) > Math.abs(openNet) * 0.5) {
        flowType = "出货（暗盘流出+明盘流入）";
      } else if (darkNet > 0 && openNet > 0) {
        flowType = "共振做多";
      } else if (darkNet < 0 && openNet < 0) {
        flowType = "共振做空";
      } else {
        flowType = "方向不明";
      }

      topBoards.push({
        code: d.f12,
        name: boardName,
        darkNet,
        openNet,
        mainNet,
        pct: Number(d.f3) || 0,
        flowType,
        mainNet5d: Number(d.f164) || 0,
        mainNet10d: Number(d.f174) || 0,
      });
    }

    // 全市场明暗盘判断
    let marketFlowType: string;
    if (totalDarkNet > 0 && totalOpenNet < 0) {
      marketFlowType = "全市场暗盘流入、明盘流出 — 可能为洗盘阶段（主力吸筹）";
    } else if (totalDarkNet < 0 && totalOpenNet > 0) {
      marketFlowType = "全市场暗盘流出、明盘流入 — 可能为出货阶段（主力撤退）";
    } else if (totalDarkNet > 0 && totalOpenNet > 0) {
      marketFlowType = "全市场明暗盘共振做多 — 多方合力";
    } else if (totalDarkNet < 0 && totalOpenNet < 0) {
      marketFlowType = "全市场明暗盘共振做空 — 空方主导";
    } else {
      marketFlowType = "全市场明暗盘方向不一致 — 观望为主";
    }

    // 排序取 TOP10
    topBoards.sort((a, b) => b.darkNet - a.darkNet);
    const top10 = topBoards.slice(0, 10);

    // 为 TOP10 板块获取成分股明细
    const boardStocks: Record<string, any[]> = {};
    const stockFetchPromises = top10.slice(0, 5).map(async (b) => {
      try {
        const stocks = await fetchBoardConstituents(b.code, 8);
        boardStocks[b.code] = stocks.map((s) => ({
          code: s.code,
          name: s.name,
          pct: s.pct,
          mainNet: s.mainNet,
          darkNet: (s.extraLargeNet ?? 0) + 0, // 个股超大单作为暗盘代理
          openNet: (s.mediumNet ?? 0) + (s.smallNet ?? 0),
        }));
      } catch {
        boardStocks[b.code] = [];
      }
    });
    await Promise.allSettled(stockFetchPromises);

    return Response.json({
      updatedAt: new Date().toISOString(),
      darkPoolToday: totalDarkNet,
      openPoolToday: totalOpenNet,
      darkPool5d: totalMainNet5d,
      darkPool10d: totalMainNet10d,
      marketFlowType,
      topBoards: top10,
      boardStocks,
      note: "明盘=中单(游资)+小单(散户)净流入；暗盘=超大单+大单(主力/机构)净流入。洗盘=暗盘流入+明盘流出；出货=暗盘流出+明盘流入。",
      source: "东方财富板块资金流接口（行业板块级别），真实数据",
    });
  } catch (e: any) {
    return Response.json({
      updatedAt: new Date().toISOString(),
      darkPoolToday: 0,
      openPoolToday: 0,
      darkPool5d: 0,
      darkPool10d: 0,
      marketFlowType: "数据获取失败",
      topBoards: [],
      boardStocks: {},
      note: "暗池数据接口请求失败，如实标注数据不完整，不编造数值。",
      source: "东方财富公开接口（数据获取失败）",
      message: "暗池数据获取失败：" + (e?.message || "未知错误"),
    }, { status: 200 });
  }
}
