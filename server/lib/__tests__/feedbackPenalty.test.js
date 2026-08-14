import { describe, it, expect } from "vitest";
import { applyDecisionPenalty } from "../feedbackPenalty";

describe("feedbackPenalty.applyDecisionPenalty", () => {
  it("保留证据链/失效条件/持有周期字段", () => {
    const decision = {
      verdict: "波段买入",
      score: 80,
      positionRange: [10, 20],
      reasons: ["趋势"],
      blocks: [],
      holdingHorizonDays: 20,
      reviewCycleDays: 20,
      evidenceChain: [{ step: "产业链", evidence: "储能" }],
      invalidationConditions: ["跌破MA20"],
      signal: "买入",
    };
    const applied = applyDecisionPenalty(decision, { total: 1, byAttribution: { timing: 1 } });
    expect(applied.decision.holdingHorizonDays).toBe(20);
    expect(applied.decision.reviewCycleDays).toBe(20);
    expect(applied.decision.evidenceChain).toEqual(decision.evidenceChain);
    expect(applied.decision.invalidationConditions).toEqual(decision.invalidationConditions);
    expect(applied.decision.score).toBeLessThan(80);
  });

  it("无反馈时原样返回且不扣分", () => {
    const d = { verdict: "观望", score: 50, positionRange: [0, 0], reasons: [], blocks: [], signal: "观望" };
    const applied = applyDecisionPenalty(d, { total: 0, byAttribution: {} });
    expect(applied.decision.score).toBe(50);
    expect(applied.penalty.total).toBe(0);
  });
});
