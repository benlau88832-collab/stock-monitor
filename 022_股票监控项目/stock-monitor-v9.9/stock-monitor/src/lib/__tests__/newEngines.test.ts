// 新增引擎单测：市场状态机 + 组合风险预算 + 封单衰减
import { describe, it, expect } from "vitest";
import { classifyMarketState } from "../marketStateMachine";
import { computePortfolioRisk, lossStreakOf, lossFactorOf } from "../portfolioRisk";
import { detectSealDecay, __resetSealMonitor } from "../sealMonitor";

describe("marketStateMachine 市场状态机", () => {
  it("情绪80+涨停60+炸板15%+溢价正 → 亢奋普涨", () => {
    const r = classifyMarketState({ sentiment: 80, ztCount: 60, dtCount: 0, blastedRate: 15, premiumAvg: 2, maxBoardHeight: 5 });
    expect(r.state).toBe("亢奋普涨");
    expect(r.positionFactor).toBe(1.0);
  });

  it("情绪25+跌停18 → 冰点恐慌", () => {
    const r = classifyMarketState({ sentiment: 18, ztCount: 10, dtCount: 18, blastedRate: 40, premiumAvg: -5, maxBoardHeight: 2 });
    expect(r.state).toBe("冰点恐慌");
    expect(r.positionFactor).toBe(0.2);
  });

  it("情绪30+炸板40% → 亏钱效应", () => {
    const r = classifyMarketState({ sentiment: 30, ztCount: 20, dtCount: 5, blastedRate: 40, premiumAvg: -3, maxBoardHeight: 3 });
    expect(r.state).toBe("亏钱效应");
    expect(r.positionFactor).toBe(0.4);
  });

  it("炸板率32% → 分歧震荡", () => {
    const r = classifyMarketState({ sentiment: 55, ztCount: 30, dtCount: 0, blastedRate: 32, premiumAvg: -1, maxBoardHeight: 4 });
    expect(r.state).toBe("分歧震荡");
  });

  it("涨停25+高度4板 → 局部主线", () => {
    const r = classifyMarketState({ sentiment: 60, ztCount: 25, dtCount: 0, blastedRate: 20, premiumAvg: 1, maxBoardHeight: 4 });
    expect(r.state).toBe("局部主线");
    expect(r.positionFactor).toBe(0.8);
  });
});

describe("portfolioRisk 组合风险预算", () => {
  it("亢奋普涨+无连亏 → 预算70%", () => {
    const r = computePortfolioRisk({ marketState: "亢奋普涨", positionPnlPcts: [5, 3], totalCapital: 1e6, currentPositionValue: 2e5 });
    expect(r.maxPositionPct).toBe(70);
    expect(r.overLimit).toBe(false);
  });

  it("亏钱效应 → 预算 70×0.4=28%", () => {
    const r = computePortfolioRisk({ marketState: "亏钱效应", positionPnlPcts: [5], totalCapital: 1e6, currentPositionValue: 0 });
    expect(r.maxPositionPct).toBe(28);
  });

  it("连亏3天 → 熔断系数0.4", () => {
    const r = computePortfolioRisk({ marketState: "局部主线", positionPnlPcts: [-2, -3, -1], totalCapital: 1e6, currentPositionValue: 0 });
    expect(r.lossFactor).toBe(0.4);
    expect(r.lossStreak).toBe(3);
  });

  it("当前仓位超预算 → overLimit", () => {
    const r = computePortfolioRisk({ marketState: "分歧震荡", positionPnlPcts: [1], totalCapital: 1e6, currentPositionValue: 5e5 });
    expect(r.overLimit).toBe(true);
  });

  it("v9.37: 同主线集中度80% → 折扣0.8", () => {
    const rDisp = computePortfolioRisk({ marketState: "局部主线", positionPnlPcts: [1], totalCapital: 1e6, currentPositionValue: 0 });
    const rConc = computePortfolioRisk({ marketState: "局部主线", positionPnlPcts: [1], totalCapital: 1e6, currentPositionValue: 0, concentrationPct: 0.8 });
    expect(rConc.concentrationFactor).toBe(0.8);
    expect(rConc.maxPositionPct).toBeLessThan(rDisp.maxPositionPct);
  });

  it("v9.37: 集中度>80% → 折扣0.6", () => {
    const r = computePortfolioRisk({ marketState: "局部主线", positionPnlPcts: [1], totalCapital: 1e6, currentPositionValue: 0, concentrationPct: 0.9 });
    expect(r.concentrationFactor).toBe(0.6);
  });
});

describe("lossStreakOf / lossFactorOf", () => {
  it("连续亏损计数（跳过 null）", () => {
    expect(lossStreakOf([5, -1, null, -2, -3])).toBe(3); // -3,-2,-1 连续3天
    expect(lossStreakOf([-1, -2, -3])).toBe(3);
    expect(lossStreakOf([1, 2])).toBe(0);
  });
  it("熔断系数", () => {
    expect(lossFactorOf(0)).toBe(1.0);
    expect(lossFactorOf(2)).toBe(0.75);
    expect(lossFactorOf(4)).toBe(0.4);
  });
});

describe("sealMonitor 封单衰减", () => {
  it("首轮只记录不报警", () => {
    __resetSealMonitor();
    const a1 = detectSealDecay([{ c: "600000", n: "A", fund: 8e8 }]);
    expect(a1.length).toBe(0);
  });
  it("封单-62% → 黄色预警", () => {
    __resetSealMonitor();
    detectSealDecay([{ c: "600000", n: "A", fund: 8e8 }]);
    const a2 = detectSealDecay([{ c: "600000", n: "A", fund: 3e8 }]);
    expect(a2.length).toBe(1);
    expect(a2[0].level).toBe("yellow");
  });
  it("封单崩落 -99% <500万 → 红色", () => {
    __resetSealMonitor();
    detectSealDecay([{ c: "600000", n: "A", fund: 8e8 }]);
    const a2 = detectSealDecay([{ c: "600000", n: "A", fund: 5e5 }]);
    expect(a2.length).toBe(1);
    expect(a2[0].level).toBe("red");
  });
  it("封单增加 → 无预警", () => {
    __resetSealMonitor();
    detectSealDecay([{ c: "600000", n: "A", fund: 8e8 }]);
    const a2 = detectSealDecay([{ c: "600000", n: "A", fund: 9e8 }]);
    expect(a2.length).toBe(0);
  });
});
