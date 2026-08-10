// v9.96.0（批次 1）：情绪分析引擎 —— 周期规则 5 档边界 + 个股情绪分加权（VibeAlpha 移植）
import { describe, it, expect } from "vitest";
// 服务端 CJS 模块（与 buildPromptConsistency 同模式引用）
// @ts-ignore
import { determineCyclePhaseVibeAlpha, computeStockSentimentScore } from "../../../server/lib/emotionAnalysis.js";

describe("v9.96.0 determineCyclePhaseVibeAlpha 5 档规则引擎", () => {
  it("跌停>20 且 涨停<30 → 冰点/退潮", () => {
    const r = determineCyclePhaseVibeAlpha({ ztCount: 25, zbCount: 10, dtCount: 25, maxBoardHeight: 2 });
    expect(r.phase).toBe("冰点/退潮");
  });
  it("封板率<60 且 炸板>20 → 强分歧/炸板潮", () => {
    const r = determineCyclePhaseVibeAlpha({ ztCount: 40, zbCount: 30, dtCount: 5, maxBoardHeight: 4 });
    expect(r.phase).toBe("强分歧/炸板潮");
    expect(r.sealRate).toBeCloseTo(57.14, 1); // 40/(40+30)
  });
  it("封板率>75 且 涨停>50 → 高潮/主升", () => {
    const r = determineCyclePhaseVibeAlpha({ ztCount: 60, zbCount: 10, dtCount: 2, maxBoardHeight: 5 });
    expect(r.phase).toBe("高潮/主升");
    expect(r.sealRate).toBeCloseTo(85.71, 1);
  });
  it("涨停>40 且 高度≥3 → 发酵/启动", () => {
    const r = determineCyclePhaseVibeAlpha({ ztCount: 45, zbCount: 20, dtCount: 3, maxBoardHeight: 3 });
    expect(r.phase).toBe("发酵/启动");
  });
  it("不满足以上 → 震荡/轮动", () => {
    const r = determineCyclePhaseVibeAlpha({ ztCount: 30, zbCount: 15, dtCount: 5, maxBoardHeight: 2 });
    expect(r.phase).toBe("震荡/轮动");
  });
  it("炸板数缺失时封板率按提供值或 null", () => {
    const r = determineCyclePhaseVibeAlpha({ ztCount: 30, zbCount: null, dtCount: 5, maxBoardHeight: 2, sealRate: 80 });
    expect(r.sealRate).toBe(80);
    const r2 = determineCyclePhaseVibeAlpha({ ztCount: 30, zbCount: null, dtCount: 5, maxBoardHeight: 2 });
    expect(r2.sealRate).toBe(null);
  });
});

describe("v9.96.0 computeStockSentimentScore 加权合成", () => {
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
