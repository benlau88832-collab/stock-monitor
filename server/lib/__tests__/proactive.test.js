// v9.117.0（S3-1/S3-2）+ v9.119.0（S3-3 补全）：时段引擎 + 主动调度单测 —— 8 阶段/决策窗口/规则前置/预算/LLM 润色
import { describe, it, expect } from "vitest";
import { resolveSession } from "../proactiveSession";
import { runProactiveTick, refineInsightsWithLLM } from "../proactiveScheduler";
import { ruleLeaderHealth } from "../proactiveRules"; // v9.123.0（卓越审查 P1-4）

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

  it("③ budget.remaining ≥ 0（时段预算约束；骨架 0 实际消耗）", () => {
    const { budget } = runProactiveTick(cogStub(), resolveSession(15, 30)); // 盘后
    expect(budget.remaining).toBeGreaterThanOrEqual(0);
    expect(budget.llmBudgetTokens).toBe(2500);
    // v9.119.0 语义：llmUsedTokens 只计实际润色消耗（规则骨架 0）—— 剩余预算足够润色复盘/剧本
    expect(budget.llmUsedTokens).toBe(0);
    expect(budget.remaining).toBe(2500);
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

  // v9.123.0（卓越审查 P1-4）：龙头数据缺失（涨停池空/溢价未就绪）不误报断板告警
  it("ruleLeaderHealth：数据缺失（relayData=missing）→ 不 fired；真转弱 → alert", () => {
    const missing = ruleLeaderHealth(cogStub({ leader: { value: { name: "—", code: "", height: 0, relayOk: false, relayData: "missing" } } }));
    expect(missing.fired).toBe(false);
    expect(missing.severity).toBe("info");
    const weak = ruleLeaderHealth(cogStub({ leader: { value: { name: "龙头A", code: "600001", height: 3, relayOk: false, relayData: "ok" } } }));
    expect(weak.fired).toBe(true);
    expect(weak.severity).toBe("alert");
  });
});

// v9.119.0（S3-3 补全）：LLM 润色接线 —— 预算降级 / 失败回退 / 成功润色（依赖注入 mock，不真调 LLM）
describe("v9.119.0 refineInsightsWithLLM（LLM 润色接线）", () => {
  function mkTick(phase = "盘后") {
    return runProactiveTick(cogStub(), resolveSession(15, 30));
  }

  it("预算不足 → LLM 条目降级为规则原文（0 token，预算硬上限）", async () => {
    const tick = mkTick();
    const poorBudget = { ...tick.budget, remaining: 0, llmUsedTokens: tick.budget.llmBudgetTokens }; // 预算耗尽
    const { insights, budget } = await refineInsightsWithLLM(tick.insights, cogStub(), poorBudget, async () => "LLM 不应被调用");
    expect(insights.filter((i) => i.llmUsed)).toHaveLength(0);
    expect(budget.llmUsedTokens).toBe(tick.budget.llmBudgetTokens); // 预算已耗尽，无新增消耗
    expect(insights.find((i) => i.id === "eod-review").body).toContain("预算不足");
  });

  it("LLM 调用失败 → 回退规则原文（永不降级）", async () => {
    const tick = mkTick();
    const { insights } = await refineInsightsWithLLM(tick.insights, cogStub(), tick.budget, async () => { throw new Error("upstream 503"); });
    const eod = insights.find((i) => i.id === "eod-review");
    expect(eod.llmUsed).toBe(false);
    expect(eod.tokenCost).toBe(0);
    expect(eod.body).toContain("今日主线"); // 规则原文保留
  });

  it("LLM 成功 → body 被润色且 tokenCost 计入预算（复盘1200+剧本800=2000）", async () => {
    const tick = mkTick();
    const { insights, budget } = await refineInsightsWithLLM(tick.insights, cogStub(), tick.budget, async () => "今日半导体主线延续，龙头封板。复盘要点已整理。");
    const eod = insights.find((i) => i.id === "eod-review");
    expect(eod.llmUsed).toBe(true);
    expect(eod.body).toContain("半导体");
    expect(budget.llmUsedTokens).toBe(2000); // 复盘 1200 + 剧本 800 实际消耗
    expect(budget.remaining).toBe(2500 - 2000);
  });

  it("LLM 返回过短（<10 字）→ 视为失败回退", async () => {
    const tick = mkTick();
    const { insights } = await refineInsightsWithLLM(tick.insights, cogStub(), tick.budget, async () => "好");
    expect(insights.find((i) => i.id === "eod-review").llmUsed).toBe(false);
  });

  // v9.123.0（卓越审查 P0-4）：质量闸——模型对占位语料的"拒绝语/元输出"不得出面板
  it("LLM 返回拒绝语（'请提供…'）→ 回退规则原文", async () => {
    const tick = mkTick();
    const { insights } = await refineInsightsWithLLM(tick.insights, cogStub(), tick.budget, async () => "请提供盘面要点，我将按不超过100字整理成中文简报。");
    const eod = insights.find((i) => i.id === "eod-review");
    expect(eod.llmUsed).toBe(false);
    expect(eod.tokenCost).toBe(0);
    expect(eod.body).toContain("今日主线"); // 规则原文保留
  });

  // v9.123.0（T-8）：部分预算——复盘(1200)降级、剧本(800)照常润色
  it("部分预算 remaining=1000 → 仅 1200 条目降级、800 条目润色", async () => {
    const tick = mkTick();
    const partial = { ...tick.budget, remaining: 1000, llmUsedTokens: 0 };
    const { insights, budget } = await refineInsightsWithLLM(tick.insights, cogStub(), partial, async () => "明日剧本情景已整理完毕。");
    const eod = insights.find((i) => i.id === "eod-review");
    const play = insights.find((i) => i.id === "next-day-playbook");
    expect(eod.llmUsed).toBe(false);
    expect(eod.body).toContain("预算不足");
    expect(play.llmUsed).toBe(true);
    expect(budget.llmUsedTokens).toBe(800);
    expect(budget.remaining).toBe(200);
  });
});

