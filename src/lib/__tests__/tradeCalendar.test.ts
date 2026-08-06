// v9.54/55（V7-15/V7-6）：交易日历 + 歧义概念测试
import { describe, it, expect } from "vitest";
import { isTradingDay, marketHolidayLabel, nextTradingDay, bjDateStr } from "../tradeCalendar";
import { ambiguousConcepts } from "../conceptGroups";

describe("tradeCalendar 交易日历（V7-15）", () => {
  it("2026 春节（2/17 初一）休市", () => {
    expect(isTradingDay(new Date("2026-02-17T10:00:00+08:00"))).toBe(false);
    expect(marketHolidayLabel(new Date("2026-02-17T10:00:00+08:00"))).toContain("春节");
  });

  it("2026-10-01 国庆休市", () => {
    expect(isTradingDay(new Date("2026-10-01T10:00:00+08:00"))).toBe(false);
  });

  it("2026-08-06（周四）为交易日", () => {
    expect(isTradingDay(new Date("2026-08-06T10:00:00+08:00"))).toBe(true);
  });

  it("周末休市", () => {
    expect(isTradingDay(new Date("2026-08-08T10:00:00+08:00"))).toBe(false); // 周六
    expect(marketHolidayLabel(new Date("2026-08-08T10:00:00+08:00"))).toBe("周末休市");
  });

  it("nextTradingDay 跳过节假日（2026-02-13 周五 → 节后 2/23 周一）", () => {
    const nxt = nextTradingDay(new Date("2026-02-13T10:00:00+08:00"));
    expect(bjDateStr(nxt)).toBe("2026-02-23");
  });
});

describe("conceptGroups 歧义检测（V7-6 轻量版）", () => {
  it("构造歧义概念（光模块+服务器词根）→ 返回候选大类", () => {
    const amb = ambiguousConcepts("光模块服务器");
    expect(amb).toBeTruthy();
    expect(amb!.length).toBeGreaterThanOrEqual(2);
    expect(amb).toContain("通信");
    expect(amb).toContain("算力");
  });

  it("'数据中心' 已唯一归属 算力（V7-4 去重叠达成）→ 无歧义", () => {
    expect(ambiguousConcepts("数据中心")).toBeNull();
  });

  it("'有机硅' 只命中 化工 → 无歧义", () => {
    expect(ambiguousConcepts("有机硅")).toBeNull();
  });
});
