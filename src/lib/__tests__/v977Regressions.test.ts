// ============================================================
// v9.77 回归测试 —— 覆盖本次 V2 审查修复的关键行为
// 1. sealMonitor 封单红档重标定（8亿→5000万红牌 / 归零红牌 / 逐步撤单累计）
// 2. prevZtStats 核按钮 10/20cm 分档（20cm 普通回调不再误报）
// 3. stockPicker 仓位聚合截断 + 卡位胶着降级
// ============================================================
import { describe, it, expect, beforeEach } from "vitest";
import { detectSealDecay, __resetSealMonitor } from "../sealMonitor";
import { computePrevZtStats } from "../prevZtStats";
import { pickStocks } from "../stockPicker";
import type { MainlineGroup } from "../stockToMainline";
import type { ThemeStock } from "../themeLadder";

// ============== sealMonitor ==============
describe("sealMonitor v9.77 红档重标定", () => {
  beforeEach(() => __resetSealMonitor());

  it("亿级封单 8亿→5000万 单步崩落 → 红牌（相对基准×10%，脱离 500万 绝对额）", () => {
    detectSealDecay([{ c: "600001", n: "A", fund: 800000000, lbc: 3 }]); // 第一轮建立基准
    const alerts = detectSealDecay([{ c: "600001", n: "A", fund: 50000000, lbc: 3 }]); // -93.75%
    const red = alerts.find(a => a.code === "600001");
    expect(red?.level).toBe("red");
    expect(red?.changePct).toBeLessThanOrEqual(-80);
  });

  it("封单从有到 0 → 红牌炸板确认（原 fund<=0 continue 永不报）", () => {
    detectSealDecay([{ c: "600002", n: "B", fund: 100000000, lbc: 2 }]);
    const alerts = detectSealDecay([{ c: "600002", n: "B", fund: 0, lbc: 2 }]);
    expect(alerts.find(a => a.code === "600002")?.level).toBe("red");
  });

  it("逐步撤单式出货（每轮 -30%，累计 -51%）→ 黄牌（累计基准检测）", () => {
    detectSealDecay([{ c: "600003", n: "C", fund: 800000000, lbc: 2 }]);
    detectSealDecay([{ c: "600003", n: "C", fund: 560000000, lbc: 2 }]); // -30%（未达单步 -50%）
    const alerts = detectSealDecay([{ c: "600003", n: "C", fund: 390000000, lbc: 2 }]); // 累计 -51%
    expect(alerts.find(a => a.code === "600003")?.level).toBe("yellow");
  });

  it("小幅波动（-10%）→ 不告警", () => {
    detectSealDecay([{ c: "600004", n: "D", fund: 100000000, lbc: 2 }]);
    const alerts = detectSealDecay([{ c: "600004", n: "D", fund: 90000000, lbc: 2 }]);
    expect(alerts.filter(a => a.code === "600004").length).toBe(0);
  });
});

// ============== prevZtStats 核按钮分档 ==============
describe("prevZtStats v9.77 核按钮按涨跌幅限制分档", () => {
  it("主板 2板 跌 -9.5% → 核按钮（主板阈值 -9%）", () => {
    const r = computePrevZtStats({
      prevZTPool: [{ c: "600000", n: "A", lbc: 2 }],
      todayRawPool: [],
      briefMap: new Map([["600000", { pct: -9.5 }]]),
    });
    expect(r.nuclearAlerts.length).toBe(1);
  });

  it("20cm 股跌 -9.5% → 不触发核按钮（20cm 阈值 -19%，普通回调不是退潮信号）", () => {
    const r = computePrevZtStats({
      prevZTPool: [{ c: "300001", n: "B", lbc: 2 }],
      todayRawPool: [],
      briefMap: new Map([["300001", { pct: -9.5 }]]),
    });
    expect(r.nuclearAlerts.length).toBe(0);
  });

  it("20cm 股跌 -19.5% → 核按钮（接近跌停 -20%）", () => {
    const r = computePrevZtStats({
      prevZTPool: [{ c: "300001", n: "B", lbc: 2 }],
      todayRawPool: [],
      briefMap: new Map([["300001", { pct: -19.5 }]]),
    });
    expect(r.nuclearAlerts.length).toBe(1);
  });
});

