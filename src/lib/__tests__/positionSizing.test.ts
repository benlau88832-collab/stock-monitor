// positionSizing 仓位定量化引擎 单测
import { describe, it, expect } from "vitest";
import { computePositionAdvice } from "../positionSizing";

const gate = { mode: "full" as const, factor: 1.0, positionLimit: 100, riskLevel: "low" as const, label: "正常", reason: [] };
const discipline = { maxSinglePct: 30, maxTotalPct: 100, maxNewPositionsPerDay: 3, totalCapital: 1000000, cooldownLossStreak: 3 };

const base = {
  mainline: "AI应用",
  strengthScore: 85,
  stage: "启动期" as const,
  gate,
  discipline,
  currentTotalPct: 0,
  todayNewPositions: 0,
};

describe("computePositionAdvice 仓位定量化", () => {
  it("强度85+闸门1.0+启动期 → 可上车 30%（单票上限）", () => {
    const r = computePositionAdvice(base);
    expect(r.action).toBe("可上车");
    expect(r.suggestedPct).toBeGreaterThanOrEqual(25);
    expect(r.suggestedPct).toBeLessThanOrEqual(30);
  });

  it("强度65 → 0.6 折扣（约18%）", () => {
    const r = computePositionAdvice({ ...base, strengthScore: 65 });
    expect(r.suggestedPct).toBeGreaterThanOrEqual(14);
    expect(r.suggestedPct).toBeLessThanOrEqual(20);
  });

  it("闸门0.5 → 仓位减半", () => {
    const rFull = computePositionAdvice(base);
    const rHalf = computePositionAdvice({ ...base, gate: { ...gate, factor: 0.5 } });
    expect(rHalf.suggestedPct).toBeLessThan(rFull.suggestedPct);
    expect(rHalf.suggestedPct * 2).toBeGreaterThanOrEqual(rFull.suggestedPct - 2);
  });

  it("高潮期 → 观望（非最佳介入窗口）", () => {
    const r = computePositionAdvice({ ...base, stage: "高潮期" });
    expect(r.action).toBe("观望");
  });

  it("退潮期 → 禁止", () => {
    const r = computePositionAdvice({ ...base, stage: "退潮期" });
    expect(r.action).toBe("禁止");
  });

  it("主线诱多 → 禁止", () => {
    const r = computePositionAdvice({ ...base, mainlineTrap: true });
    expect(r.action).toBe("禁止");
  });

  it("今日已开仓达上限 → 禁止", () => {
    const r = computePositionAdvice({ ...base, todayNewPositions: 3 });
    expect(r.action).toBe("禁止");
  });

  it("梯队断档 → 仓位降档 0.6", () => {
    const rOk = computePositionAdvice(base);
    const rBroken = computePositionAdvice({ ...base, ladderBroken: true });
    expect(rBroken.suggestedPct).toBeLessThan(rOk.suggestedPct);
  });
});
