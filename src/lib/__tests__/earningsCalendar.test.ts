// v9.138.0（波段重构·阶段一）：earningsCalendar 业绩验证日历纯函数测试
import { describe, it, expect } from "vitest";
import { earningsWindows, currentEarningsWindow, checkStockEarnings, checkAllEarnings } from "../earningsCalendar";

describe("earningsWindows 财报窗口", () => {
  it("8 月下旬 → 中报披露期活跃，三季报在 10 月底", () => {
    const ws = earningsWindows("2026-08-20", 90);
    const active = ws.find(w => w.active);
    expect(active?.name).toBe("中报");
    expect(active?.deadline).toBe("2026-08-31");
    expect(ws.some(w => w.name === "三季报" && w.deadline === "2026-10-31")).toBe(true);
  });

  it("1 月中旬 → 年报预告窗口（1/31 前）", () => {
    const ws = earningsWindows("2026-01-15", 90);
    const active = ws.find(w => w.active);
    expect(active?.name).toBe("年报预告");
    expect(active?.deadline).toBe("2026-01-31");
  });

  it("4 月下旬 → 年报+一季报双窗口", () => {
    const ws = earningsWindows("2026-04-20", 90);
    const names = ws.filter(w => w.active).map(w => w.name);
    expect(names).toContain("年报");
    expect(names).toContain("一季报");
  });

  it("窗口按截止日排序", () => {
    const ws = earningsWindows("2026-08-13", 90);
    const deadlines = ws.map(w => w.deadline);
    expect([...deadlines].sort()).toEqual(deadlines);
  });
});

describe("currentEarningsWindow", () => {
  it("非披露期 → null", () => {
    expect(currentEarningsWindow("2026-09-10")).toBeNull();
  });
});

describe("checkStockEarnings 个股提醒", () => {
  it("无预约日，披露期内 → alert 提示核查", () => {
    const r = checkStockEarnings({ code: "600001", name: "测试股" }, null, "2026-08-20");
    expect(r.inDisclosure).toBe(true);
    expect(r.alert).toContain("中报披露期");
  });

  it("有个股预约日，临近 → 精确提醒", () => {
    const r = checkStockEarnings({ code: "600001", name: "测试股" }, "2026-08-22", "2026-08-13");
    expect(r.nextWindow?.deadline).toBe("2026-08-22");
    expect(r.alert).toContain("还有 9 天");
  });

  it("披露日已过 → 提醒已过", () => {
    const r = checkStockEarnings({ code: "600001", name: "测试股" }, "2026-08-10", "2026-08-13");
    expect(r.alert).toContain("已过 3 天");
  });

  it("远离窗口 → 无提醒", () => {
    const r = checkStockEarnings({ code: "600001", name: "测试股" }, null, "2026-06-10");
    expect(r.alert).toBeNull();
  });
});

describe("checkAllEarnings 批量", () => {
  it("批量检查返回等长结果", () => {
    const rs = checkAllEarnings(
      [{ code: "600001", name: "A" }, { code: "600002", name: "B", customDeadline: "2026-08-20" }],
      "2026-08-13",
    );
    expect(rs.length).toBe(2);
    expect(rs[0].code).toBe("600001");
  });
});
