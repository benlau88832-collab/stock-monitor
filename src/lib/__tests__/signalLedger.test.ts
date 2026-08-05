// v9.44（④）：信号净值曲线纯函数测试
import { describe, it, expect } from "vitest";
import { buildEquitySeries, computeEquityStats, type SignalEntry } from "../signalLedger";

const mk = (over: Partial<SignalEntry>): SignalEntry => ({
  id: "x", date: "2026-08-01", type: "quadrant", typeLabel: "象限信号", code: "600000", name: "测试",
  priceAtSignal: 10, description: "", priceT1: null, priceT5: null, returnT1: null, returnT5: null, backfilled: false,
  ...over,
});

describe("signalLedger 净值曲线", () => {
  it("buildEquitySeries：等权复利净值按日期升序", () => {
    const pts = buildEquitySeries([
      mk({ date: "2026-08-02", returnT1: 10 }),
      mk({ date: "2026-08-01", returnT1: -10 }),
    ], 1);
    expect(pts.length).toBe(2);
    expect(pts[0].date).toBe("2026-08-01");
    expect(pts[0].equity).toBeCloseTo(90, 6);   // 100 * (1-0.10)
    expect(pts[1].equity).toBeCloseTo(99, 6);   // 90 * 1.10
    expect(pts[1].win).toBe(true);
  });

  it("未回填信号不计入（returnT1 为 null 跳过）", () => {
    const pts = buildEquitySeries([mk({ date: "2026-08-01", returnT1: null })], 1);
    expect(pts.length).toBe(0);
  });

  it("T5 视图使用 returnT5", () => {
    const pts = buildEquitySeries([mk({ date: "2026-08-01", returnT5: 5, returnT1: 1 })], 5);
    expect(pts[0].ret).toBe(5);
  });

  it("computeEquityStats：胜率/累计/回撤", () => {
    const pts = buildEquitySeries([
      mk({ date: "2026-08-01", returnT1: 10 }),
      mk({ date: "2026-08-02", returnT1: 10 }),
      mk({ date: "2026-08-03", returnT1: -50 }),
      mk({ date: "2026-08-04", returnT1: 30 }),
    ], 1);
    const st = computeEquityStats(pts);
    expect(st.count).toBe(4);
    expect(st.winRate).toBe(75);                    // 3 胜 1 负
    // 100*1.1=110 → *1.1=121 → *0.5=60.5 → *1.3=78.65 → 累计 -21.35
    expect(st.totalReturn).toBeCloseTo(-21.35, 1);
    expect(st.avgReturn).toBe(0);                   // (10+10-50+30)/4
    // 峰值 121 → 低点 60.5 → 回撤 50%
    expect(st.maxDrawdown).toBeCloseTo(50, 1);
  });
});
