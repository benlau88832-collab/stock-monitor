// ============================================================
// v9.127.0（蓝图 L7/L6 批次 D 前置）：strategyStats 战法命中率 + positions 持仓净额汇总 单测
// ============================================================
import { describe, it, expect } from "vitest";
import { strategyStats } from "../strategyStats";
import { netPositions, concentration } from "../positions";

describe("v9.127.0 strategyStats（蓝图 L7 战法命中率）", () => {
  it("按 拍板动作×置信度桶 分组：n/winRate/avgPnl 正确", () => {
    const rows = [
      { human_action: "confirm", confidence_at_post: 85, pnl: 5 },
      { human_action: "confirm", confidence_at_post: 90, pnl: -3 },
      { human_action: "confirm", confidence_at_post: 88, pnl: 7 },
      { human_action: "watch", confidence_at_post: 55, pnl: 1 },
      { human_action: "confirm", confidence_at_post: 85, pnl: null }, // 未回填 → 不入样本
      { human_action: "reject", confidence_at_post: 70, pnl: -2 },
    ];
    const out = strategyStats(rows, 20);
    const c = out.find((b) => b.action === "confirm" && b.confidenceBucket === "80-100");
    expect(c.n).toBe(3);
    expect(c.winRate).toBe(67); // 2/3
    expect(c.avgPnl).toBe(3);   // (5-3+7)/3
    expect(c.sampleEnough).toBe(false); // n=3 < 20
    const w = out.find((b) => b.action === "watch");
    expect(w.confidenceBucket).toBe("0-59");
  });

  it("空输入 → 空数组", () => {
    expect(strategyStats([], 20)).toEqual([]);
    expect(strategyStats(null, 20)).toEqual([]);
  });

  it("n 降序排序", () => {
    const rows = [
      { human_action: "confirm", confidence_at_post: 50, pnl: 1 },
      { human_action: "confirm", confidence_at_post: 60, pnl: 1 },
      { human_action: "confirm", confidence_at_post: 90, pnl: 1 },
      { human_action: "confirm", confidence_at_post: 40, pnl: 1 },
    ];
    const out = strategyStats(rows, 20);
    expect(out[0].confidenceBucket).toBe("0-59"); // n=2 最大
  });
});

describe("v9.127.0 netPositions/concentration（蓝图 L6 持仓体检）", () => {
  it("净额汇总：buy+/sell-，均价=买入加权，closedPnl 累计", () => {
    const trades = [
      { code: "600519", name: "贵州茅台", action: "buy", price: 1500, quantity: 100, ts: "2026-08-01T09:30:00Z" },
      { code: "600519", name: "贵州茅台", action: "buy", price: 1400, quantity: 100, ts: "2026-08-02T09:30:00Z" },
      { code: "600519", name: "贵州茅台", action: "sell", price: 1450, quantity: 50, pnl_pct: 0.5, ts: "2026-08-03T09:30:00Z" },
      { code: "300750", name: "宁德时代", action: "buy", price: 200, quantity: 1000, ts: "2026-08-01T09:30:00Z" },
      { code: "300750", name: "宁德时代", action: "sell", price: 190, quantity: 1000, pnl_pct: -5, ts: "2026-08-02T09:30:00Z" },
    ];
    const pos = netPositions(trades);
    const m = pos.find((p) => p.code === "600519");
    expect(m.netQty).toBe(150);
    expect(m.avgCost).toBe(1450); // (1500*100+1400*100)/200
    expect(m.open).toBe(true);
    expect(m.closedPnlPct).toBe(0.5);
    const n = pos.find((p) => p.code === "300750");
    expect(n.netQty).toBe(0);
    expect(n.open).toBe(false);
    expect(n.closedPnlPct).toBe(-5);
  });

  it("concentration：单票占比 + 无持仓兜底", () => {
    const pos = [
      { code: "A", netQty: 100, avgCost: 10, open: true },
      { code: "B", netQty: 100, avgCost: 10, open: true },
      { code: "C", netQty: 200, avgCost: 10, open: true },
      { code: "D", netQty: 0, open: false },
    ];
    const c = concentration(pos);
    expect(c.openCount).toBe(3);
    expect(c.topShare).toBe(50); // C 2000/4000
    expect(c.top[0].code).toBe("C");
    expect(concentration([]).note).toContain("无持仓");
  });

  it("空/垃圾输入不崩", () => {
    expect(netPositions([])).toEqual([]);
    expect(netPositions([{ action: "buy" }])).toEqual([]); // 无 code 跳过
    expect(netPositions(null)).toEqual([]);
  });
});
