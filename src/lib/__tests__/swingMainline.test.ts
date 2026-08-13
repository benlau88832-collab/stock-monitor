// v9.138.0（波段重构·阶段一）：swingMainline 波段主线引擎纯函数测试
import { describe, it, expect } from "vitest";
import { scoreBoard, scoreTrend, scoreFund, scoreCatalyst, rankSwingBoards, type SwingBoardInput } from "../swingMainline";
import type { KlineBar } from "../swingStage";

function mkKlines(closes: number[]): KlineBar[] {
  return closes.map((c, i) => {
    const prev = i > 0 ? closes[i - 1] : c;
    return { date: `d${i}`, open: prev, close: c, high: Math.max(prev, c) * 1.01, low: Math.min(prev, c) * 0.99, volume: 100 };
  });
}

const baseBoard = (over: Partial<SwingBoardInput>): SwingBoardInput => ({
  code: "BK1000", name: "测试行业", klines: [], ...over,
});

describe("scoreTrend 趋势分", () => {
  it("主升行情（多头+站上MA20）→ 高分", () => {
    const closes = Array.from({ length: 40 }, (_, i) => 10 + i * 0.1); // 持续上行
    const r = scoreTrend(mkKlines(closes));
    expect(r.score).toBeGreaterThan(60);
    expect(r.ma20Up).toBe(true);
    expect(r.pct20d).toBeGreaterThan(5);
  });

  it("下跌趋势 → 低分", () => {
    const closes = Array.from({ length: 40 }, (_, i) => 15 - i * 0.1);
    const r = scoreTrend(mkKlines(closes));
    expect(r.score).toBeLessThan(40);
  });

  it("K线不足 → 0 分", () => {
    expect(scoreTrend(mkKlines(Array(10).fill(10))).score).toBe(0);
  });
});

describe("scoreFund 资金分", () => {
  it("10/20 日持续净流入 → 高分", () => {
    const r = scoreFund(Array.from({ length: 20 }, () => 2e8)); // 每日 +2 亿
    expect(r.score).toBeGreaterThan(70);
    expect(r.fund10d).toBeGreaterThan(10);
  });

  it("持续流出 → 低分", () => {
    const r = scoreFund(Array.from({ length: 20 }, () => -2e8));
    expect(r.score).toBeLessThan(40);
  });

  it("无数据 → 中性 50", () => {
    expect(scoreFund().score).toBe(50);
  });
});

describe("scoreCatalyst 催化分", () => {
  it("政策级催化多条 → 高分", () => {
    const r = scoreCatalyst([{ title: "国务院印发XX规划", level: "政策" }, { title: "发改委支持XX", level: "政策" }]);
    expect(r.score).toBeGreaterThan(80);
    expect(r.catalystsTop.length).toBeGreaterThan(0);
  });

  it("无催化 → 中性 50", () => {
    expect(scoreCatalyst([]).score).toBe(50);
  });
});

describe("scoreBoard 综合评分", () => {
  it("趋势+资金+催化都强 → 总分 >70", () => {
    const b = baseBoard({
      klines: mkKlines(Array.from({ length: 40 }, (_, i) => 10 + i * 0.1)),
      fundSeq: Array.from({ length: 20 }, () => 2e8),
      catalysts: [{ title: "政策利好", level: "政策" }, { title: "行业涨价", level: "行业" }],
    });
    const r = scoreBoard(b);
    expect(r.total).toBeGreaterThan(70);
    expect(r.phase).toBe("主升");
  });

  it("趋势弱+资金流出 → 总分 <45", () => {
    const b = baseBoard({
      klines: mkKlines(Array.from({ length: 40 }, (_, i) => 15 - i * 0.1)),
      fundSeq: Array.from({ length: 20 }, () => -2e8),
    });
    const r = scoreBoard(b);
    expect(r.total).toBeLessThan(45);
  });
});

describe("rankSwingBoards 排序", () => {
  it("主升优先于高总分但退潮", () => {
    const mainrise = { code: "A", name: "A", trend: 60, fund: 60, catalyst: 50, total: 58, phase: "主升", ma20Up: true, pct20d: 5, fund10d: 1, fund20d: 2, catalystsTop: [], signals: [] };
    const down = { code: "B", name: "B", trend: 90, fund: 90, catalyst: 90, total: 90, phase: "退潮", ma20Up: false, pct20d: -5, fund10d: -1, fund20d: -2, catalystsTop: [], signals: [] };
    const r = rankSwingBoards([down, mainrise]);
    expect(r[0].code).toBe("A"); // 主升排前
  });
});
