// v9.103.0（T-D1）：外围映射表匹配纯函数单测（CJS shared 直接 import）
import { describe, it, expect } from "vitest";
// @ts-ignore CJS shared
import { OVERSEAS_MAP, matchOverseas } from "../../shared/overseas-map";

describe("v9.103.0 OVERSEAS_MAP（映射表完整性）", () => {
  it("首批 ≥20 条且结构完整", () => {
    expect(OVERSEAS_MAP.length).toBeGreaterThanOrEqual(20);
    for (const m of OVERSEAS_MAP as any[]) {
      expect(m.source).toBeTruthy();
      expect(m.aBoard).toBeTruthy();
      expect(Array.isArray(m.stocks)).toBe(true);
      expect(m.stocks.length).toBeGreaterThan(0);
      expect(m.chain).toBeTruthy();
      expect(m.weight).toBeGreaterThan(0);
      expect(m.weight).toBeLessThanOrEqual(1);
      expect(Array.isArray(m.kws)).toBe(true);
    }
  });

  it("AXT→云南锗业 实证映射存在", () => {
    const axt = OVERSEAS_MAP.find(m => m.source.includes("AXT"));
    expect(axt).toBeDefined();
    expect(axt!.stocks).toContain("云南锗业");
    expect(axt!.aBoard).toContain("锗");
  });

  it("matchOverseas：关键词命中（AXT 大小写不敏感）", () => {
    const hits = matchOverseas("AXT 大涨 20%，磷化铟需求爆发");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].source).toContain("AXT");
  });

  it("matchOverseas：英伟达财报 → 算力/CPO", () => {
    const hits = matchOverseas("英伟达财报超预期");
    expect(hits[0].aBoard).toContain("CPO");
  });

  it("matchOverseas：无命中 → 空数组", () => {
    expect(matchOverseas("今天天气不错")).toHaveLength(0);
    expect(matchOverseas("")).toHaveLength(0);
  });
});
