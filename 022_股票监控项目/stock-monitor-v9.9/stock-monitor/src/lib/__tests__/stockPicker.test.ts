// v9.52（V7-1）：标的筛选引擎验收 —— 给定可上车主线+涨停池 → 首选/接力/低吸 + 仓位 + 止损
import { describe, it, expect } from "vitest";
import { pickStocks } from "../stockPicker";
import type { MainlineGroup } from "../stockToMainline";
import type { ThemeStock } from "../themeLadder";

const mkMainline = (over: Partial<MainlineGroup> = {}): MainlineGroup => ({
  mainline: "算力",
  ztCount: 6,
  height: 4,
  mainNet: 1e8,
  mainNet5d: 5e8,
  boardPct: 3.2,
  newsTitles: [],
  isPulse: false,
  logic: "测试",
  caution: "",
  score: 80,
  fromLLM: true,
  strengthScore: 80,
  leaders: [
    { code: "600001", name: "龙头A", role: "龙一", boardCount: 4, firstBoardTime: "09:30:05", sealFund: 8e8, amount: 1e9, pct: 10, reason: "", popularRank: 1 },
    { code: "600002", name: "龙二B", role: "龙二", boardCount: 3, firstBoardTime: "09:45:00", sealFund: 3e8, amount: 5e8, pct: 10, reason: "", popularRank: 2 },
    { code: "600003", name: "龙三C", role: "龙三", boardCount: 2, firstBoardTime: "10:00:00", sealFund: 1e8, amount: 3e8, pct: 10, reason: "", popularRank: 3 },
  ],
  ...over,
});

const mkStock = (over: Partial<ThemeStock>): ThemeStock => ({
  code: "600000", name: "测试", price: 10, pct: 10,
  boardCount: 1, firstBoardTime: "10:00:00",
  sealFund: 5e7, turnoverRate: 8, amount: 2e8, blastCount: 0,
  ...over,
});

describe("stockPicker 标的筛选引擎（V7-1）", () => {
  it("输出首选(龙一打板)+接力+低吸 完整清单（含仓位/止损/买入逻辑）", () => {
    const pool: ThemeStock[] = [
      mkStock({ code: "600001", name: "龙头A", boardCount: 4, sealFund: 8e8, amount: 1e9, firstBoardTime: "09:30:05" }),
      mkStock({ code: "600002", name: "龙二B", boardCount: 3, sealFund: 3e8, amount: 5e8 }),
      mkStock({ code: "600003", name: "龙三C", boardCount: 2, sealFund: 1e8, amount: 3e8 }),
      mkStock({ code: "600004", name: "首板D", boardCount: 1, sealFund: 5e7, amount: 2e8 }),
    ];
    const list = pickStocks(mkMainline(), pool);
    expect(list.picks.length).toBeGreaterThanOrEqual(3);
    const roles = list.picks.map(p => p.role);
    expect(roles).toContain("首选");
    expect(roles).toContain("接力");
    expect(roles).toContain("低吸");
    const first = list.picks[0];
    expect(first.code).toBe("600001"); // 首选=龙一
    expect(first.suggestedPct).toBeGreaterThan(0);
    expect(first.stopLoss).toBeGreaterThan(0);
    expect(first.buyLogic.length).toBeGreaterThan(5);
  });

  it("诱多股被排雷剔除（trapDetector）", () => {
    const pool: ThemeStock[] = [
      mkStock({ code: "600001", name: "龙头A", boardCount: 4, sealFund: 8e8, amount: 1e9 }),
      // 尾盘抢筹出货特征：炸板2次 + 封单/成交极低
      mkStock({ code: "600009", name: "诱多X", boardCount: 3, sealFund: 1e6, amount: 9e8, blastCount: 3 }),
    ];
    const list = pickStocks(mkMainline({ leaders: [
      { code: "600001", name: "龙头A", role: "龙一", boardCount: 4, firstBoardTime: "09:30:05", sealFund: 8e8, amount: 1e9, pct: 10, reason: "", popularRank: 1 },
      { code: "600009", name: "诱多X", role: "龙二", boardCount: 3, firstBoardTime: "09:45:00", sealFund: 1e6, amount: 9e8, pct: 10, reason: "", popularRank: 2 },
    ] }), pool);
    expect(list.picks.some(p => p.code === "600009")).toBe(false);
    expect(list.excluded.some(e => e.code === "600009")).toBe(true);
  });

  it("空涨停池 → 返回空清单（不崩）", () => {
    const list = pickStocks(mkMainline(), []);
    expect(list.picks.length).toBe(0);
  });
});
