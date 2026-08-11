// v9.101.1（T-B1）：EV 期望值统计纯函数单测
import { describe, it, expect } from "vitest";
import { computeEvStats } from "../evStats";

describe("v9.101.1 computeEvStats（胜率/赔率/EV）", () => {
  it("正常样本：胜率/赔率/EV 计算正确", () => {
    // 5 正（+5,+4,+3,+2,+1）+ 5 负（-2×5）→ 胜率 50%，avgWin=3，avgLoss=2，赔率 1.5，EV=0.5×3-0.5×2=0.5
    const rets = [5, 4, 3, 2, 1, -2, -2, -2, -2, -2];
    const s = computeEvStats(rets, 5);
    expect(s.sampleCount).toBe(10);
    expect(s.accumulated).toBe(true);
    expect(s.winRate).toBe(50);
    expect(s.avgWin).toBe(3);
    expect(s.avgLoss).toBe(2);
    expect(s.payoff).toBe(1.5);
    expect(s.ev).toBe(0.5);
    expect(s.label).toContain("胜率 50%");
  });

  it("样本 < 门槛 → accumulated=false（积累中）", () => {
    const s = computeEvStats([1, 2, -1], 20);
    expect(s.accumulated).toBe(false);
    expect(s.label).toContain("积累中");
  });

  it("空样本 → 全 null + 积累中", () => {
    const s = computeEvStats([], 20);
    expect(s.winRate).toBeNull();
    expect(s.ev).toBeNull();
    expect(s.accumulated).toBe(false);
  });

  it("全赢无亏损 → 赔率用 1 保底不除零，EV 为正", () => {
    const s = computeEvStats([3, 4, 5], 3);
    expect(s.avgLoss).toBeNull();
    expect(s.payoff).toBe(4); // avgWin=4 / 1
    expect(s.ev).toBe(4);
    expect(s.winRate).toBe(100);
  });

  it("全亏无盈利 → EV 为负", () => {
    const s = computeEvStats([-2, -3, -4], 3);
    expect(s.winRate).toBe(0);
    expect(s.avgWin).toBeNull();
    expect(s.ev).toBe(-3);
  });
});
