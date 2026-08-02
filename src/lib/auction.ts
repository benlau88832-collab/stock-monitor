// 竞价台数据层（v9.19-F1）
// 探测结论：东财标准行情接口无"集合竞价量"专用字段（f47 竞价阶段不完整）
// → 采用混合近似方案：
//   ① 竞价涨幅 = (今开 f46 - 昨收 f60) / 昨收 f60 —— 反映竞价结果
//   ② 早盘强度 = 涨停池首封时间 fbt（越早越强）+ 高开幅度
// 数据来源：push2 批量行情（f46今开/f60昨收）+ push2ex 涨停池（fbt首封）
// 纯数据层，不碰 DOM

// ============== 常量（与 api.ts 对齐） ==============
const PUSH2 = "https://push2.eastmoney.com/api/qt";
const EM_UT = "bd1d9ddb04089700cf9c27f6f7426281";

// ============== 数据结构 ==============
export interface AuctionItem {
  code: string;
  name: string;
  /** 今开（竞价结果） */
  openPrice: number;
  /** 昨收 */
  prevClose: number;
  /** 竞价涨幅 %（(今开-昨收)/昨收） */
  auctionPct: number;
  /** 首封时间 HH:MM:SS（若在涨停池） */
  firstBoardTime: string | null;
  /** 连板数（若在涨停池） */
  boardCount: number | null;
  /** 早盘强度分 0-100 */
  strength: number;
  /** 是否竞价即涨停 */
  auctionLimitUp: boolean;
  /** 是否竞价大幅低开（< -3%） */
  auctionGapDown: boolean;
}

// ============== 批量拉取 ==============
/**
 * 竞价台核心：批量拉取股票开盘/昨收 → 计算竞价涨幅
 * @param codes     股票代码（如 ["600519","000001"]）
 * @param ztPool    今日涨停池（可选，用于标注首封时间/连板）
 */
export async function fetchAuctionBoard(
  codes: string[],
  ztPool?: Array<{ c: string; n: string; fbt: number; lbc: number }>,
): Promise<AuctionItem[]> {
  if (codes.length === 0) return [];

  // 分块（每批 40 只，避免 URL 过长）
  const items: AuctionItem[] = [];
  const chunks: string[][] = [];
  for (let i = 0; i < codes.length; i += 40) chunks.push(codes.slice(i, i + 40));

  // 涨停池索引（code → {fbt, lbc}）
  const ztMap = new Map<string, { fbt: number; lbc: number }>();
  if (ztPool) {
    for (const z of ztPool) {
      const code = String(z.c ?? "").replace(/^[A-Z]{2}/, "");
      ztMap.set(code, { fbt: z.fbt ?? 999999, lbc: z.lbc ?? 1 });
    }
  }

  for (const chunk of chunks) {
    const secids = chunk.map(c => `${/^(60|68|5)/.test(c) ? "1" : "0"}.${c}`).join(",");
    const url = `${PUSH2}/ulist.np/get?ut=${EM_UT}&fltt=2&fields=f12,f14,f46,f60&secids=${secids}`;
    try {
      const json = await (await fetch(url)).json();
      const diffRaw = json?.data?.diff;
      const diff: any[] = Array.isArray(diffRaw) ? diffRaw : (diffRaw && typeof diffRaw === "object" ? Object.values(diffRaw) : []);
      for (const d of diff) {
        const code = String(d.f12 ?? "");
        if (!code) continue;
        const openPrice = Number(d.f46) || 0;
        const prevClose = Number(d.f60) || 0;
        const zt = ztMap.get(code);
        const auctionPct = prevClose > 0 ? (openPrice - prevClose) / prevClose * 100 : 0;
        items.push({
          code,
          name: String(d.f14 ?? ""),
          openPrice,
          prevClose,
          auctionPct: Math.round(auctionPct * 100) / 100,
          firstBoardTime: zt ? fmtFbt(zt.fbt) : null,
          boardCount: zt ? zt.lbc : null,
          strength: 0, // 下方统一计算
          auctionLimitUp: false,
          auctionGapDown: auctionPct < -3,
        });
      }
    } catch { /* 单批失败跳过 */ }
  }

  // 计算早盘强度分（0-100）
  for (const it of items) {
    let s = 50; // 基准
    // 竞价涨幅：+5% 高开 = 高分，-3% 低开 = 低分
    s += Math.max(-30, Math.min(30, it.auctionPct * 6));
    // 首封时间加成：09:30 前封板 = 强
    if (it.firstBoardTime) {
      const t = it.firstBoardTime;
      const isEarly = t < "09:40";
      if (isEarly) s += 25;
      else if (t < "10:00") s += 15;
      else s += 5;
      // 连板加成
      if (it.boardCount != null && it.boardCount >= 2) s += 10;
    }
    it.strength = Math.max(0, Math.min(100, Math.round(s)));
    it.auctionLimitUp = it.auctionPct >= 9.8; // 竞价即涨停（近似）
  }

  // 排序：强度降序
  items.sort((a, b) => b.strength - a.strength);
  return items;
}

function fmtFbt(t: number): string {
  const s = String(t).padStart(6, "0");
  return `${s.slice(0, 2)}:${s.slice(2, 4)}:${s.slice(4, 6)}`;
}
