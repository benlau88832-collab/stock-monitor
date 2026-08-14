import { describe, it, expect } from "vitest";
import { fallbackAnswer, brainContextToText, type BrainContext } from "../assistantAgent";

describe("v9.142.0 fallbackAnswer（AI 不可用时不输出研判）", () => {
  it("返回明确的不可用提示，不生成规则版主线/龙头摘要", async () => {
    const r = await fallbackAnswer("snapshot", "今日主线是什么", "empty content/调用失败");
    expect(r).toContain("AI 暂不可用");
    expect(r).toContain("empty content/调用失败");
    expect(r).toContain("不输出研判结论");
    expect(r).not.toContain("龙头");
  });

  it("reason 缺省时给出通用原因", async () => {
    const r = await fallbackAnswer("snapshot", "今天情绪如何");
    expect(r).toContain("AI 暂不可用");
    expect(r).toContain("empty content/调用失败");
  });
});

describe("v9.107.0 brainContextToText（上下文快照）", () => {
  const brain: BrainContext = {
    date: "2026-08-12",
    market: { ztCount: 73, blastedRate: 13, maxBoardHeight: 7, premiumAvg: 3.1, sentiment: 68 },
    mainlines: {
      asOf: "2026-08-12:1330",
      top: [
        { theme: "医药", heat: 80, trend: "发酵期", verdict: "观望", action: "", picks: [{ code: "600721", name: "百花医药", correlation: 0.9 }, { code: "600881", name: "开开实业", correlation: 0.8 }] },
        { theme: "算力", heat: 58, trend: "分歧期", verdict: "观望", action: "", picks: [{ code: "605286", name: "同力天启", correlation: 0.7 }] },
      ],
    },
    gate: { mode: "greed", factor: 0.7, label: "贪婪·去弱留强" },
  };
  it("输出主线 Top3、强度/趋势/裁决/龙头与数据时间", () => {
    const txt = brainContextToText(brain);
    expect(txt).toContain("主线Top3");
    expect(txt).toContain("医药");
    expect(txt).toContain("百花医药");
    expect(txt).toContain("2026-08-12:1330");
  });
});
