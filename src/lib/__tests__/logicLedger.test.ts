// v9.138.0（波段重构·阶段一）：logicLedger 持仓逻辑台账纯函数测试
import { describe, it, expect } from "vitest";
import { checkLedgerAlerts, checkAllLedgerAlerts, activeEntries, type LogicEntry } from "../logicLedger";

const mk = (over: Partial<LogicEntry>): LogicEntry => ({
  id: "l1", code: "600001", name: "测试股",
  thesis: "铜价上涨传导业绩",
  catalysts: [
    { kind: "价格", desc: "铜价创 20 日新高", dueDate: null, status: "待验证" },
    { kind: "业绩", desc: "中报预告预增", dueDate: "2026-08-20", status: "待验证" },
  ],
  breakLine: 10.5, board: "有色金属", boardCode: "BK0478",
  status: "验证中", createdAt: 1, updatedAt: 1,
  ...over,
});

describe("checkLedgerAlerts 提醒引擎", () => {
  it("跌破破位线 → critical break_line", () => {
    const alerts = checkLedgerAlerts(mk({}), { price: 10.4, boardHealthy: true, today: "2026-08-13" });
    expect(alerts.some(a => a.type === "break_line" && a.severity === "critical")).toBe(true);
  });

  it("现价高于破位线 → 无破位提醒", () => {
    const alerts = checkLedgerAlerts(mk({}), { price: 11.2, boardHealthy: true, today: "2026-08-13" });
    expect(alerts.some(a => a.type === "break_line")).toBe(false);
  });

  it("催化验证 3 天内到期 → warning catalyst_due", () => {
    const alerts = checkLedgerAlerts(mk({}), { price: 11, boardHealthy: true, today: "2026-08-18", dueWindowDays: 3 });
    expect(alerts.some(a => a.type === "catalyst_due" && a.message.includes("中报预告"))).toBe(true);
  });

  it("催化已过到期日未更新 → info 提醒核查", () => {
    const alerts = checkLedgerAlerts(mk({}), { price: 11, boardHealthy: true, today: "2026-08-25" });
    expect(alerts.some(a => a.type === "catalyst_due" && a.severity === "info" && a.message.includes("已到期"))).toBe(true);
  });

  it("板块退潮（boardHealthy=false）→ warning board_ebb", () => {
    const alerts = checkLedgerAlerts(mk({}), { price: 11, boardHealthy: false, today: "2026-08-13" });
    expect(alerts.some(a => a.type === "board_ebb")).toBe(true);
  });

  it("催化已证伪 → critical logic_falsified", () => {
    const e = mk({ catalysts: [{ kind: "业绩", desc: "中报预告预增", dueDate: "2026-08-20", status: "已证伪" }] });
    const alerts = checkLedgerAlerts(e, { price: 11, boardHealthy: true, today: "2026-08-13" });
    expect(alerts.some(a => a.type === "logic_falsified" && a.severity === "critical")).toBe(true);
  });

  it("已离场持仓 → 不再提醒", () => {
    const alerts = checkLedgerAlerts(mk({ status: "已离场", exitReason: "破位" }), { price: 9, boardHealthy: false, today: "2026-08-13" });
    expect(alerts.length).toBe(0);
  });
});

describe("checkAllLedgerAlerts / activeEntries", () => {
  it("汇总多持仓提醒", () => {
    const e1 = mk({ id: "a", code: "600001" });
    const e2 = mk({ id: "b", code: "600002", name: "另一只", catalysts: [{ kind: "业绩", desc: "预增", dueDate: "2026-08-15", status: "待验证" }] });
    const alerts = checkAllLedgerAlerts([e1, e2], { price: 9.5, boardHealthy: false, today: "2026-08-13" });
    expect(alerts.length).toBeGreaterThanOrEqual(3); // 破位+板块退潮(e1) + 催化到期(e2)
  });

  it("activeEntries 过滤已离场", () => {
    const list = [mk({ id: "a", status: "验证中" }), mk({ id: "b", status: "已离场" })];
    expect(activeEntries(list).length).toBe(1);
  });
});
