// stockExit 个股离场引擎 单测
import { describe, it, expect } from "vitest";
import { checkStockExit } from "../stockExit";

const base = {
  code: "600000", name: "测试股", cost: 10, price: 10,
  pct: 3, mainNetPct: 1, retailNetPct: -1, mainNet: 1e7, mainNet5d: 1e8, mainNet10d: 2e8,
  sealFund: 0, amount: 0, leaderAlive: true, isLeader: false, mainline: "AI",
};

describe("checkStockExit 个股离场", () => {
  it("跌破成本-3% → red 立即离场", () => {
    const r = checkStockExit({ ...base, price: 9.7 });
    expect(r.level).toBe("red");
    expect(r.reasons.join()).toContain("成本");
  });

  it("诱多出货：涨≥7%主力流出散户接盘 → red", () => {
    const r = checkStockExit({ ...base, pct: 8, mainNetPct: -2, retailNetPct: 1.5 });
    expect(r.level).toBe("red");
  });

  it("封单消失：近涨停但封单<2%成交额 → red", () => {
    const r = checkStockExit({ ...base, pct: 9.8, sealFund: 1e6, amount: 1e8 });
    expect(r.level).toBe("red");
  });

  it("逼近止损-1.5% → yellow 减仓观察", () => {
    const r = checkStockExit({ ...base, price: 9.85 });
    expect(r.level).toBe("yellow");
  });

  it("正常持仓无信号 → none（不触发）", () => {
    const r = checkStockExit(base);
    expect(r.level).toBe("none");
  });
});
