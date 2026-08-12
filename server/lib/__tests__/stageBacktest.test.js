// ============================================================
// v9.126.0（蓝图 L4 批次 C）：情绪周期回测引擎单测 ——
//   stageFromDaily（与认知层同一判定函数派生）+ stageBacktest 分阶段统计。
// ============================================================
import { describe, it, expect } from "vitest";
import { stageFromDaily, stageBacktest } from "../stageBacktest";

describe("v9.126.0 stageFromDaily（蓝图 L4 批次 C）", () => {
  it("冰点：sentiment 16 + 涨停 92 → stage 冰点（与 deriveSentimentStage 同口径）", () => {
    const r = stageFromDaily({ date: "2026-08-12", sentiment: 16, ztCount: 92, blastedRate: 12.4, maxBoardHeight: 7, premiumAvg: 1.2, promotionRate: 0.35 }, null);
    expect(r.stage).toBe("冰点");
    expect(r.ztCount).toBe(92);
    expect(r.nextPremium).toBeNull();
  });

  it("发酵：sentiment 75 + premium 2.4 + 炸板 8 → 发酵", () => {
    const r = stageFromDaily({ date: "2026-08-11", sentiment: 75, ztCount: 88, blastedRate: 8, maxBoardHeight: 6, premiumAvg: 2.4, promotionRate: 0.6 }, null);
    expect(r.stage).toBe("发酵");
  });

  it("premium<0 压制：高分 88 但 premium -1.8 → 退潮/分歧（接力亏钱不可被高分掩盖）", () => {
    const r = stageFromDaily({ date: "2026-08-10", sentiment: 88, ztCount: 90, blastedRate: 30, maxBoardHeight: 5, premiumAvg: -1.8, promotionRate: 0.2 }, null);
    expect(["退潮", "分歧"]).toContain(r.stage);
  });
});

describe("v9.126.0 stageBacktest（分阶段统计）", () => {
  it("分组统计：n/winRate/avgPremium 正确；无次日数据不入样本", () => {
    const rows = [
      { date: "d1", stage: "发酵", nextPremium: 2.0, nextPromotion: 0.5 },
      { date: "d2", stage: "发酵", nextPremium: -1.0, nextPromotion: 0.2 },
      { date: "d3", stage: "发酵", nextPremium: 1.0, nextPromotion: 0.4 },
      { date: "d4", stage: "冰点", nextPremium: -2.0, nextPromotion: 0.1 },
      { date: "d5", stage: "冰点", nextPremium: null, nextPromotion: null }, // 无次日 → 不入样本
      { date: "d6", stage: "高潮", nextPremium: 3.0, nextPromotion: 0.7 },
    ];
    const out = stageBacktest(rows);
    const fa = out.find((g) => g.stage === "发酵");
    expect(fa.n).toBe(3);
    expect(fa.winRate).toBe(67); // 2/3
    expect(fa.avgPremium).toBe(0.67); // (2-1+1)/3
    const bd = out.find((g) => g.stage === "冰点");
    expect(bd.n).toBe(1); // d5 不入样本
    const gc = out.find((g) => g.stage === "高潮");
    expect(gc.sampleEnough).toBe(false); // n=1 < 5
  });

  it("空输入/全无次日 → 空数组", () => {
    expect(stageBacktest([])).toEqual([]);
    expect(stageBacktest([{ stage: "冰点", nextPremium: null }])).toEqual([]);
  });

  it("排序：n 降序", () => {
    const rows = [
      { stage: "冰点", nextPremium: 1 }, { stage: "冰点", nextPremium: 1 },
      { stage: "冰点", nextPremium: 1 }, { stage: "发酵", nextPremium: 1 },
    ];
    const out = stageBacktest(rows);
    expect(out[0].stage).toBe("冰点");
  });
});
