// v9.116.0（S2-3）：决策窗口判定单测 —— 9:25/13:00 必触发，其余时段不触发
import { describe, it, expect } from "vitest";
import { resolveDecisionWindow } from "../../components/DecisionCard";

// 构造北京时刻：先在本地时区（环境=东八区）构造 h:m，再回退时区差，
// 使 resolveDecisionWindow(now) 内部换算后的 bj 恰好 = 本地 h:m（=北京 h:m）
function bjTime(h: number, m: number): Date {
  const tzOffset = new Date().getTimezoneOffset();
  const local = new Date(2026, 7, 13, h, m, 0);
  return new Date(local.getTime() - (tzOffset + 480) * 60000);
}

describe("v9.116.0 决策窗口 resolveDecisionWindow（S2-3）", () => {
  it("9:25 → decisionWindow=true（竞价决策窗口）", () => {
    expect(resolveDecisionWindow(bjTime(9, 25))).toBe(true);
  });
  // v9.128.0（一致性审查 P1-3）：左闭右开——9:20 起亮、9:30 起灭（服务端已入早盘）
  it("9:20 → true；9:30 → false（边界左闭右开）", () => {
    expect(resolveDecisionWindow(bjTime(9, 20))).toBe(true);
    expect(resolveDecisionWindow(bjTime(9, 30))).toBe(false);
  });
  it("13:00 → true（午后决策窗口）", () => {
    expect(resolveDecisionWindow(bjTime(13, 0))).toBe(true);
  });
  it("10:30 / 14:00 / 15:00 → false（非窗口）", () => {
    expect(resolveDecisionWindow(bjTime(10, 30))).toBe(false);
    expect(resolveDecisionWindow(bjTime(14, 0))).toBe(false);
    expect(resolveDecisionWindow(bjTime(15, 0))).toBe(false);
  });
  it("9:15 / 13:10 → false（窗口外）", () => {
    expect(resolveDecisionWindow(bjTime(9, 15))).toBe(false);
    expect(resolveDecisionWindow(bjTime(13, 10))).toBe(false);
  });

  // v9.128.0（一致性审查 P1-3）：边界与服务端 resolveSession 左闭右开对齐
  it("9:30:00 / 13:05:00 → false（服务端已入早盘/午后，不再误亮竞价窗口）", () => {
    expect(resolveDecisionWindow(bjTime(9, 30))).toBe(false);
    expect(resolveDecisionWindow(bjTime(13, 5))).toBe(false);
  });
  it("9:29:59 / 13:04:59 → true（窗口内）", () => {
    expect(resolveDecisionWindow(bjTime(9, 29))).toBe(true);
    expect(resolveDecisionWindow(bjTime(13, 4))).toBe(true);
  });
});
