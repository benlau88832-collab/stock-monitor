// 融资融券（两融）数据封装：全市场历史汇总 + 个股两融明细
// 数据源：东方财富数据中心（与 data.eastmoney.com/rzrq 同源）
//  - RPTA_RZRQ_LSHJ   全市场两融历史汇总（沪深合计，2010年至今，T+1更新）
//  - RPTA_WEB_RZRQ_GGMX 个股两融明细（融资余额/净买入/余额变化率 1~10日）
// 关键字段（GGMX）：
//  - RZYE 融资余额 / RQYE 融券余额 / RZRQYE 两融合计
//  - RZMRE 融资买入额 / RZCHE 融资偿还额 / RZJME 今日融资净买入
//  - RZJME3D/5D/10D 近3/5/10日融资净买入
//  - RCHANGE3DCP/5DCP/10DCP 融资余额近3/5/10日变化率(%) ← "融资客加速建仓"检测依据
// 说明：两融数据为交易所 T+1 披露，盘中不会实时变化，故缓存 TTL 设较长。

import { queuedJsonp } from "./jsonpQueue";
import { recordApiCall } from "./apiHealth";

const DC = "https://datacenter-web.eastmoney.com/api/data/v1/get";

// ============== 类型 ==============
export interface MarginHistoryRow {
  date: string;        // YYYY-MM-DD
  rzBalance: number;   // 融资余额(元)
  rqBalance: number;   // 融券余额(元)
  rzBuy: number;       // 融资买入额(元)
  rzNet: number;       // 融资净买入(元) = 买入 - 偿还
}

export interface StockMarginInfo {
  code: string;
  name: string;
  date: string;          // 数据日期 YYYY-MM-DD
  rzBalance: number;     // 融资余额
  rqBalance: number;     // 融券余额
  rzNet: number;         // 今日融资净买入
  net3d: number | null;  // 近3日融资净买入
  net5d: number | null;  // 近5日融资净买入
  net10d: number | null; // 近10日融资净买入
  chg3d: number | null;  // 融资余额近3日变化率%
  chg5d: number | null;  // 近5日变化率%
  chg10d: number | null; // 近10日变化率%
}

// ============== 缓存 ==============
const historyCache = { data: null as MarginHistoryRow[] | null, ts: 0 };
const HISTORY_TTL = 10 * 60 * 1000;   // 全市场 10 分钟（T+1 数据，足够）
const stockCache = new Map<string, { data: StockMarginInfo | null; ts: number }>();
const STOCK_TTL = 5 * 60 * 1000;      // 个股 5 分钟

// ============== 全市场两融历史 ==============
/**
 * 拉取全市场融资融券历史汇总（最新在前）
 * @param days 天数（最多约 300 天）
 */
export async function fetchMarginHistory(days = 60): Promise<MarginHistoryRow[]> {
  if (historyCache.data && Date.now() - historyCache.ts < HISTORY_TTL) return historyCache.data;

  const url = `${DC}?reportName=RPTA_RZRQ_LSHJ&columns=DIM_DATE,RZYE,RQYE,RZMRE,RZCHE,RZJME&pageNumber=1&pageSize=${Math.min(days, 300)}&sortColumns=DIM_DATE&sortTypes=-1&source=WEB&client=WEB`;
  const start = Date.now();
  try {
    const json = await queuedJsonp<any>(url, 12000, "callback", 2);
    const rows: any[] = json?.result?.data ?? [];
    const data = rows.map((r: any) => ({
      date: String(r.DIM_DATE ?? "").slice(0, 10),
      rzBalance: Number(r.RZYE) || 0,
      rqBalance: Number(r.RQYE) || 0,
      rzBuy: Number(r.RZMRE) || 0,
      rzNet: Number(r.RZJME) || 0,
    })).filter(r => r.date);
    recordApiCall("两融历史", true, Date.now() - start);
    historyCache.data = data;
    historyCache.ts = Date.now();
    return data;
  } catch (err) {
    recordApiCall("两融历史", false, Date.now() - start);
    return historyCache.data ?? [];
  }
}

