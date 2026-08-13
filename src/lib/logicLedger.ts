// ============================================================
// v9.138.0（波段重构·阶段一）：持仓逻辑台账 —— 波段持仓的"逻辑跟踪"核心
// 定位：波段客（3天-1个月）持仓管理的灵魂。买入后不是盯分时，而是盯：
//   ① 逻辑还在不在（为什么买：涨价/业绩/政策/题材）→ 催化验证点是否兑现/证伪
//   ② 破位线（趋势线 MA10/20 或成本线）是否被击穿
//   ③ 所属板块是否退潮（行业趋势转弱/资金流出）
// 数据：localStorage（logic_ledger_v1）+ PG kv 同步（同 decision_post 模式）
// 提醒：四类 AlertType —— break_line（破位）/ catalyst_due（催化到期）/
//        board_ebb（板块退潮）/ logic_falsified（逻辑证伪）
// v9.140.0（#11 推送分层前置）：提醒引擎单源化 —— 纯函数移至 src/shared/logic-ledger.js
//   （双端 require/import，服务端 cron 推送与前端渲染同判定，消灭逻辑漂移）；
//   本文件保留：TS 类型（re-export 自 .d.ts）+ localStorage 存储 + PG kv 同步 + 引擎 re-export
// ============================================================
import { localDateStr } from "./format";
import { isLocalServer, apiFetch } from "./cloudStore";
// v9.140.0：提醒引擎单源（shared ESM，服务端 cron/ledger.js 同 require 这一份）
import {
  checkLedgerAlerts as sharedCheckLedgerAlerts,
  checkAllLedgerAlerts as sharedCheckAllLedgerAlerts,
  activeEntries as sharedActiveEntries,
} from "../shared/logic-ledger.js";

// 类型 re-export（与旧导出签名完全一致，17+ 消费方零改动）
export type LogicStatus = import("../shared/logic-ledger.d.ts").LogicStatus;
export type CatalystKind = import("../shared/logic-ledger.d.ts").CatalystKind;
export type LogicEntry = import("../shared/logic-ledger.d.ts").LogicEntry;
export type LogicAlertType = import("../shared/logic-ledger.d.ts").LogicAlertType;
export type LogicAlert = import("../shared/logic-ledger.d.ts").LogicAlert;
export type LedgerCheckInput = import("../shared/logic-ledger.d.ts").LedgerCheckInput;

// 引擎 re-export（值，行为与 v9.138 逐字一致）
export const checkLedgerAlerts = sharedCheckLedgerAlerts;
export const checkAllLedgerAlerts = sharedCheckAllLedgerAlerts;
export const activeEntries = sharedActiveEntries;

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
  try { localStorage.setItem(LS_KEY, JSON.stringify(arr)); } catch { /* 满静默 */ }
}

export function makeLedgerId(code: string): string {
  return `${code}_${Date.now().toString(36)}`;
}
