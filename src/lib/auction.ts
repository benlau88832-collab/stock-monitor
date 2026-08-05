// 竞价台数据层（v9.19-F1）
// v9.26.12 重大改造：东财 ulist 的 f46(今开)/f60(昨收) 字段已重映射为其他含义，
//   原实现算出 -100% 全错。改用腾讯 qt.gtimg.cn 接口（雪球格式）批量获取真实：
//   - 今开/昨收/当前价/成交量/成交额/换手率/振幅/流通市值
//   单 URL 可批量 ~50 只，字段以 ~ 分隔（GBK 编码）
// 纯数据层，不碰 DOM

// ============== 常量 ==============
// v9.26.12：腾讯 qt 接口（雪球同款字段），浏览器直连无 CORS；服务端代理绕 GBK 编码
const QT_BASE = "https://qt.gtimg.cn/q=";

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
  /** v9.26.12：开盘额（亿元，腾讯 field 38 成交额） */
  openAmountYi: number;
  /** v9.26.12：当前累计成交量（手，腾讯 field 6） */
  volumeKilo: number;
  /** v9.26.12：换手率 % */
  turnoverRate: number;
  /** v9.26.12：振幅 % */
  amplitude: number;
}

// ============== 腾讯接口解析 ==============
interface QtRow {
  code: string;
  name: string;
  currentPrice: number;     // [3]
  prevClose: number;        // [4]
  openPrice: number;        // [5]
  volumeKilo: number;       // [6] 手
  amountWan: number;        // [38] 万
  changePct: number;        // [31] %
  turnoverRate: number;     // [39] %
  amplitude: number;        // [50] %
  limitUpPrice: number;     // [48]
  limitDownPrice: number;   // [49]
}

function parseQtLine(line: string): QtRow | null {
  // 格式：v_sz000593="51~德龙汇能~000593~22.52~20.47~22.52~240037~..."
  if (!line || !line.includes("=")) return null;
  const eq = line.indexOf("=");
  const right = line.slice(eq + 1).replace(/^"|"$/g, "").trim();
  const p = right.split("~");
  if (p.length < 50) return null;
  const num = (i: number) => parseFloat(p[i]) || 0;
  return {
    code: p[2],
    name: p[1],
    currentPrice: num(3),
    prevClose: num(4),
    openPrice: num(5),
    volumeKilo: num(6),
    amountWan: num(38),
    changePct: num(31),
    turnoverRate: num(39),
    amplitude: num(50),
    limitUpPrice: num(48),
    limitDownPrice: num(49),
  };
}

/** 把 6 位代码转为腾讯前缀：6/5/9 开头=sh，其余=sz */
function toQtSymbol(code: string): string {
  const c = String(code).padStart(6, "0");
  return c.startsWith("6") || c.startsWith("5") || c.startsWith("9") ? `sh${c}` : `sz${c}`;
}

async function fetchQtBatch(codes: string[]): Promise<QtRow[]> {
  if (codes.length === 0) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < codes.length; i += 50) chunks.push(codes.slice(i, i + 50));
  const out: QtRow[] = [];
  for (const chunk of chunks) {
    try {
      const url = QT_BASE + chunk.map(toQtSymbol).join(",");
      const r = await fetch(`/api/proxy?url=${encodeURIComponent(url)}`);
      if (!r.ok) continue;
      const buf = await r.arrayBuffer();
      // 腾讯接口 GBK 编码（用 TextDecoder 解码避免 iconv 兼容性）
      const text = new TextDecoder("gbk").decode(buf);
      const lines = text.split(/\r?\n/).filter(Boolean);
      for (const ln of lines) {
        const row = parseQtLine(ln);
        if (row) out.push(row);
      }
    } catch { /* 单批失败跳过 */ }
  }
  return out;
}

// ============== 批量拉取 ==============
/**
 * 竞价台核心：批量拉取股票开盘/昨收 → 计算竞价涨幅
 * @param codes     股票代码（如 ["600519","000593"]）
 * @param ztPool    今日涨停池（可选，用于标注首封时间/连板）
 */
export async function fetchAuctionBoard(
  codes: string[],
  ztPool?: Array<{ c: string; n: string; fbt: number; lbc: number }>,
): Promise<AuctionItem[]> {
  if (codes.length === 0) return [];

  // 涨停池索引（code → {fbt, lbc}）
  const ztMap = new Map<string, { fbt: number; lbc: number }>();
  if (ztPool) {
    for (const z of ztPool) {
      const code = String(z.c ?? "").replace(/^[A-Z]{2}/, "");
      ztMap.set(code, { fbt: z.fbt ?? 999999, lbc: z.lbc ?? 1 });
    }
  }

  const rows = await fetchQtBatch(codes);
  const items: AuctionItem[] = rows.map(r => {
    const zt = ztMap.get(r.code);
    const auctionPct = r.prevClose > 0 ? (r.openPrice - r.prevClose) / r.prevClose * 100 : 0;
    return {
      code: r.code,
      name: r.name,
      openPrice: r.openPrice,
      prevClose: r.prevClose,
      auctionPct: Math.round(auctionPct * 100) / 100,
      firstBoardTime: zt ? fmtFbt(zt.fbt) : null,
      boardCount: zt ? zt.lbc : null,
      strength: 0, // 下方统一计算
      auctionLimitUp: r.openPrice > 0 && r.limitUpPrice > 0 && Math.abs(r.openPrice - r.limitUpPrice) < 0.02,
      auctionGapDown: auctionPct < -3,
      openAmountYi: Math.round((r.amountWan / 10000) * 100) / 100,
      volumeKilo: r.volumeKilo,
      turnoverRate: Math.round(r.turnoverRate * 100) / 100,
      amplitude: Math.round(r.amplitude * 100) / 100,
    };
  });

  // 计算早盘强度分（0-100）—— 综合竞价涨幅+首封时间+竞价量+换手
  for (const it of items) {
    let s = 50;
    s += Math.max(-30, Math.min(30, it.auctionPct * 4)); // 涨幅：+5% = +20
    if (it.firstBoardTime) {
      const t = it.firstBoardTime;
      if (t < "09:40") s += 20;
      else if (t < "10:00") s += 12;
      else s += 4;
      if (it.boardCount != null && it.boardCount >= 2) s += 8;
    }
    // v9.26.12：竞价成交额加成（开盘 30 分钟竞价越热越强）
    if (it.openAmountYi >= 1) s += 8;
    else if (it.openAmountYi >= 0.3) s += 4;
    it.strength = Math.max(0, Math.min(100, Math.round(s)));
  }

  items.sort((a, b) => b.strength - a.strength);
  return items;
}

function fmtFbt(t: number): string {
  const s = String(t).padStart(6, "0");
  return `${s.slice(0, 2)}:${s.slice(2, 4)}:${s.slice(4, 6)}`;
}