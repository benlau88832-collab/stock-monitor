import { apiFetch } from "./cloudStore";
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
  /** 今开（竞价结果）；v12-1：竞价未撮合时 fallback 到 currentPrice */
  openPrice: number;
  /** v12-1（P0）：竞价未撮合标记（qt openPrice=0，已用 currentPrice 作虚拟参考价） */
  auctionPending?: boolean;
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
  /** v9.26.14：当前价（实时） */
  currentPrice: number;
  /** v9.26.14：实时涨幅 %（(当前价-昨收)/昨收，腾讯 field 31） */
  changePct: number;
  /** v9.26.14：实时涨跌额（元，腾讯 field 32） */
  changeAmount: number;
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
  changeAmount: number;     // [32] 元
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
    changeAmount: num(32),
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
      // v9.86.0（P2-7）：统一 apiFetch —— token 自动携带 + 15s 超时兜底
      const r = await apiFetch(`/api/proxy?url=${encodeURIComponent(url)}`);
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
    // v12-1（P0 数据根因）：竞价期间（9:15-9:25）qt 的 openPrice 可能为 0（未撮合）
    //   → 原代码 (0-昨收)/昨收 = -100% 全错（所有股票显示跌停开盘假象）
    //   → fallback 到 currentPrice（虚拟参考价），并打 auctionPending 标记供 UI 提示"竞价中"
    const effectiveOpen = r.openPrice > 0 ? r.openPrice : r.currentPrice;
    const auctionPct = r.prevClose > 0 && effectiveOpen > 0
      ? (effectiveOpen - r.prevClose) / r.prevClose * 100
      : 0;
    return {
      code: r.code,
      name: r.name,
      openPrice: r.openPrice > 0 ? r.openPrice : r.currentPrice, // 显示用 fallback 值
      auctionPending: r.openPrice === 0, // 竞价未撮合标记（UI 可标"竞价中·虚拟参考价"）
      prevClose: r.prevClose,
      auctionPct: Math.round(auctionPct * 100) / 100,
      firstBoardTime: zt ? fmtFbt(zt.fbt) : null,
      boardCount: zt ? zt.lbc : null,
      strength: 0, // 下方统一计算
      auctionLimitUp: effectiveOpen > 0 && r.limitUpPrice > 0 && Math.abs(effectiveOpen - r.limitUpPrice) < 0.02,
      auctionGapDown: auctionPct < -3,
      openAmountYi: Math.round((r.amountWan / 10000) * 100) / 100,
      volumeKilo: r.volumeKilo,
      turnoverRate: Math.round(r.turnoverRate * 100) / 100,
      amplitude: Math.round(r.amplitude * 100) / 100,
      currentPrice: r.currentPrice,
      changePct: Math.round(r.changePct * 100) / 100,
      changeAmount: r.changeAmount,
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

// ============================================================
// v9.130.0（终审 D2 修复）：竞价五步流水 —— 板块批量涨停扫描 → 过滤非独立行情
//   → 识别龙头/跟风 → 找未涨停+套利空间上车机会 → 排除一字板。
// 纯函数 0 token；目的：挖早盘板块异动，在板块内找【未涨停+有套利空间】的上车机会。
// ============================================================
export interface AuctionOpportunity {
  /** 有效板块名（hybk） */
  board: string;
  /** 板块涨停家数 */
  ztCount: number;
  /** 龙头 = 板块内最高板（同板取首封最早） */
  leader: { code: string; name: string; lbc: number } | null;
  /** 跟风 = 板块内其余涨停（已排除一字板） */
  followers: { code: string; name: string; lbc: number }[];
  /** 未涨停 + 套利空间候选（竞价涨幅 0.5%~7% 且竞价额≥0.3 亿） */
  candidates: { code: string; name: string; auctionPct: number; openAmountYi: number }[];
  /** 被排除的一字板/竞价封板 */
  excludedOneWord: string[];
}

/**
 * 竞价五步流水（纯函数）
 * @param ztPool 今日涨停池（含 hybk 板块字段）
 * @param quotes fetchAuctionBoard 输出的竞价快照（=昨日涨停股，含今日未涨停者）
 * @param prevHybk 昨日涨停快照 code→hybk 映射（未涨停股不在今日池，板块归属必须来自昨日快照）
 */
export function findAuctionOpportunities(
  ztPool: Array<{ c: string; n?: string; fbt?: number; lbc?: number; hybk?: string }>,
  quotes: AuctionItem[],
  opts: { minBoardZt?: number; candidatePctMin?: number; candidatePctMax?: number; minOpenAmountYi?: number } = {},
  prevHybk?: Map<string, string>,
): AuctionOpportunity[] {
  const minBoardZt = opts.minBoardZt ?? 2;       // ② 板块涨停≥2 才有效（<2 = 单股独立行情剔除）
  const pctMin = opts.candidatePctMin ?? 0.5;    // ④ 套利空间下沿（≥0.5% 有资金关注）
  const pctMax = opts.candidatePctMax ?? 7;      // ④ 上沿（<7% 未涨停；20cm 板按调用方 limitPct 调整）
  const minAmt = opts.minOpenAmountYi ?? 0.3;    // ④ 竞价额≥0.3 亿（活跃度过滤）
  const pool = Array.isArray(ztPool) ? ztPool : [];
  const qMap = new Map((Array.isArray(quotes) ? quotes : []).map((q) => [q.code, q]));

  // ① 板块批量涨停扫描（hybk 分组）
  const boardMap = new Map<string, { code: string; name: string; lbc: number; fbt: number }[]>();
  for (const s of pool) {
    const code = String(s.c ?? "");
    if (!code) continue;
    const board = String(s.hybk ?? "未分类");
    const arr = boardMap.get(board) ?? [];
    arr.push({ code, name: String(s.n ?? ""), lbc: Number(s.lbc) || 1, fbt: Number(s.fbt) || 0 });
    boardMap.set(board, arr);
  }

  const out: AuctionOpportunity[] = [];
  for (const [board, members] of boardMap) {
    if (members.length < minBoardZt) continue; // ② 过滤非独立行情

    // ⑤ 排除一字板：首封≤09:25:00（fbt>0 且 ≤92500）或竞价即封板
    const isOneWord = (m: { code: string; lbc: number; fbt: number }) =>
      (m.fbt > 0 && m.fbt <= 92500) || (qMap.get(m.code)?.auctionLimitUp === true);
    const active = members.filter((m) => !isOneWord(m));
    const excludedOneWord = members.filter((m) => isOneWord(m)).map((m) => m.name || m.code);

    // ③ 龙头 = 最高板（同板取首封最早）；跟风 = 其余
    const sorted = [...active].sort((a, b) => (b.lbc - a.lbc) || (a.fbt - b.fbt));
    const leader = sorted[0] ? { code: sorted[0].code, name: sorted[0].name, lbc: sorted[0].lbc } : null;
    const followers = sorted.slice(1).map((s) => ({ code: s.code, name: s.name, lbc: s.lbc }));

    // ④ 未涨停 + 套利空间：昨日涨停今日未涨停、同板块、竞价涨幅 0.5%~7%、竞价额≥0.3 亿
    // v9.132.0（终审复核 D2 修正）：板块映射优先 prevHybk（昨日快照）——未涨停股不在今日涨停池，
    //   原实现 hybkOf 仅覆盖今日池 → 生产环境 candidates 恒空（结构性死步）
    const hybkOf = new Map(pool.map((p) => [String(p.c), String(p.hybk ?? "未分类")]));
    const boardOf = (code: string) => (prevHybk && prevHybk.has(code) ? prevHybk.get(code) : hybkOf.get(code));
    const candidates = (Array.isArray(quotes) ? quotes : [])
      .filter((q) => {
        if (boardOf(q.code) !== board) return false;
        if (q.auctionLimitUp || (q.boardCount ?? 0) >= 1) return false; // ⑤ 排除涨停/一字板
        if (q.auctionPct < pctMin || q.auctionPct > pctMax) return false; // 套利空间
        if (q.openAmountYi < minAmt) return false;                       // 活跃度
        return true;
      })
      .map((q) => ({ code: q.code, name: q.name, auctionPct: q.auctionPct, openAmountYi: q.openAmountYi }));

    if (leader || candidates.length > 0) {
      out.push({ board, ztCount: members.length, leader, followers, candidates, excludedOneWord });
    }
  }
  out.sort((a, b) => b.ztCount - a.ztCount);
  return out;
}