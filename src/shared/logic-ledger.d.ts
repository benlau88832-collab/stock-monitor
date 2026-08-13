// ============================================================
// src/shared/logic-ledger.d.ts —— 持仓逻辑台账共享类型（v9.140.0 #11）
// 前端 src/lib/logicLedger.ts 与 src/shared/logic-ledger.js（服务端复用）共用；
// TS 消费方从本声明取类型；逻辑本体在 .js（双端 require/import 单一来源）
// ============================================================

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

export function bjDateStr(offset?: number): string;
export function checkLedgerAlerts(entry: LogicEntry, input: LedgerCheckInput): LogicAlert[];
export function checkAllLedgerAlerts(entries: LogicEntry[], input: LedgerCheckInput): LogicAlert[];
export function activeEntries(entries: LogicEntry[]): LogicEntry[];
export function selectLedgerPushCandidates(
  entries: LogicEntry[],
  input: LedgerCheckInput,
  alreadyPushed: Set<string>,
): Array<{ alert: LogicAlert; key: string }>;
