// P0-2：拍板自动入纪律纯函数测试
import { describe, it, expect, beforeEach } from "vitest";
import { loadDisciplineState, saveDisciplineState, addDecisionToPosition, type DisciplineState } from "../discipline";

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

describe("P0-2 discipline.addDecisionToPosition", () => {
  it("拍板有 code+price → 自动加入持仓", () => {
    addDecisionToPosition({ code: "600001", priceAtPost: 12.5, mainline: "AI" });
    const s = loadDisciplineState();
    expect(s.positions.length).toBe(1);
    expect(s.positions[0].code).toBe("600001");
    expect(s.positions[0].cost).toBe(12.5);
    expect(s.positions[0].price).toBe(12.5);
    expect(s.positions[0].value).toBeGreaterThan(0);
    expect(s.positions[0].pnlPct).toBe(0);
    expect(s.todayNewPositions).toBe(1);
  });

  it("同 code 不重复加（防连续拍板刷出多份）", () => {
    addDecisionToPosition({ code: "600001", priceAtPost: 12.5, mainline: "AI" });
    addDecisionToPosition({ code: "600001", priceAtPost: 13, mainline: "AI" });
    const s = loadDisciplineState();
    expect(s.positions.length).toBe(1);
  });

  it("无 code 时跳过（主线决策不入持仓）", () => {
    addDecisionToPosition({ code: null, priceAtPost: null, mainline: "AI" });
    const s = loadDisciplineState();
    expect(s.positions.length).toBe(0);
    expect(s.todayNewPositions).toBe(0);
  });

  it("priceAtPost ≤ 0 跳过（异常数据防护）", () => {
    addDecisionToPosition({ code: "600001", priceAtPost: 0, mainline: "AI" });
    addDecisionToPosition({ code: "600002", priceAtPost: -5, mainline: "AI" });
    const s = loadDisciplineState();
    expect(s.positions.length).toBe(0);
  });

  it("默认仓位 = 20% × totalCapital", () => {
    // 测前先 save 一个带 50万 总资金的 state
    const init: DisciplineState = {
      positions: [],
      settings: { totalCapital: 500000, maxSinglePct: 30, maxTotalPct: 80, maxNewPositionsPerDay: 3, cooldownLossStreak: 3 },
      todayNewPositions: 0, lossStreak: 0, recentPnl: [],
    };
    saveDisciplineState(init);
    addDecisionToPosition({ code: "600001", priceAtPost: 12.5, mainline: "AI" });
    const s = loadDisciplineState();
    expect(s.positions[0].value).toBe(500000 * 0.2);
  });
});