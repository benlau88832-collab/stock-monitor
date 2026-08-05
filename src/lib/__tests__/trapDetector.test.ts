// trapDetector 诱多探测引擎 单测
import { describe, it, expect } from "vitest";
import { detectTrap, detectMainlineTrap } from "../trapDetector";

describe("detectTrap 个股诱多信号", () => {
  it("假封板：近涨停+封单<5%成交额+炸板≥2 → 诱多", () => {
    const r = detectTrap({ code: "600000", name: "A", pct: 9.8, sealFund: 3e6, amount: 1e8, blastCount: 3 });
    expect(r.isTrap).toBe(true);
    expect(r.type).toBe("假封板");
  });

  it("诱多拉升：涨幅≥7% 且主力流出 且散户接盘 → 诱多", () => {
    const r = detectTrap({ code: "600000", name: "A", pct: 8, mainNetPct: -2, retailNetPct: 1.5 });
    expect(r.isTrap).toBe(true);
    expect(r.type).toBe("诱多拉升");
  });

  it("涨幅高但主力同步流入 → 非诱多", () => {
    const r = detectTrap({ code: "600000", name: "A", pct: 8, mainNetPct: 2, retailNetPct: 0.5 });
    expect(r.isTrap).toBe(false);
  });

  it("涨幅低 → 非诱多（无拉升无从诱）", () => {
    const r = detectTrap({ code: "600000", name: "A", pct: 2, mainNetPct: -1, retailNetPct: 1 });
    expect(r.isTrap).toBe(false);
  });

  it("近涨停+炸板但封单充足 → 正常分歧非诱多", () => {
    const r = detectTrap({ code: "600000", name: "A", pct: 9.6, sealFund: 8e7, amount: 1e8, blastCount: 2 });
    expect(r.isTrap).toBe(false);
  });
});

describe("detectMainlineTrap 主线诱多占比", () => {
  const mk = (trap: boolean) => ({ isTrap: trap, type: "诱多拉升" as const, confidence: 80, reason: "" });

  it("主线内诱多个股占比≥40% → 出货预警", () => {
    const r = detectMainlineTrap({ mainline: "AI", verdicts: [mk(true), mk(true), mk(false), mk(false), mk(false)] });
    expect(r.flagged).toBe(true);
    expect(r.rate).toBeGreaterThanOrEqual(0.4);
  });

  it("诱多占比低 → 不预警", () => {
    const r = detectMainlineTrap({ mainline: "AI", verdicts: [mk(true), mk(false), mk(false)] });
    expect(r.flagged).toBe(false);
  });

  it("空输入 → 不预警", () => {
    const r = detectMainlineTrap({ mainline: "AI", verdicts: [] });
    expect(r.flagged).toBe(false);
  });
});
