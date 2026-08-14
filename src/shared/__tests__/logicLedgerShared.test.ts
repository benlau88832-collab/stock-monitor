// shared/logic-ledger 推送分层选择器（v9.140.0 #11）
// 服务端 cron/ledger.js 与前端共用同一引擎 —— 本测试直接从 shared 导入（服务端消费路径）
import { describe, it, expect } from "vitest";
import { checkLedgerAlerts, activeEntries, selectLedgerPushCandidates } from "../../shared/logic-ledger.js";
import type { LogicEntry } from "../../shared/logic-ledger.d.ts";

const mk = (over: Partial<LogicEntry>): LogicEntry => ({
  id: "e1", code: "600001", name: "测试股",
  thesis: "逻辑", catalysts: [], breakLine: null, board: null, boardCode: null,
  status: "验证中", createdAt: 0, updatedAt: 0,
  ...over,
});

describe("checkLedgerAlerts（shared 单源）", () => {
  it("破位线触发（critical）", () => {
    const a = checkLedgerAlerts(mk({ breakLine: 10 }), { price: 9.5, boardHealthy: null, today: "2026-08-14" });
    expect(a.some(x => x.type === "break_line" && x.severity === "critical")).toBe(true);
  });

  it("催化到期窗口内（warning）", () => {
    const e = mk({ catalysts: [{ kind: "业绩", desc: "中报验证", dueDate: "2026-08-16", status: "待验证" }] });
    const a = checkLedgerAlerts(e, { price: null, boardHealthy: null, today: "2026-08-14", dueWindowDays: 3 });
    expect(a.some(x => x.type === "catalyst_due" && x.severity === "warning")).toBe(true);
  });

  it("逻辑证伪（critical）与板块退潮（warning）", () => {
    const e = mk({ board: "有色金属", catalysts: [{ kind: "价格", desc: "铜价新高", dueDate: null, status: "已证伪" }] });
    const a = checkLedgerAlerts(e, { price: null, boardHealthy: false, today: "2026-08-14" });
    expect(a.some(x => x.type === "logic_falsified" && x.severity === "critical")).toBe(true);
    expect(a.some(x => x.type === "board_ebb" && x.severity === "warning")).toBe(true);
  });

  it("板块健康未知不误报退潮", () => {
    const e = mk({ board: "有色金属" });
    const a = checkLedgerAlerts(e, { price: null, boardHealthy: null, today: "2026-08-14" });
    expect(a.some(x => x.type === "board_ebb")).toBe(false);
  });

  it("已离场不提醒", () => {
    expect(checkLedgerAlerts(mk({ status: "已离场", breakLine: 10 }), { price: 9, boardHealthy: null })).toEqual([]);
  });
});

describe("selectLedgerPushCandidates（推送分层·按天去重）", () => {
  it("已推送过的 key 不再入选（code:type 去重）", () => {
    const e1 = mk({ id: "a", breakLine: 10 });
    const pushed = new Set(["600001:break_line"]);
    const cands = selectLedgerPushCandidates([e1], { price: 9, boardHealthy: null, today: "2026-08-14" }, pushed);
    expect(cands).toEqual([]);
  });

  it("未推送的提醒入选且 critical 优先排序", () => {
    const e = mk({
      id: "b", breakLine: 10,
      board: "有色",
      catalysts: [{ kind: "业绩", desc: "中报", dueDate: "2026-08-15", status: "待验证" }],
    });
    const cands = selectLedgerPushCandidates([e], { price: 9, boardHealthy: false, today: "2026-08-14" }, new Set());
    expect(cands.length).toBe(3); // break_line + catalyst_due + board_ebb
    expect(cands[0].key).toBe("600001:break_line"); // critical 优先
  });

  it("只扫活跃持仓（已离场不推）", () => {
    const e = mk({ id: "c", status: "已离场", breakLine: 10 });
    expect(selectLedgerPushCandidates([e], { price: 9, boardHealthy: null, today: "2026-08-14" }, new Set())).toEqual([]);
  });

  it("activeEntries 过滤已离场", () => {
    const active = activeEntries([mk({ id: "1" }), mk({ id: "2", status: "已离场" })]);
    expect(active.map(x => x.id)).toEqual(["1"]);
  });
});
