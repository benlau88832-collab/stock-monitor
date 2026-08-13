// ============================================================
// src/shared/logic-ledger.js —— 持仓逻辑台账提醒引擎（全栈单一数据源，v9.140.0 #11 推送分层前置）
// 前端 src/lib/logicLedger.ts（渲染/本地存储）与服务端 server/cron/ledger.js（收盘/盘中推送）
// 共用同一份提醒判定 —— 消灭双端逻辑漂移（同 concept-groups.js / trade-holidays.js 机制）。
// 纯函数、零依赖（今日日期内部按北京时间计算，不 import 任何 TS 模块）。
// 类型声明见 logic-ledger.d.ts（TS 消费方）；服务端 CJS require（Node 22+ ESM 互操作）。
// ============================================================

/** 北京时间日期串（YYYY-MM-DD） */
export function bjDateStr(offset = 0) {
  const d = new Date(Date.now() + 8 * 3600 * 1000 + offset * 86400000);
  return d.toISOString().slice(0, 10);
}

/**
 * 单条持仓的全部提醒（四类：破位/催化到期/板块退潮/逻辑证伪）
 * @param {import("./logic-ledger.d.ts").LogicEntry} entry
 * @param {import("./logic-ledger.d.ts").LedgerCheckInput} input
 * @returns {import("./logic-ledger.d.ts").LogicAlert[]}
 */
export function checkLedgerAlerts(entry, input) {
  const today = input.today ?? bjDateStr();
  const dueWindow = input.dueWindowDays ?? 3;
  const alerts = [];
  if (entry.status === "已离场") return alerts;

  // ① 破位线（critical）
  if (entry.breakLine != null && input.price != null && input.price > 0 && input.price <= entry.breakLine) {
    alerts.push({ type: "break_line", code: entry.code, name: entry.name, severity: "critical", message: `${entry.name} 跌破破位线 ${entry.breakLine}（现价 ${input.price}）——逻辑离场条件触发`, date: today });
  }

  // ② 催化验证到期（warning/info）
  for (const c of entry.catalysts || []) {
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
  const falsified = (entry.catalysts || []).find(c => c.status === "已证伪");
  if (falsified) {
    alerts.push({ type: "logic_falsified", code: entry.code, name: entry.name, severity: "critical", message: `${entry.name} 逻辑证伪：${falsified.desc}——按纪律离场`, date: today });
  }

  return alerts;
}

/** 汇总全部持仓提醒 */
export function checkAllLedgerAlerts(entries, input) {
  return (entries || []).flatMap(e => checkLedgerAlerts(e, input));
}

/** 活跃持仓（未离场） */
export function activeEntries(entries) {
  return (entries || []).filter(e => e.status !== "已离场");
}

/**
 * 服务端推送候选选择（推送分层：持仓提醒优先、按天去重）：
 * 仅返回"今日尚未推送过"的提醒（key = code:type），由调用方维护已推送集合。
 * @param {import("./logic-ledger.d.ts").LogicEntry[]} entries
 * @param {import("./logic-ledger.d.ts").LedgerCheckInput} input
 * @param {Set<string>} alreadyPushed 今日已推送 key 集合
 * @returns {Array<{alert: import("./logic-ledger.d.ts").LogicAlert, key: string}>}
 */
export function selectLedgerPushCandidates(entries, input, alreadyPushed) {
  const out = [];
  for (const e of activeEntries(entries)) {
    for (const a of checkLedgerAlerts(e, input)) {
      const key = `${a.code}:${a.type}`;
      if (alreadyPushed.has(key)) continue;
      out.push({ alert: a, key });
    }
  }
  // 分层：critical 优先（破位/证伪先推）
  out.sort((x, y) => (x.alert.severity === "critical" ? 0 : 1) - (y.alert.severity === "critical" ? 0 : 1));
  return out;
}
