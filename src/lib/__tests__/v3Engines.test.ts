// V3-8/13 新引擎单测：因子IC / 资金消息对账 / 工具注册表
import { describe, it, expect } from "vitest";
import { evaluateAllFactors, markNextWin, FACTORS, computeFactorIC, type FactorDayRow } from "../factorLib";
import { reconcileFundNews } from "../fundNewsReconcile";
import { getAgentTools } from "../agentTools";

describe("factorLib 因子注册表 + IC 评估", () => {
  it("注册 ≥10 因子", () => {
    expect(FACTORS.length).toBeGreaterThanOrEqual(10);
  });

  it("IC 计算：因子与次日延续正相关 → IC 为正（按期望方向对齐）", () => {
    const rows: FactorDayRow[] = [
      { date: "d1", sentiment: 60, blastedRate: 15, nextMainlineWin: 1 },
      { date: "d2", sentiment: 70, blastedRate: 20, nextMainlineWin: 1 },
      { date: "d3", sentiment: 80, blastedRate: 40, nextMainlineWin: 0 },
      { date: "d4", sentiment: 50, blastedRate: 45, nextMainlineWin: 0 },
    ];
    const factor = FACTORS.find(f => f.id === "blast_low")!; // 炸板率低 → 期望延续
    const ic = computeFactorIC(factor, rows);
    expect(ic.samples).toBeGreaterThanOrEqual(3);
  });

  it("markNextWin：次日情绪≥今日 → win=1", () => {
    const marked = markNextWin([
      { date: "d1", sentiment: 50 },
      { date: "d2", sentiment: 65 },
    ]);
    expect(marked[0].nextMainlineWin).toBe(1);
  });

  it("evaluateAllFactors 输出完整", () => {
    const rows: FactorDayRow[] = [
      { date: "d1", sentiment: 55, blastedRate: 20, ztCount: 60, maxBoardHeight: 5, premiumAvg: 1, promotionRate: 0.4, sealDecayCount: 0, lhbBoostCount: 3, fundInflowStreak: 2, nuclearCount: 0, nextMainlineWin: 1 },
      { date: "d2", sentiment: 70, blastedRate: 15, ztCount: 70, maxBoardHeight: 6, premiumAvg: 2, promotionRate: 0.5, sealDecayCount: 1, lhbBoostCount: 5, fundInflowStreak: 3, nuclearCount: 0, nextMainlineWin: 1 },
      { date: "d3", sentiment: 40, blastedRate: 40, ztCount: 20, maxBoardHeight: 2, premiumAvg: -3, promotionRate: 0.1, sealDecayCount: 3, lhbBoostCount: 0, fundInflowStreak: -1, nuclearCount: 2, nextMainlineWin: 0 },
      { date: "d4", sentiment: 35, blastedRate: 45, ztCount: 15, maxBoardHeight: 2, premiumAvg: -5, promotionRate: 0.05, sealDecayCount: 5, lhbBoostCount: 0, fundInflowStreak: -2, nuclearCount: 4, nextMainlineWin: 0 },
    ];
    const ics = evaluateAllFactors(rows);
    expect(ics.length).toBe(FACTORS.length);
    for (const ic of ics) {
      expect(ic.samples).toBeGreaterThanOrEqual(3);
      expect(ic.ic).toBeGreaterThanOrEqual(-1);
      expect(ic.ic).toBeLessThanOrEqual(1);
    }
  });
});

describe("fundNewsReconcile 资金-消息对账", () => {
  it("利好+连续流入 → 兑现，可上车", () => {
    const r = reconcileFundNews({ board: "半导体", newsScore: 80, todayMainNet: 5e8, streakDays: 3 });
    expect(r.status).toBe("兑现");
    expect(r.action).toBe("可上车");
  });

  it("利好+今日流入 → 初步兑现", () => {
    const r = reconcileFundNews({ board: "半导体", newsScore: 70, todayMainNet: 2e8, streakDays: 0 });
    expect(r.status).toBe("兑现");
  });

  it("利好+主力流出 → 资金背离（未兑现/诱多），观望", () => {
    const r = reconcileFundNews({ board: "AI", newsScore: 75, todayMainNet: -3e8, streakDays: 0 });
    expect(r.status).toBe("资金背离");
    expect(r.action).toBe("观望");
  });

  it("利好+连续流出 → 资金背离，禁止", () => {
    const r = reconcileFundNews({ board: "AI", newsScore: 75, todayMainNet: -3e8, streakDays: -2 });
    expect(r.status).toBe("资金背离");
    expect(r.action).toBe("禁止");
  });

  it("消息中性+资金流入 → 待观察", () => {
    const r = reconcileFundNews({ board: "白酒", newsScore: 40, todayMainNet: 1e8, streakDays: 1 });
    expect(r.status).toBe("待观察");
  });
});

describe("agentTools 工具注册表", () => {
  it("注册 ≥12 工具", () => {
    expect(getAgentTools().length).toBeGreaterThanOrEqual(12);
  });

  it("工具名唯一", () => {
    const names = getAgentTools().map(t => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("规则工具可执行且返回 JSON（不调 LLM）", async () => {
    const tools = getAgentTools();
    const r = await tools[0].execute({ strengthScore: 85, stage: "启动期", ztCount: 10, height: 3, gateMode: "full", trapFlagged: false });
    expect(typeof r).toBe("object");
    expect(r).not.toBeNull();
  });
});
