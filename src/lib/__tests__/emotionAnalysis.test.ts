// v9.129.0（一致性收敛）：情绪分析周期判定单源化——determineCyclePhaseVibeAlpha
//   改为消费认知层 deriveSentimentStage（六词唯一词表），原 5 档组合词判定废弃。
//   个股情绪分加权合成（computeStockSentimentScore）不变（不同概念：个股维度）。
import { describe, it, expect } from "vitest";
// 服务端 CJS 模块（与 buildPromptConsistency 同模式引用）
// @ts-ignore
import { determineCyclePhaseVibeAlpha, computeStockSentimentScore } from "../../../server/lib/emotionAnalysis.js";

describe("v9.129.0 determineCyclePhaseVibeAlpha（认知层六词单源）", () => {
  it("情绪 16 分 → 冰点（与认知层同判定）", () => {
    const r = determineCyclePhaseVibeAlpha({ ztCount: 92, zbCount: 13, dtCount: 0, maxBoardHeight: 7, sentiment: 16, blastedRate: 12.4, premiumAvg: 1.2 });
    expect(r.phase).toBe("冰点");
    expect(r.rule).toContain("认知层判定");
  });
  it("情绪 75 分 + 溢价 2.4 → 发酵", () => {
    const r = determineCyclePhaseVibeAlpha({ ztCount: 88, zbCount: 8, dtCount: 0, maxBoardHeight: 6, sentiment: 75, blastedRate: 8, premiumAvg: 2.4 });
    expect(r.phase).toBe("发酵");
  });
  it("情绪 88 + 溢价 -1.8 + 炸板 30% → 退潮/分歧（负溢价压制，高分不得掩盖亏钱效应）", () => {
    const r = determineCyclePhaseVibeAlpha({ ztCount: 90, zbCount: 30, dtCount: 0, maxBoardHeight: 5, sentiment: 88, blastedRate: 30, premiumAvg: -1.8 });
    expect(["退潮", "分歧"]).toContain(r.phase);
  });
  it("情绪缺失 → 中性 50 → 启动", () => {
    const r = determineCyclePhaseVibeAlpha({ ztCount: 30, zbCount: 10, dtCount: 0, maxBoardHeight: 3 });
    expect(r.phase).toBe("启动");
  });
  it("炸板数缺失时封板率按提供值或 null（证据字段行为保留）", () => {
    const r = determineCyclePhaseVibeAlpha({ ztCount: 30, zbCount: null, dtCount: 5, maxBoardHeight: 2, sealRate: 80, sentiment: 50, blastedRate: 10 });
    expect(r.sealRate).toBe(80);
    const r2 = determineCyclePhaseVibeAlpha({ ztCount: 30, zbCount: null, dtCount: 5, maxBoardHeight: 2, sentiment: 50, blastedRate: 10 });
    expect(r2.sealRate).toBe(null);
  });
});

describe("v9.96.0 computeStockSentimentScore 加权合成（个股维度，保留）", () => {
  it("全缺 → 默认中性 50", () => {
    const r = computeStockSentimentScore({});
    expect(r.score).toBe(50);
    expect(r.parts.length).toBe(0);
  });
  it("主力净流入强 → 高分（40 权重主导）", () => {
    const r = computeStockSentimentScore({ mainNet5dRatio: 1, mainNetTrend: null, northbound5d: null, retailSellRatio: null });
    expect(r.score).toBe(90); // 50 + 1*40
  });
  it("散户流出占比高（反向）→ 低分", () => {
    const r = computeStockSentimentScore({ mainNet5dRatio: null, mainNetTrend: null, northbound5d: null, retailSellRatio: 1 });
    expect(r.score).toBe(20); // 50 - 1*30
  });
  it("部分缺项 → 按剩余权重重归一化（40+10 权重合成）", () => {
    const r = computeStockSentimentScore({ mainNet5dRatio: 0.5, mainNetTrend: null, northbound5d: null, retailSellRatio: 0.5 });
    // 40 权重: 50+0.5*40=70；10 权重: 50-0.5*30=35；合成 = 70*0.8 + 35*0.2 = 63
    expect(r.score).toBe(63);
  });
  it("结果 clamp 0-100", () => {
    const r = computeStockSentimentScore({ mainNet5dRatio: 3, mainNetTrend: null, northbound5d: null, retailSellRatio: null });
    expect(r.score).toBe(100);
  });
});
