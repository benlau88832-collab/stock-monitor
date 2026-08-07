// v11-1（P0）：strengthCompleteness 级联根因验收测试
import { describe, it, expect } from "vitest";
import { calcMainlineStrength } from "../mainlineScore";

describe("V11-1 mainlineScore completeness 级联修复", () => {
  const base = {
    ztCount: 12, totalZtCount: 50,
    height: 3, totalMaxHeight: 6,
    mainNet5d: 1.2e8, boardPct: 4.2,
    catalystStrength: 60,
  };

  it("promotionRate=null 且进阶字段全 null → dataCompleteness ≥ 0.5（不再永远无可交易）", () => {
    const r = calcMainlineStrength({ ...base, promotionRate: null, mainNet10d: null, turnoverRate: null });
    expect(r.dataCompleteness).toBeGreaterThanOrEqual(0.5);
    expect(r.dataCompleteness).toBeLessThan(0.7); // 基础字段缺失 → 不虚高
  });

  it("promotionRate 有值 + 进阶字段部分缺失 → completeness 更高", () => {
    const r = calcMainlineStrength({ ...base, promotionRate: 0.4, mainNet10d: null, turnoverRate: null });
    expect(r.dataCompleteness).toBeGreaterThan(0.7);
  });

  it("全部字段齐全 → completeness = 1", () => {
    const r = calcMainlineStrength({ ...base, promotionRate: 0.4, mainNet10d: 2e8, turnoverRate: 5 });
    expect(r.dataCompleteness).toBe(1);
  });

  it("缺失字段仍被列出（提示保留，不影响判定）", () => {
    const r = calcMainlineStrength({ ...base, promotionRate: null, mainNet10d: null, turnoverRate: null });
    expect(r.missingFields).toContain("晋级率");
    expect(r.missingFields).toContain("10日资金");
    expect(r.missingFields).toContain("换手率");
  });
});
