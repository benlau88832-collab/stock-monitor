// v9.45（V5-3）：决策器命中率对账纯函数测试
import { describe, it, expect } from "vitest";
import { nextTradingDay, loadDecisionLogs } from "../decisionAttribution";

describe("decisionAttribution 决策器命中率", () => {
  it("nextTradingDay：周五 → 下周一（跳过周末）", () => {
    // 2026-08-07 是周五
    expect(nextTradingDay("2026-08-07")).toBe("2026-08-10"); // 周一
  });

  it("nextTradingDay：周三 → 周四", () => {
    expect(nextTradingDay("2026-08-05")).toBe("2026-08-06");
  });

  it("nextTradingDay：非法日期 → null", () => {
    expect(nextTradingDay("bad-date")).toBeNull();
  });

  it("loadDecisionLogs：无本地数据返回空数组（不抛错）", () => {
    const logs = loadDecisionLogs(3);
    expect(Array.isArray(logs)).toBe(true);
  });
});