// ============== 个股两融 ==============
function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 查询个股最新两融数据（沪/深/创/科全覆盖，无两融标的返回 null） */
export async function fetchStockMargin(code: string): Promise<StockMarginInfo | null> {
  const cached = stockCache.get(code);
  if (cached && Date.now() - cached.ts < STOCK_TTL) return cached.data;

  const url = `${DC}?reportName=RPTA_WEB_RZRQ_GGMX&columns=SCODE,SECNAME,DATE,RZYE,RQYE,RZJME,RZJME3D,RZJME5D,RZJME10D,RCHANGE3DCP,RCHANGE5DCP,RCHANGE10DCP&pageNumber=1&pageSize=1&sortColumns=DATE&sortTypes=-1&source=WEB&client=WEB&filter=(SCODE%3D%22${code}%22)`;
  const start = Date.now();
  try {
    const json = await queuedJsonp<any>(url, 10000, "callback", 2);
    const rows: any[] = json?.result?.data ?? [];
    recordApiCall("个股两融", true, Date.now() - start);
    if (rows.length === 0) {
      stockCache.set(code, { data: null, ts: Date.now() });
      return null;
    }
    const r = rows[0];
    const info: StockMarginInfo = {
      code: String(r.SCODE ?? code),
      name: String(r.SECNAME ?? ""),
      date: String(r.DATE ?? "").slice(0, 10),
      rzBalance: Number(r.RZYE) || 0,
      rqBalance: Number(r.RQYE) || 0,
      rzNet: Number(r.RZJME) || 0,
      net3d: toNum(r.RZJME3D),
      net5d: toNum(r.RZJME5D),
      net10d: toNum(r.RZJME10D),
      chg3d: toNum(r.RCHANGE3DCP),
      chg5d: toNum(r.RCHANGE5DCP),
      chg10d: toNum(r.RCHANGE10DCP),
    };
    stockCache.set(code, { data: info, ts: Date.now() });
    return info;
  } catch (err) {
    recordApiCall("个股两融", false, Date.now() - start);
    return stockCache.get(code)?.data ?? null;
  }
}

// ============== "融资客加速建仓"信号检测 ==============
// 逻辑：融资余额是融资客真金白银的持仓，持续快速上升 = 看多力量在增强
//  - 加速建仓(强)：5日变化率明显为正 且 快于10日（近期比中期更快），或 3>5>10 阶梯加速
//  - 持续流入(中)：5日变化率为正但未见加速
//  - 流出：5日变化率为负
export interface MarginSignal {
  level: "strong" | "mid" | "weak" | "out" | "none";
  label: string;
  /** 给用户的一句话解释 */
  hint: string;
}

export function detectMarginSignal(m: StockMarginInfo | null): MarginSignal {
  if (!m) return { level: "none", label: "非两融标的", hint: "该股未纳入融资融券标的" };
  const c3 = m.chg3d, c5 = m.chg5d, c10 = m.chg10d;
  if (c5 == null) return { level: "none", label: "数据积累中", hint: "融资余额变化率待披露" };

  // 加速建仓：近期增速 > 中期增速，且整体为正
  const ladderAccel = c3 != null && c3 > c5 && c5 > (c10 ?? c5) && c5 > 0;      // 3>5 阶梯加速
  const fasterThan10 = c5 > 2 && (c10 == null || c5 > c10 + 0.5);              // 5日显著快于10日
  if ((ladderAccel || fasterThan10) && c5 > 0) {
    return { level: "strong", label: "🔥 融资客加速建仓", hint: `近5日融资余额+${c5.toFixed(1)}%，增速快于10日（+${(c10 ?? 0).toFixed(1)}%），杠杆资金正在抢筹` };
  }
  if (c5 > 0) {
    return { level: "mid", label: "融资客持续流入", hint: `近5日融资余额+${c5.toFixed(1)}%，融资客在逐步加仓` };
  }
  if (c5 > -2) {
    return { level: "weak", label: "融资余额微降", hint: `近5日融资余额${c5.toFixed(1)}%，融资客小幅撤退` };
  }
  return { level: "out", label: "⚠ 融资客加速流出", hint: `近5日融资余额${c5.toFixed(1)}%，杠杆资金在撤，注意风险` };
}

/** 信号徽章颜色 */
export function marginSignalColor(level: MarginSignal["level"]): string {
  switch (level) {
    case "strong": return "bg-rose-500/20 text-rose-300 border-rose-500/30";
    case "mid":    return "bg-amber-500/15 text-amber-300 border-amber-500/20";
    case "weak":   return "bg-slate-500/15 text-slate-300 border-slate-500/20";
    case "out":    return "bg-emerald-500/15 text-emerald-300 border-emerald-500/20";
    default:       return "bg-white/5 text-slate-500 border-white/10";
  }
}
