// v9.97.0（批次 2）：技术指标信号 + 舆情词典窗口统计（tinavi 移植）
import { describe, it, expect } from "vitest";
// @ts-ignore 服务端 CJS
import { computeIndicatorSignals } from "../../../server/lib/indicators.js";
// @ts-ignore 服务端 CJS
import { keywordSentiment, sentimentWindowStats } from "../../../server/lib/keywordSentiment.js";

function genCloses(n: number, start = 10, step = 0.1): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(+(start + i * step).toFixed(2));
  return out;
}

describe("v9.97.0 computeIndicatorSignals", () => {
  it("样本不足(<30) → 空信号", () => {
    const r = computeIndicatorSignals(genCloses(20));
    expect(r.signals.length).toBe(0);
  });
  it("持续上涨 → MA 多头 + MACD 金叉 + RSI 超买", () => {
    const r = computeIndicatorSignals(genCloses(80, 10, 0.1));
    const byName = Object.fromEntries(r.signals.map((s: { name: string; bias: string }) => [s.name, s.bias]));
    expect(byName["MA5/20"]).toBe("bull");
    expect(byName["MACD"]).toBe("bull");
    expect(byName["RSI14"]).toBe("bear"); // 持续涨 → 超买
    expect(r.snapshot.ma5).toBeGreaterThan(r.snapshot.ma20);
  });
  it("持续下跌 → MA 空头 + MACD 死叉", () => {
    const r = computeIndicatorSignals(genCloses(80, 10, -0.1));
    const byName = Object.fromEntries(r.signals.map((s: { name: string; bias: string }) => [s.name, s.bias]));
    expect(byName["MA5/20"]).toBe("bear");
    expect(byName["MACD"]).toBe("bear");
  });
  it("BOLL 触及上轨 → bear（超买）", () => {
    const closes = genCloses(80);
    closes[closes.length - 1] = closes[closes.length - 2] * 1.3; // 最后一天暴涨
    const r = computeIndicatorSignals(closes);
    const boll = r.signals.find((s: { name: string }) => s.name === "BOLL");
    expect(boll?.bias).toBe("bear");
  });
});

describe("v9.97.0 keywordSentiment 词典打分", () => {
  it("正向词命中 → positive", () => {
    expect(keywordSentiment("公司中标大单，业绩增长，回购股份")).toBe("positive");
  });
  it("负向词命中 → negative", () => {
    expect(keywordSentiment("股东减持，公司亏损，立案调查")).toBe("negative");
  });
  it("正负抵消 → neutral", () => {
    expect(keywordSentiment("中标但减持")).toBe("neutral");
    expect(keywordSentiment("盈利但下滑")).toBe("neutral");
  });
  it("无命中 → neutral", () => {
    expect(keywordSentiment("公司召开例行董事会")).toBe("neutral");
  });
});

describe("v9.97.0 sentimentWindowStats 窗口统计", () => {
  const ds = (offset: number) => new Date(Date.now() + 8 * 3600 * 1000 - offset * 86400000).toISOString().slice(0, 10);
  const rows = [
    { title: "中标大单", time: `${ds(4)} 10:00` },
    { title: "股东减持", time: `${ds(5)} 10:00` },
    { title: "业绩预增", time: `${ds(6)} 10:00` },
    { title: "例行会议", time: `${ds(7)} 10:00` },
    { title: "立案调查", time: `${ds(12)} 10:00` }, // 7 日窗口外
  ];
  it("7 日窗口过滤 + 计数/占比/趋势", () => {
    const w = sentimentWindowStats(rows, 7);
    expect(w.total).toBe(4);
    expect(w.positive).toBe(2);
    expect(w.negative).toBe(1);
    expect(w.neutral).toBe(1);
    expect(w.trend).toBeCloseTo(0.25, 3);
  });
  it("30 日窗口包含更早条目", () => {
    const w = sentimentWindowStats(rows, 30);
    expect(w.total).toBe(5);
  });
  it("空数据 → 全 0", () => {
    const w = sentimentWindowStats([], 7);
    expect(w.total).toBe(0);
    expect(w.trend).toBe(0);
  });
});
