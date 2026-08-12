// ============================================================
// v9.125.0（蓝图 L6 纪律层前置）：behaviorCoach 行为偏差检测纯函数单测 ——
//   频繁交易/不止损/追高/处置效应 四类信号 + 样本不足不判定。
// 数据构造：trade_ledger 行形状（action buy/sell/stop + pnl_pct + cost）。
// ============================================================
import { describe, it, expect } from "vitest";
import { detectBehaviorBias } from "../behaviorCoach";

const NOW = Date.now();
const dayAgo = (n) => new Date(NOW - n * 86400000).toISOString();

describe("v9.125.0 detectBehaviorBias（蓝图 L6 纪律层）", () => {
  it("样本不足（<3 笔）→ 不判定（防误报）", () => {
    expect(detectBehaviorBias([], {})).toEqual([]);
    expect(detectBehaviorBias([{ action: "buy", ts: dayAgo(1) }, { action: "sell", ts: dayAgo(0), pnl_pct: -8 }], {})).toEqual([]);
  });

  it("频繁交易：近 7 日 30 笔（日均 4.3 > 3）→ warn", () => {
    const trades = Array.from({ length: 30 }, (_, i) => ({ action: i % 2 ? "buy" : "sell", ts: dayAgo(i % 7), pnl_pct: 1 }));
    const out = detectBehaviorBias(trades, { days: 7, maxTradesPerDay: 3 });
    const hit = out.find((b) => b.type === "频繁交易");
    expect(hit).toBeDefined();
    expect(hit.severity).toBe("warn");
    expect(hit.principle).toContain("刘玉珍");
    expect(hit.advice).toContain("税费");
  });

  it("不止损：3 平仓 2 笔亏损超 5%（67%>40%）→ alert", () => {
    const trades = [
      { action: "sell", ts: dayAgo(3), pnl_pct: -8 },
      { action: "sell", ts: dayAgo(2), pnl_pct: -12 },
      { action: "sell", ts: dayAgo(1), pnl_pct: 3 },
    ];
    const out = detectBehaviorBias(trades, { stopLossPct: 5 });
    const hit = out.find((b) => b.type === "不止损");
    expect(hit).toBeDefined();
    expect(hit.severity).toBe("alert");
    expect(hit.evidence).toContain("67%");
  });

  it("追高：2 笔买入价高于持仓成本 → warn", () => {
    const trades = [
      { action: "buy", ts: dayAgo(2), price: 15, cost: 10, pnl_pct: null },
      { action: "buy", ts: dayAgo(1), price: 18, cost: 14, pnl_pct: null },
      { action: "buy", ts: dayAgo(0), price: 12, cost: 14, pnl_pct: null },
    ];
    const out = detectBehaviorBias(trades, {});
    const hit = out.find((b) => b.type === "追高");
    expect(hit).toBeDefined();
    expect(hit.evidence).toContain("2 笔");
  });

  it("处置效应：盈利单持有 1 天 vs 亏损单 5 天（>2 倍）→ warn", () => {
    const trades = [
      { action: "sell", ts: dayAgo(1), pnl_pct: 4 },
      { action: "sell", ts: dayAgo(1), pnl_pct: 6 },
      { action: "sell", ts: dayAgo(5), pnl_pct: -6 },
      { action: "sell", ts: dayAgo(5), pnl_pct: -9 },
    ];
    const out = detectBehaviorBias(trades, {});
    const hit = out.find((b) => b.type === "处置效应");
    expect(hit).toBeDefined();
    expect(hit.evidence).toContain("拿不住利润");
  });

  it("健康样本：亏损占比低、无追高 → 无 不止损/追高 信号", () => {
    const trades = [
      { action: "buy", ts: dayAgo(10), price: 10, cost: 10 },
      { action: "sell", ts: dayAgo(5), pnl_pct: 8 },
      { action: "buy", ts: dayAgo(4), price: 11, cost: 11 },
      { action: "sell", ts: dayAgo(1), pnl_pct: -2 },
    ];
    const out = detectBehaviorBias(trades, { days: 30, maxTradesPerDay: 3 });
    expect(out.find((b) => b.type === "不止损")).toBeUndefined();
    expect(out.find((b) => b.type === "追高")).toBeUndefined();
  });
});
