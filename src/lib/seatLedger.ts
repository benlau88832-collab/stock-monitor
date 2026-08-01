// 席位台账：龙虎榜席位溢价数据库
// 靠时间沉淀，越早跑数据越厚
// 每天龙虎榜拉取成功后增量写入；T+1/T+5 日线回填

import { toSecid } from "./api";
import { queuedJsonp } from "./jsonpQueue";
import { isHotMoneySeat } from "./seatProfiles";

const SEATS_PREFIX = "seats:";
const MAX_DAYS = 120; // 只保留120个交易日

// ============== 台账数据结构 ==============
export interface SeatRecord {
  deptName: string;
  stockCode: string;
  stockName: string;
  direction: "买" | "卖";
  net: number;           // 净额
  closeAtDay: number;    // 当日收盘价
  // T+1/T+5 回填字段
  priceT1: number | null;
  priceT5: number | null;
  pctT1: number | null;  // T+1 涨跌幅%
  pctT5: number | null;  // T+5 涨跌幅%
  backfilled: boolean;
}

// ============== 读写 ==============
function dayKey(date: string): string { return SEATS_PREFIX + date; }

export function loadDayRecords(date: string): SeatRecord[] {
  try {
    const raw = localStorage.getItem(dayKey(date));
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveDayRecords(date: string, records: SeatRecord[]): void {
  try { localStorage.setItem(dayKey(date), JSON.stringify(records)); }
  catch { /* localStorage 满 → 静默 */ }
}

/** 增量写入当日席位记录（同日同席位同股票同方向不重复） */
export function writeSeatRecords(date: string, newRecords: SeatRecord[]): void {
  const existing = loadDayRecords(date);
  const existingKeys = new Set(existing.map(r => `${r.deptName}|${r.stockCode}|${r.direction}`));
  let changed = false;
  for (const r of newRecords) {
    const key = `${r.deptName}|${r.stockCode}|${r.direction}`;
    if (!existingKeys.has(key)) {
      existing.push(r);
      existingKeys.add(key);
      changed = true;
    }
  }
  if (changed) {
    saveDayRecords(date, existing);
    pruneOldDays();
  }
}

/** 清理超过120天的旧台账 */
function pruneOldDays(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(SEATS_PREFIX)) keys.push(k);
    }
    if (keys.length <= MAX_DAYS) return;
    keys.sort(); // 日期升序
    const toDelete = keys.length - MAX_DAYS;
    for (let i = 0; i < toDelete; i++) localStorage.removeItem(keys[i]);
  } catch { /* 静默 */ }
}

// ============== 获取所有台账日期 ==============
export function getAllSeatDates(): string[] {
  const dates: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(SEATS_PREFIX)) {
      dates.push(k.replace(SEATS_PREFIX, ""));
    }
  }
  dates.sort().reverse();
  return dates;
}

// ============== T+1/T+5 溢价回填 ==============
// 复用 push2his 日线接口获取收盘价序列

const EM_UT = "bd1d9ddb04089700cf9c27f6f7426281";
const PUSH2HIS = "https://push2his.eastmoney.com/api/qt";

async function fetchRecentCloses(code: string, days = 10): Promise<Map<string, number>> {
  const secid = toSecid(code);
  const url = `${PUSH2HIS}/stock/kline/get?secid=${secid}&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56,f57&klt=101&fqt=0&beg=0&end=20500000&lmt=${days}&ut=${EM_UT}`;
  try {
    const json = await queuedJsonp<any>(url, 8000, "cb", 1);
    const klines: string[] = json?.data?.klines ?? [];
    const map = new Map<string, number>();
    for (const line of klines) {
      const p = line.split(",");
      map.set(p[0], Number(p[2]) || 0); // f52 = 收盘价
    }
    return map;
  } catch { return new Map(); }
}

