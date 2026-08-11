// v9.101.1（T-B3）：低吸信号引擎纯函数单测
import { describe, it, expect } from "vitest";
import { judgeLowAbsorb } from "../lowAbsorb";

describe("v9.101.1 judgeLowAbsorb（回踩+缩量+资金+环境）", () => {
  const base = { price: 10.2, ma5: 10.0, volumeRatio: 0.6, mainNet5d: 5e7, blastedRate: 20 };

  it("四信号全满足 → ok + 三线", () => {
    const r = judgeLowAbsorb(base);
    expect(r.ok).toBe(true);
    expect(r.signals.every(s => s.pass)).toBe(true);
    expect(r.lowAbsorbZone).toEqual([9.8, 10.2]);
    expect(r.stopLoss).toBe(9.7);
    expect(r.target).toBe(10.71);
    expect(r.text).toContain("低吸区");
  });

  it("回踩破位（现价 < MA5×0.98）→ 不满足", () => {
    const r = judgeLowAbsorb({ ...base, price: 9.7 });
    expect(r.ok).toBe(false);
    expect(r.signals[0].pass).toBe(false);
    expect(r.lowAbsorbZone).toBeNull();
    expect(r.text).toContain("回踩5日线不破");
  });

  it("放量（量比≥0.8）→ 不满足", () => {
    const r = judgeLowAbsorb({ ...base, volumeRatio: 1.2 });
    expect(r.ok).toBe(false);
    expect(r.signals[1].pass).toBe(false);
  });

  it("主力 5 日净流出 → 不满足", () => {
    const r = judgeLowAbsorb({ ...base, mainNet5d: -1e7 });
    expect(r.ok).toBe(false);
    expect(r.signals[2].pass).toBe(false);
  });

  it("炸板率环境不允许（≥30%）→ 不满足", () => {
    const r = judgeLowAbsorb({ ...base, blastedRate: 35 });
    expect(r.ok).toBe(false);
    expect(r.signals[3].pass).toBe(false);
  });

  it("阈值可覆盖（炸板率门槛放宽）", () => {
    const r = judgeLowAbsorb({ ...base, blastedRate: 40 }, { blastedRateMax: 45 });
    expect(r.ok).toBe(true);
  });
});
