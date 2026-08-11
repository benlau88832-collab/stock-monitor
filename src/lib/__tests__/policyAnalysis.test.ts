// v9.105.0（T-E2/E3/E5）：政策引擎纯函数单测（CJS，vitest 直接 import）
import { describe, it, expect } from "vitest";
// @ts-ignore 服务端 CJS
import { extractPolicyTerms, findFirstWriteTerms, matchPolicyToBoards, POLICY_CALENDAR, policyImpactStats } from "../../../server/lib/policyAnalysis";

describe("v9.105.0 policyAnalysis", () => {
  it("T-E2 findFirstWriteTerms：低空经济场景实证（术语模式）", () => {
    const hist = ["大力推进科技创新，发展数字经济，建设数字中国。"];
    const newText = "大力发展低空经济，低空经济成为增长新引擎，布局低空经济基础设施。";
    const hits = findFirstWriteTerms([hist], newText);
    const terms = hits.map((h: any) => h.term);
    expect(terms).toContain("低空经济");
    expect(terms).not.toContain("数字经济"); // 历史已有
  });

  it("T-E2 历史语料出现过的词不报首写", () => {
    const hist = ["大力推进人工智能产业发展。"];
    const newText = "大力推进人工智能产业发展，同时发展量子科技。";
    const hits = findFirstWriteTerms([hist], newText);
    const terms = hits.map((h: any) => h.term);
    expect(terms).not.toContain("人工智能");
    expect(terms).toContain("量子科技");
  });

  it("T-E3 matchPolicyToBoards：关键词命中概念白名单", () => {
    const groups = [{ group: "机器人", roots: ["机器人", "具身智能", "减速器"] }, { group: "AI应用", roots: ["AI应用", "人工智能", "大模型"] }];
    expect(matchPolicyToBoards("具身智能", groups)).toEqual(["机器人"]);
    expect(matchPolicyToBoards("人工智能+", groups)).toContain("AI应用");
    expect(matchPolicyToBoards("不相关词", groups)).toHaveLength(0);
  });

  it("T-E5 政策日历静态表完整", () => {
    expect(POLICY_CALENDAR.length).toBeGreaterThanOrEqual(4);
    expect(POLICY_CALENDAR[0].category).toBe("五年规划");
  });

  it("T-E5 policyImpactStats：政策日后 3/5 日涨停变化", () => {
    const rows = [
      { date: "2026-08-10", pool_count: 40 }, { date: "2026-08-11", pool_count: 58 },
      { date: "2026-08-12", pool_count: 45 }, { date: "2026-08-13", pool_count: 50 },
      { date: "2026-08-14", pool_count: 62 }, { date: "2026-08-17", pool_count: 66 },
      { date: "2026-08-18", pool_count: 70 },
    ];
    const s = policyImpactStats(rows, "2026-08-11");
    // 08-11(58) → +3 交易日 08-14(62)=+4；+5 交易日 08-18(70)=+12
    expect(s!.day3Delta).toBe(4);
    expect(s!.day5Delta).toBe(12);
  });
});