/** 回填一天的台账：检查距今 >=1天的未回填记录，补 T+1/T+5 */
export async function backfillSeatDay(date: string): Promise<void> {
  const records = loadDayRecords(date);
  const pending = records.filter(r => !r.backfilled);
  if (pending.length === 0) return;

  // 按股票代码去重，批量查询
  const codes = [...new Set(pending.map(r => r.stockCode))];

  // 计算 T+1 和 T+5 的日期
  const baseDate = new Date(date + "T00:00:00+08:00");
  const now = Date.now();
  const daysSince = Math.floor((now - baseDate.getTime()) / 86400000);
  if (daysSince < 2) return; // 至少需要 T+1 数据

  for (const code of codes) {
    try {
      const closes = await fetchRecentCloses(code, 15);
      if (closes.size === 0) continue;

      // 找到上榜日之后的交易日序列
      const allDates = [...closes.keys()].sort();
      const idx = allDates.indexOf(date);
      if (idx < 0) continue;

      const t1Date = allDates[idx + 1];
      const t5Date = allDates[idx + 5];
      const closeAtDay = closes.get(date) ?? 0;
      const priceT1 = t1Date ? (closes.get(t1Date) ?? null) : null;
      const priceT5 = t5Date ? (closes.get(t5Date) ?? null) : null;

      // 回填该股所有记录
      for (const r of pending) {
        if (r.stockCode !== code) continue;
        const base = closeAtDay || r.closeAtDay;
        if (base <= 0) continue;
        r.priceT1 = priceT1;
        r.priceT5 = priceT5;
        if (priceT1 != null) r.pctT1 = Math.round((priceT1 / base - 1) * 10000) / 100;
        if (priceT5 != null) r.pctT5 = Math.round((priceT5 / base - 1) * 10000) / 100;
        // 只要尝试过就标记回填，即使部分为 null（T+5 可能还没到）
        if (daysSince >= 7 || priceT1 != null) r.backfilled = true;
      }
    } catch { /* 单股回填失败跳过，不阻塞 */ }
  }

  saveDayRecords(date, records);
}

/** 每天检查所有未回填的台账日期 */
export async function runBackfill(): Promise<void> {
  const dates = getAllSeatDates();
  const now = Date.now();
  for (const date of dates) {
    const daysSince = Math.floor((now - new Date(date + "T00:00:00+08:00").getTime()) / 86400000);
    if (daysSince < 2 || daysSince > 15) continue; // 只回填2-15天前的
    const records = loadDayRecords(date);
    if (records.some(r => !r.backfilled)) {
      await backfillSeatDay(date);
    }
  }
}

// ============== 席位画像聚合 ==============
export interface SeatProfile {
  deptName: string;
  appearances: number;       // 上榜次数
  avgPctT1: number | null;   // T+1 平均涨幅
  winRateT1: number | null;  // T+1 胜率（>0%）
  sampleCount: number;       // 有 T+1 数据的样本数
  premiumLevel: "high" | "negative" | "normal"; // 溢价分级
}

/** 聚合近 N 天的席位画像 */
export function buildSeatProfiles(maxDays = 120): SeatProfile[] {
  const dates = getAllSeatDates().slice(0, maxDays);
  // 按 deptName 聚合
  const agg = new Map<string, { appearances: number; t1s: number[] }>();
  for (const date of dates) {
    const records = loadDayRecords(date);
    // 同一天同一席位只算一次出现
    const seen = new Set<string>();
    for (const r of records) {
      if (r.direction !== "买") continue; // 只统计买入方
      if (!seen.has(r.deptName)) {
        seen.add(r.deptName);
        const entry = agg.get(r.deptName) ?? { appearances: 0, t1s: [] };
        entry.appearances++;
        agg.set(r.deptName, entry);
      }
      if (r.pctT1 != null) {
        const entry = agg.get(r.deptName)!;
        entry.t1s.push(r.pctT1);
      }
    }
  }

  const profiles: SeatProfile[] = [];
  for (const [deptName, data] of agg) {
    const sampleCount = data.t1s.length;
    let avgPctT1: number | null = null;
    let winRateT1: number | null = null;
    let premiumLevel: SeatProfile["premiumLevel"] = "normal";

    if (sampleCount >= 5) {
      avgPctT1 = Math.round(data.t1s.reduce((s, v) => s + v, 0) / sampleCount * 100) / 100;
      winRateT1 = Math.round(data.t1s.filter(v => v > 0).length / sampleCount * 100);
      // 分级：T+1均值>2% → 高溢价；<-1% → 负溢价
      if (avgPctT1 > 2) premiumLevel = "high";
      else if (avgPctT1 < -1) premiumLevel = "negative";
    }

    profiles.push({ deptName, appearances: data.appearances, avgPctT1, winRateT1, sampleCount, premiumLevel });
  }

  // 按出现次数降序
  profiles.sort((a, b) => b.appearances - a.appearances);
  return profiles;
}

// ============== v9.13：单席位历史查询（席位画像 + 展开） ==============
export interface SeatHistoryRow {
  date: string;
  stockCode: string;
  stockName: string;
  direction: "买" | "卖";
  net: number;
  pctT1: number | null;
  pctT5: number | null;
  backfilled: boolean;
}

/** 查某席位近 N 天所有上榜记录（按日期倒序） */
export function buildSeatHistoryByDept(deptName: string, maxDays = 60): SeatHistoryRow[] {
  const dates = getAllSeatDates().slice(0, maxDays);
  const out: SeatHistoryRow[] = [];
  for (const date of dates) {
    const records = loadDayRecords(date);
    for (const r of records) {
      if (r.deptName !== deptName) continue;
      out.push({
        date, stockCode: r.stockCode, stockName: r.stockName,
        direction: r.direction, net: r.net, pctT1: r.pctT1, pctT5: r.pctT5,
        backfilled: r.backfilled,
      });
    }
  }
  out.sort((a, b) => b.date.localeCompare(a.date));
  return out;
}

