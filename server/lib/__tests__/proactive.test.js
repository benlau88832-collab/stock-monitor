// v9.117.0（S3-1/S3-2）：时段引擎 + 主动调度单测 —— 8 阶段/2 决策窗口/非交易日/规则前置/预算
import { describe, it, expect } from "vitest";
import { resolveSession } from "../proactiveSession";
import { runProactiveTick } from "../proactiveScheduler";

// 认知层 stub（闸门放开/发酵/健康）
function cogStub(over = {}) {
  return {
    version: 3,
    asOf: "2026-08-13T10:00:00.000Z",
    sentiment: { value: { stage: "发酵", score: 75, premium: 2.4 }, provenance: { sampleSize: 4920 } },
    mainline: { value: { primaryTheme: "半导体", strength: 92, ladder: { tier1: ["A"], tier2: ["B"], tier3: ["C"] } } },
    capital: { value: { signal: "吸筹", netFlow: 48.6, darkVsLight: 18.4 } },
    risk: { value: { level: "低", traps: [], gateOpen: true } },
    leader: { value: { name: "龙头A", code: "600001", height: 3, relayOk: true } },
    ...over,
  };
}

describe("v9.117.0 时段引擎 resolveSession（S3-1）", () => {
  it("8 阶段全覆盖", () => {
    expect(resolveSession(8, 45).phase).toBe("盘前");
    expect(resolveSession(9, 18).phase).toBe("竞价");
    expect(resolveSession(10, 0).phase).toBe("早盘");
    expect(resolveSession(10, 45).phase).toBe("盘中");
    expect(resolveSession(12, 0).phase).toBe("午休");
    expect(resolveSession(13, 30).phase).toBe("午后");
    expect(resolveSession(14, 40).phase).toBe("尾盘");
    expect(resolveSession(15, 30).phase).toBe("盘后");
  });

  it("决策窗口：9:25 / 13:00 → decisionWindow=true", () => {
    expect(resolveSession(9, 25).decisionWindow).toBe(true);
    expect(resolveSession(9, 28).decisionWindow).toBe(true);
    expect(resolveSession(13, 0).decisionWindow).toBe(true);
    expect(resolveSession(13, 3).decisionWindow).toBe(true);
  });

  it("非决策窗口：10:30 / 14:00 → false", () => {
    expect(resolveSession(10, 30).decisionWindow).toBe(false);
    expect(resolveSession(14, 0).decisionWindow).toBe(false);
  });

  it("非交易日 → phase=非交易日", () => {
    expect(resolveSession(10, 0, false).phase).toBe("非交易日");
    expect(resolveSession(10, 0, false).decisionWindow).toBe(false);
  });
});

describe("v9.117.0 主动调度 runProactiveTick（S3-2）", () => {
  it("① 盘中无 LLM 洞察（规则前置 0 token）", () => {
    const { insights } = runProactiveTick(cogStub(), resolveSession(10, 45));
    expect(insights.length).toBeGreaterThan(0);
    expect(insights.every((i) => i.llmUsed === false)).toBe(true);
    expect(insights.every((i) => i.tokenCost === 0)).toBe(true);
  });

  it("② 闸门关闭（风险告警）→ riskGate 命中 alert → P0", () => {
    const cog = cogStub({ risk: { value: { level: "极高", traps: ["炸板率偏高", "负溢价", "板块出货"], gateOpen: false } } });
    const { insights } = runProactiveTick(cog, resolveSession(10, 45));
    const riskHit = insights.find((i) => i.id === "rule-风险闸门");
    expect(riskHit).toBeDefined();
    expect(riskHit.priority).toBe("P0");
    expect(riskHit.kind).toBe("风险告警");
  });

  it("③ budget.remaining ≥ 0（时段预算约束）", () => {
    const { budget } = runProactiveTick(cogStub(), resolveSession(15, 30)); // 盘后
    expect(budget.remaining).toBeGreaterThanOrEqual(0);
    expect(budget.llmBudgetTokens).toBe(2500);
    expect(budget.llmUsedTokens).toBe(2000); // 复盘1200 + 剧本800
  });

  it("盘后洞察含 LLM 标记（复盘/剧本，tokenCost 受控）", () => {
    const { insights } = runProactiveTick(cogStub(), resolveSession(15, 30));
    const llmItems = insights.filter((i) => i.llmUsed);
    expect(llmItems.length).toBe(2);
    expect(llmItems.reduce((s, i) => s + i.tokenCost, 0)).toBe(2000);
  });

  it("决策窗口 → P0 决策提示（一键裁决触达）", () => {
    const { insights } = runProactiveTick(cogStub(), resolveSession(9, 25));
    const dw = insights.find((i) => i.id === "decision-window");
    expect(dw).toBeDefined();
    expect(dw.priority).toBe("P0");
    expect(dw.kind).toBe("决策提示");
    expect(dw.action).toContain("裁决");
  });
});
