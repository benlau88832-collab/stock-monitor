// ============================================================
// v9.138.0（波段重构·阶段一）：持仓逻辑台账 —— 波段持仓的"逻辑跟踪"核心
// 定位：波段客（3天-1个月）持仓管理的灵魂。买入后不是盯分时，而是盯：
//   ① 逻辑还在不在（为什么买：涨价/业绩/政策/题材）→ 催化验证点是否兑现/证伪
//   ② 破位线（趋势线 MA10/20 或成本线）是否被击穿
//   ③ 所属板块是否退潮（行业趋势转弱/资金流出）
// 数据：localStorage（logic_ledger_v1）+ PG kv 同步（同 decision_post 模式）
// 提醒：四类 AlertType —— break_line（破位）/ catalyst_due（催化到期）/
//        board_ebb（板块退潮）/ logic_falsified（逻辑证伪）
// 纯函数核心可单测；数据装配由 UI 完成
// ============================================================
import { localDateStr } from "./format";
import { isLocalServer, apiFetch } from "./cloudStore";

export type LogicStatus = "验证中" | "已兑现" | "已证伪" | "已离场";
export type CatalystKind = "业绩" | "价格" | "政策" | "订单" | "其他";

export interface LogicEntry {
  id: string;
  code: string;
  name: string;
  /** 买入逻辑（为什么买，一句话） */
  thesis: string;
  /** 催化验证点清单 */
  catalysts: Array<{
    kind: CatalystKind;
    desc: string;           // 验证什么（如"铜价创 20 日新高"）
    dueDate: string | null; // 验证到期日（YYYY-MM-DD；业绩=财报日，价格=持续跟踪）
    status: "待验证" | "已兑现" | "已证伪";
  }>;
  /** 破位线（跌破即离场；成本价或 MA10/20） */
  breakLine: number | null;
  /** 所属板块（板块退潮检测用） */
  board: string | null;
  boardCode: string | null;
  status: LogicStatus;
  createdAt: number;
  updatedAt: number;
  /** 离场原因（status=已离场 时） */
  exitReason?: string;
}

export type LogicAlertType = "break_line" | "catalyst_due" | "board_ebb" | "logic_falsified";

export interface LogicAlert {
  type: LogicAlertType;
  code: string;
  name: string;
  severity: "critical" | "warning" | "info";
  message: string;
  date: string;
}

const LS_KEY = "logic_ledger_v1";

// ============== 存储 ==============
export function loadLedger(): LogicEntry[] {
  try {
    const arr = JSON.parse(localStorage.getItem(LS_KEY) ?? "[]");
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

export async function saveEntry(entry: LogicEntry): Promise<void> {
  const arr = loadLedger().filter(e => e.id !== entry.id);
  arr.unshift(entry);
  try { localStorage.setItem(LS_KEY, JSON.stringify(arr.slice(0, 100))); } catch { /* 满静默 */ }
  if (isLocalServer()) {
    try {
      await apiFetch("/api/db/kv", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: `logic_ledger:${localDateStr()}`, value: JSON.stringify(arr.slice(0, 100)) }),
      });
    } catch { /* 静默 */ }
  }
}

export function removeEntry(id: string): void {
  const arr = loadLedger().filter(e => e.id !== id);
  try { localStorage.setItem(LS_KEY, JSON.stringify(arr)); } catch { /* 静默 */ }
}

export function makeLedgerId(code: string): string {
  return `${code}_${Date.now().toString(36)}`;
}

// ============== 提醒引擎（纯函数） ==============
export interface LedgerCheckInput {
  /** 现价（破位线检测） */
  price: number | null;
  /** 所属板块 MA20 是否还站上/资金方向（板块退潮检测；null=未知） */
  boardHealthy: boolean | null;
  /** 今日日期 YYYY-MM-DD */
  today?: string;
  /** 催化窗口天数（dueDate 在此天数内到期 → 提醒） */
  dueWindowDays?: number;
}

export function checkLedgerAlerts(entry: LogicEntry, input: LedgerCheckInput): LogicAlert[] {
  const today = input.today ?? localDateStr();
  const dueWindow = input.dueWindowDays ?? 3;
  const alerts: LogicAlert[] = [];
  if (entry.status === "已离场") return alerts;

  // ① 破位线（critical）
  if (entry.breakLine != null && input.price != null && input.price > 0 && input.price <= entry.breakLine) {
    alerts.push({ type: "break_line", code: entry.code, name: entry.name, severity: "critical", message: `${entry.name} 跌破破位线 ${entry.breakLine}（现价 ${input.price}）——逻辑离场条件触发`, date: today });
  }

  // ② 催化验证到期（warning）
  for (const c of entry.catalysts) {
    if (c.status !== "待验证" || !c.dueDate) continue;
    const days = Math.ceil((new Date(c.dueDate + "T00:00:00").getTime() - new Date(today + "T00:00:00").getTime()) / 86400000);
    if (days >= 0 && days <= dueWindow) {
      alerts.push({ type: "catalyst_due", code: entry.code, name: entry.name, severity: "warning", message: `${entry.name} 催化验证临近：${c.desc}（${c.dueDate}，${days}天内）`, date: today });
    }
    if (days < 0 && c.status === "待验证") {
      alerts.push({ type: "catalyst_due", code: entry.code, name: entry.name, severity: "info", message: `${entry.name} 催化验证已到期未更新：${c.desc}（${c.dueDate}）——请核查兑现/证伪`, date: today });
    }
  }

  // ③ 板块退潮（warning）
  if (entry.board != null && input.boardHealthy === false) {
    alerts.push({ type: "board_ebb", code: entry.code, name: entry.name, severity: "warning", message: `${entry.name} 所属板块「${entry.board}」趋势转弱/资金流出——考虑减仓`, date: today });
  }

  // ④ 逻辑证伪（critical：任一催化已证伪）
  const falsified = entry.catalysts.find(c => c.status === "已证伪");
  if (falsified) {
    alerts.push({ type: "logic_falsified", code: entry.code, name: entry.name, severity: "critical", message: `${entry.name} 逻辑证伪：${falsified.desc}——按纪律离场`, date: today });
  }

  return alerts;
}

/** 汇总全部持仓提醒（UI 用） */
export function checkAllLedgerAlerts(entries: LogicEntry[], input: Omit<LedgerCheckInput, "today"> & { today?: string }): LogicAlert[] {
  return entries.flatMap(e => checkLedgerAlerts(e, input));
}

/** 活跃持仓（未离场） */
export function activeEntries(entries: LogicEntry[]): LogicEntry[] {
  return entries.filter(e => e.status !== "已离场");
}