// ============== 合力/独食检测 ==============
export interface StockSeatSignal {
  stockCode: string;
  stockName: string;
  signal: "合力" | "独食";
  detail: string;
}

/** 检测当日龙虎榜的合力/独食标记 */
export function detectSeatSignals(
  _date: string,
  seatsByStock: Record<string, { buy: Array<{ deptName: string; net: number }>; sell: Array<{ deptName: string; net: number }> }>,
  stockNames: Record<string, string>,
): StockSeatSignal[] {
  const signals: StockSeatSignal[] = [];

  for (const [code, seats] of Object.entries(seatsByStock)) {
    const name = stockNames[code] || code;

    // 合力：≥3家不同游资席位同买一只
    const hotMoneyBuyers = new Set<string>();
    for (const s of seats.buy) {
      if (isHotMoneySeat(s.deptName)) hotMoneyBuyers.add(s.deptName);
    }
    if (hotMoneyBuyers.size >= 3) {
      signals.push({
        stockCode: code, stockName: name, signal: "合力",
        detail: `${hotMoneyBuyers.size}家游资同买`,
      });
    }

    // 独食：单一席位净买占该股榜单净买>60%
    const totalBuyNet = seats.buy.reduce((s, b) => s + Math.max(0, b.net), 0);
    if (totalBuyNet > 0) {
      for (const s of seats.buy) {
        if (s.net > 0 && s.net / totalBuyNet > 0.6) {
          signals.push({
            stockCode: code, stockName: name, signal: "独食",
            detail: `${s.deptName.slice(0, 15)}占净买${Math.round(s.net / totalBuyNet * 100)}%`,
          });
          break; // 每只股票最多一个独食标记
        }
      }
    }
  }

  return signals;
}

// ============== P4 游资连续动作跟踪 ==============
// 十年机构视角：单个游资对同一只票的反复操作（隔日回补/连续加仓/对倒）往往暗示
// 该席位对该标的的长期意图。聚合近 N 天台账，找出"同席位同股票≥2次"的连续动作。
export interface SeatRepeatAction {
  deptName: string;
  stockCode: string;
  stockName: string;
  count: number;        // 出现次数
  dates: string[];      // 上榜日期
  direction: "买" | "卖" | "买卖";
  avgPctT1: number | null; // 平均 T+1 涨幅（回填后有效）
  lastNet: number;      // 最近一次净额
}

/** 聚合近 N 天游资连续动作（同席位同股票 ≥2 次上榜） */
export function buildSeatRepeatActions(maxDays = 60): SeatRepeatAction[] {
  const dates = getAllSeatDates().slice(0, maxDays);
  // key: deptName|stockCode
  const agg = new Map<string, { deptName: string; stockCode: string; stockName: string; dates: string[]; buys: number; sells: number; t1s: number[]; lastNet: number; lastDate: string }>();

  for (const date of dates) {
    const records = loadDayRecords(date);
    for (const r of records) {
      const key = `${r.deptName}|${r.stockCode}`;
      let entry = agg.get(key);
      if (!entry) {
        entry = { deptName: r.deptName, stockCode: r.stockCode, stockName: r.stockName, dates: [], buys: 0, sells: 0, t1s: [], lastNet: 0, lastDate: "" };
        agg.set(key, entry);
      }
      entry.dates.push(date);
      if (r.direction === "买") entry.buys++; else entry.sells++;
      if (r.pctT1 != null) entry.t1s.push(r.pctT1);
      // 记录最近一次净额（日期升序遍历，后覆盖前 → 最终为最新）
      if (date >= entry.lastDate) { entry.lastNet = r.net; entry.lastDate = date; }
    }
  }

  const actions: SeatRepeatAction[] = [];
  for (const e of agg.values()) {
    if (e.dates.length < 2) continue; // 只统计反复动作
    const direction: SeatRepeatAction["direction"] = e.buys > 0 && e.sells > 0 ? "买卖" : e.buys > 0 ? "买" : "卖";
    actions.push({
      deptName: e.deptName,
      stockCode: e.stockCode,
      stockName: e.stockName,
      count: e.dates.length,
      dates: e.dates.sort().reverse(),
      direction,
      avgPctT1: e.t1s.length > 0 ? Math.round(e.t1s.reduce((s, v) => s + v, 0) / e.t1s.length * 100) / 100 : null,
      lastNet: e.lastNet,
    });
  }

  // 排序：次数多者优先，其次平均溢价高者优先
  actions.sort((a, b) => b.count - a.count || (b.avgPctT1 ?? -99) - (a.avgPctT1 ?? -99));
  return actions;
}
