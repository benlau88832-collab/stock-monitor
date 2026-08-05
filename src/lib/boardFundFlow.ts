// 板块资金分时（v9.26.17 资金走势图）
// 数据源：东财 push2his stock/kline/get —— 板块分钟级 K 线（含每分钟主力净额）
// 字段对照：f51=时间, f55=收盘, f57=成交额, f59=涨跌幅, **f60=主力净额(万)**
// 注意：板块 K 线的 f60 单位是"万元"（金额偏大），实际是按"万"为单位的主力净流入

export interface BoardKlinePoint {
  /** 09:31 这样的分钟时间 */
  t: string;
  /** 主力净额（万）—— 直接累加得到累计资金曲线 */
  mainNetWan: number;
  /** 涨跌幅% */
  pctChg: number;
  /** 收盘点位 */
  close: number;
}

/** 累计资金曲线（每个点 = 该分钟累计主力净流入） */
export interface BoardFundCurve {
  boardCode: string;   // "90.BK0475"
  boardName: string;
  /** 累计资金曲线（万 → 元 转换） */
  cumCurve: { t: string; cumWan: number }[];
  /** 今日总主力净额（万） */
  totalWan: number;
}

/** 拉单个板块 1 分钟 K 线（含 f60 主力净额）
 *  v9.26.17：必须传 end=20500101 才返回全字段数据；返回字段 [0]时间 [1]开 [2]高 [3]低 [4]收 [5]成交量 [6]成交额 [7]振幅 [8]涨跌幅 [9]主力净额(万)
 */
export async function fetchBoardKlineFlow(secid: string, lmt = 240): Promise<BoardKlinePoint[]> {
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${encodeURIComponent(secid)}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60&klt=1&fqt=1&end=20500101&lmt=${lmt}`;
  try {
    const r = await fetch(url, { headers: { Referer: "https://quote.eastmoney.com/" } });
    if (!r.ok) return [];
    const json = await r.json();
    const klines: string[] = json?.data?.klines ?? [];
    return klines.map(line => {
      const p = line.split(",");
      // f51=时间 f55=收盘 f57=成交额 f59=涨跌幅 f60=主力净额(万)
      const t = (p[0] ?? "").slice(11, 16); // "09:31"
      const close = parseFloat(p[4]) || 0;
      const pctChg = parseFloat(p[8]) || 0;
      const mainNetWan = parseFloat(p[9]) || 0;
      return { t, close, pctChg, mainNetWan };
    });
  } catch {
    return [];
  }
}

/** 拉多个板块并计算累计资金曲线（并行） */
export async function fetchBoardFundCurves(
  boards: Array<{ code: string; name: string }>,
): Promise<BoardFundCurve[]> {
  const results = await Promise.all(
    boards.map(async b => {
      const pts = await fetchBoardKlineFlow(b.code);
      let cum = 0;
      const cumCurve = pts.map(p => { cum += p.mainNetWan; return { t: p.t, cumWan: cum }; });
      return { boardCode: b.code, boardName: b.name, cumCurve, totalWan: cum };
    }),
  );
  return results;
}