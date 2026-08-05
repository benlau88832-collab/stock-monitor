// stageModel 单一权威阶段模型 单测
import { describe, it, expect } from "vitest";
import { stageOfFunds } from "../stageModel";

describe("stageOfFunds 板块资金阶段判定", () => {
  it("今日与近5日主力净占比均为负 → 退潮期", () => {
    const r = stageOfFunds({ pct: 1, mainNetPct: -0.5, mainNet5dPct: -2, mainNet10dPct: -1 });
    expect(r.stage).toBe("退潮期");
  });

  it("涨幅≥7%但主力不跟 → 分歧期（量价背离）", () => {
    const r = stageOfFunds({ pct: 8, mainNetPct: -1, mainNet5dPct: 2, mainNet10dPct: 1 });
    expect(r.stage).toBe("分歧期");
  });

  it("5日资金强+今日流入+涨幅放大 → 高潮期", () => {
    const r = stageOfFunds({ pct: 6, mainNetPct: 1, mainNet5dPct: 2.5, mainNet10dPct: 1 });
    expect(r.stage).toBe("高潮期");
  });

  it("5日/10日持续为正走强 → 发酵期", () => {
    const r = stageOfFunds({ pct: 3, mainNetPct: 0.5, mainNet5dPct: 4, mainNet10dPct: 2 });
    expect(r.stage).toBe("发酵期");
  });

  it("今日转正但5日累计小 → 启动期", () => {
    const r = stageOfFunds({ pct: 2, mainNetPct: 0.5, mainNet5dPct: 0.5, mainNet10dPct: 0.3 });
    expect(r.stage).toBe("启动期");
  });

  it("信号不够一致 → 观察中", () => {
    const r = stageOfFunds({ pct: 3, mainNetPct: 0.5, mainNet5dPct: 2, mainNet10dPct: 0.5 });
    expect(r.stage).toBe("观察中");
  });
});