// v9.122.0（卓越 S3-2b）：推理层前瞻预判接入主动调度（⑤ 验收）
describe("v9.122.0 runProactiveTick 消费 forecast.conditions（S3-2b）", () => {
  it("传入 reasoning → insights 含 kind=前瞻预判 且 llmUsed=false（0 token）", () => {
    const reasoning = {
      forecast: {
        conditions: [
          { iff: "炸板率>20% 或 昨涨停今溢价转负", then: "高低切：减高位接力，低吸新主线首板" },
          { iff: "龙头放量烂板/尾盘炸板", then: "接力梯队瓦解预警，清跟风" },
        ],
      },
    };
    const { insights } = runProactiveTick(cogStub(), resolveSession(10, 45), undefined, reasoning);
    const fc = insights.filter((i) => i.kind === "前瞻预判");
    expect(fc.length).toBe(2);
    expect(fc[0].title).toContain("炸板率>20%");
    expect(fc[0].body).toContain("高低切");
    expect(fc[0].llmUsed).toBe(false);
    expect(fc[0].tokenCost).toBe(0);
    expect(fc[0].priority).toBe("P1"); // 非决策窗口
  });

  it("决策窗口 + reasoning → 前瞻预判 P0（一键裁决触达）", () => {
    const reasoning = { forecast: { conditions: [{ iff: "龙头开板", then: "只持不开" }] } };
    const { insights } = runProactiveTick(cogStub(), resolveSession(9, 25), undefined, reasoning);
    const fc = insights.find((i) => i.kind === "前瞻预判");
    expect(fc).toBeDefined();
    expect(fc.priority).toBe("P0");
    expect(fc.action).toContain("决策卡");
  });

  it("无 reasoning（推理层不可用）→ 无前瞻预判洞察（静默兼容）", () => {
    const { insights } = runProactiveTick(cogStub(), resolveSession(10, 45));
    expect(insights.filter((i) => i.kind === "前瞻预判")).toHaveLength(0);
  });
});
