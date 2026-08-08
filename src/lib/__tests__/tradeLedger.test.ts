// P0-3：成交台账纯函数测试
import { describe, it, expect, beforeEach } from "vitest";
import { computePnl, loadTrades, type TradeEntry } from "../tradeLedger";

// 最小 localStorage stub（vitest node env 默认无 localStorage）
function stubLocalStorage() {
  const store = new Map<string, string>();
  const ls = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
  };
  Object.defineProperty(globalThis, "localStorage", { value: ls, writable: true, configurable: true });
}

beforeEach(() => {
  stubLocalStorage();
  try { localStorage.clear(); } catch { /* skip */ }
});

const mk = (over: Partial<TradeEntry>): TradeEntry => ({
  date: "2026-08-08",
  ts: Date.now(),
  decisionPostRef: "ref1",
  code: "600001",
  name: "测试",
  action: "buy",
  price: 10,
  quantity: 1000,
  ...over,
});

describe("P0-3 tradeLedger 成交台账", () => {
  it("computePnl：盈利计算 (12-10)/10 = +20%", () => {
    expect(computePnl(12, 10)).toBe(20);
  });

  it("computePnl：亏损计算 (8-10)/10 = -20%", () => {
    expect(computePnl(8, 10)).toBe(-20);
  });

  it("computePnl：cost=0 返回 0（防除零）", () => {
    expect(computePnl(12, 0)).toBe(0);
  });

  it("loadTrades：空 localStorage 返回空数组", () => {
    expect(loadTrades()).toEqual([]);
  });

  it("loadTrades：损坏数据返回空数组（不抛错）", () => {
    localStorage.setItem("trade_ledger_v1", "{bad");
    expect(loadTrades()).toEqual([]);
  });

  it("loadTrades：正常数组可读回", () => {
    localStorage.setItem("trade_ledger_v1", JSON.stringify([mk({ code: "600001" })]));
    const arr = loadTrades();
    expect(arr.length).toBe(1);
    expect(arr[0].code).toBe("600001");
  });
});