// ============== stockPicker 仓位聚合截断 + 卡位 ==============
const mkMainline = (over: Partial<MainlineGroup> = {}): MainlineGroup => ({
  mainline: "算力", ztCount: 6, height: 4, mainNet: 1e8, mainNet5d: 5e8, boardPct: 3.2,
  newsTitles: [], isPulse: false, logic: "测试", caution: "", score: 80, fromLLM: true, strengthScore: 80,
  leaders: [
    { code: "600001", name: "龙头A", role: "龙一", boardCount: 4, firstBoardTime: "09:30:05", sealFund: 8e8, amount: 1e9, pct: 10, reason: "", popularRank: 1 },
    { code: "600002", name: "龙二B", role: "龙二", boardCount: 3, firstBoardTime: "09:45:00", sealFund: 3e8, amount: 5e8, pct: 10, reason: "", popularRank: 2 },
    { code: "600003", name: "龙三C", role: "龙三", boardCount: 2, firstBoardTime: "10:00:00", sealFund: 1e8, amount: 3e8, pct: 10, reason: "", popularRank: 3 },
  ],
  ...over,
});

const mkStock = (over: Partial<ThemeStock>): ThemeStock => ({
  code: "600000", name: "测试", price: 10, pct: 10, boardCount: 1, firstBoardTime: "10:00:00",
  sealFund: 5e7, turnoverRate: 8, amount: 2e8, blastCount: 0, ...over,
});

describe("stockPicker v9.77 仓位聚合截断 + 卡位降级", () => {
  it("同主线多只合计仓位 ≤ 闸门 positionLimit（原五只可累加 150%）", () => {
    const pool: ThemeStock[] = [
      mkStock({ code: "600001", name: "龙头A", boardCount: 4, sealFund: 8e8, amount: 1e9 }),
      mkStock({ code: "600002", name: "龙二B", boardCount: 3, sealFund: 3e8, amount: 5e8 }),
      mkStock({ code: "600003", name: "龙三C", boardCount: 2, sealFund: 1e8, amount: 3e8 }),
      mkStock({ code: "600004", name: "首板D", boardCount: 1, sealFund: 5e7, amount: 2e8 }),
    ];
    const list = pickStocks(mkMainline(), pool, {
      gate: { mode: "full", factor: 1.0, positionLimit: 30, riskLevel: "low", label: "test", reason: [] },
    });
    const total = list.picks.reduce((s, p) => s + p.suggestedPct, 0);
    expect(total).toBeLessThanOrEqual(30);
    // 容量不足的标的被剔除，不存在"接力 0%"占位
    expect(list.picks.every(p => p.suggestedPct >= 5)).toBe(true);
  });

  it("卡位胶着 → 不硬点首选，contendHold=true", () => {
    // 同高度（都是4板）且封单接近（差 <20%）→ detectLeaderContend 判"卡位胶着"
    const mainline = mkMainline({
      leaders: [
        { code: "600001", name: "龙头A", role: "龙一", boardCount: 4, firstBoardTime: "09:30:05", sealFund: 5.5e8, amount: 1e9, pct: 10, reason: "", popularRank: 1 },
        { code: "600002", name: "龙二B", role: "龙二", boardCount: 4, firstBoardTime: "09:31:00", sealFund: 5.0e8, amount: 5e8, pct: 10, reason: "", popularRank: 2 },
        { code: "600003", name: "龙三C", role: "龙三", boardCount: 2, firstBoardTime: "10:00:00", sealFund: 1e8, amount: 3e8, pct: 10, reason: "", popularRank: 3 },
      ],
    });
    const pool: ThemeStock[] = [
      mkStock({ code: "600001", name: "龙头A", boardCount: 4, sealFund: 5.5e8, amount: 1e9 }),
      mkStock({ code: "600002", name: "龙二B", boardCount: 4, sealFund: 5.0e8, amount: 5e8 }),
    ];
    const list = pickStocks(mainline, pool);
    expect(list.contendHold).toBe(true);
    expect(list.picks.some(p => p.role === "首选")).toBe(false); // 不硬点首选
  });
});
