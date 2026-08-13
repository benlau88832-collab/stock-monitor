// ============================================================
// v9.138.0（波段重构·阶段一）：业绩验证日历 —— 景气度投资的"审判日"时间轴
// 定位：A股财报节奏是景气度验证的核心时间窗：
//   一季报 4/30 前、中报预告 7/15 前、中报 8/31 前、三季报 10/31 前、
//   年报预告 1/31 前、年报 4/30 前
// 功能：① 计算当前所处的财报窗口与下一窗口 ② 持仓/自选股的业绩窗口提醒
// 数据：纯函数日历（内置法定披露规则）+ 外部可注入个股业绩日期（F10 财报日期）
// ============================================================
import { localDateStr } from "./format";

export interface EarningsWindow {
  /** 窗口名：年报预告/年报/一季报/中报预告/中报/三季报 */
  name: string;
  /** 披露截止日（YYYY-MM-DD，含） */
  deadline: string;
  /** 披露开始日（提前 2 周进入"披露期"） */
  start: string;
  /** 是否正处于披露期 */
  active: boolean;
  /** 距截止天数（正=还有 N 天，负=已过 N 天） */
  daysToDeadline: number;
}

/** A股财报披露规则（每年固定，闰年无关）：截止日 + 名称 */
const SEASONS: Array<{ name: string; deadline: (y: number) => string; startOffsetDays: number }> = [
  { name: "年报预告", deadline: y => `${y}-01-31`, startOffsetDays: 21 },
  { name: "年报", deadline: y => `${y}-04-30`, startOffsetDays: 14 },
  { name: "一季报", deadline: y => `${y}-04-30`, startOffsetDays: 14 },
  { name: "中报预告", deadline: y => `${y}-07-15`, startOffsetDays: 14 },
  { name: "中报", deadline: y => `${y}-08-31`, startOffsetDays: 14 },
  { name: "三季报", deadline: y => `${y}-10-31`, startOffsetDays: 14 },
];

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(a + "T00:00:00").getTime() - new Date(b + "T00:00:00").getTime()) / 86400000);
}

/** 计算某日期所处的全部财报窗口（含未来 90 天内的窗口） */
export function earningsWindows(today = localDateStr(), horizonDays = 90): EarningsWindow[] {
  const year = Number(today.slice(0, 4));
  const out: EarningsWindow[] = [];
  // 覆盖今年与明年的窗口（年报预告在 1 月，属于当年初）
  for (const y of [year - 1, year, year + 1]) {
    for (const s of SEASONS) {
      const deadline = s.deadline(y);
      const start = addDays(deadline, -s.startOffsetDays);
      const daysTo = daysBetween(deadline, today);
      if (daysTo < -30) continue; // 已过一个月不再展示
      if (daysTo > horizonDays) continue;
      out.push({
        name: s.name,
        deadline,
        start,
        active: today >= start && today <= deadline,
        daysToDeadline: daysTo,
      });
    }
  }
  return out.sort((a, b) => a.deadline.localeCompare(b.deadline));
}

/** 当前活跃窗口（披露期内的；无则返回 null） */
export function currentEarningsWindow(today = localDateStr()): EarningsWindow | null {
  return earningsWindows(today).find(w => w.active) ?? null;
}

export interface StockEarningsCheck {
  code: string;
  name: string;
  /** 个股下一业绩窗口（若有） */
  nextWindow: EarningsWindow | null;
  /** 是否在披露期内（个股应出财报） */
  inDisclosure: boolean;
  /** 提醒文案 */
  alert: string | null;
}

/**
 * 个股业绩窗口提醒：
 * @param stock 个股信息
 * @param customDeadline 可选：F10 实际预约披露日（更精确；无则用规则窗口）
 * @param today 今日日期
 */
export function checkStockEarnings(
  stock: { code: string; name: string },
  customDeadline?: string | null,
  today = localDateStr(),
): StockEarningsCheck {
  const windows = earningsWindows(today);
  // 若有个股预约日，用预约日构造精确窗口
  if (customDeadline && /^\d{4}-\d{2}-\d{2}$/.test(customDeadline)) {
    const daysTo = daysBetween(customDeadline, today);
    const inDisclosure = daysTo >= -7 && daysTo <= 0; // 预约日前 7 天进入提醒期
    return {
      code: stock.code,
      name: stock.name,
      nextWindow: {
        name: "预约披露",
        deadline: customDeadline,
        start: addDays(customDeadline, -7),
        active: inDisclosure,
        daysToDeadline: daysTo,
      },
      inDisclosure,
      alert: inDisclosure
        ? `${stock.name} 预约披露 ${customDeadline}（${daysTo >= 0 ? `还有 ${daysTo} 天` : `已过 ${-daysTo} 天`}）——核查业绩兑现`
        : daysTo > 0 && daysTo <= 14
          ? `${stock.name} 预约披露 ${customDeadline}（还有 ${daysTo} 天）`
          : null,
    };
  }
  // 无预约日 → 用规则窗口
  const next = windows.find(w => w.daysToDeadline >= -7);
  if (!next) return { code: stock.code, name: stock.name, nextWindow: null, inDisclosure: false, alert: null };
  const inDisclosure = next.active;
  return {
    code: stock.code,
    name: stock.name,
    nextWindow: next,
    inDisclosure,
    alert: inDisclosure
      ? `${stock.name} 处于${next.name}披露期（截止 ${next.deadline}${next.daysToDeadline >= 0 ? `，还有 ${next.daysToDeadline} 天` : ""}）`
      : null,
  };
}

/** 批量检查持仓/自选（UI 用） */
export function checkAllEarnings(
  stocks: Array<{ code: string; name: string; customDeadline?: string | null }>,
  today = localDateStr(),
): StockEarningsCheck[] {
  return stocks.map(s => checkStockEarnings(s, s.customDeadline, today));
}
