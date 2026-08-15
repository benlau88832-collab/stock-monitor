// v9.138.0（波段重构·阶段一）：swingStage 波段位置模型纯函数测试
import { describe, it, expect } from "vitest";
import {
  analyzeSwing, analyzeWeeklySwing, analyzeMonthlySwing, aggregateWeeklyBars, aggregateMonthlyBars, detectPlatform, detectBreakout, detectFirstLimitUp, detectFirstBoardDipBuy,
  type KlineBar,
} from "../swingStage";

/** 构造日K：给定收盘序列，open=prev close、high/low 在 close±1% 内、volume 可配 */
function mkBars(closes: number[], opts?: { vols?: number[]; lastHighBoost?: number; lastLowDip?: number }): KlineBar[] {
  const vols = opts?.vols ?? closes.map(() => 100);
  return closes.map((c, i) => {
    const prev = i > 0 ? closes[i - 1] : c;
    const high = i === closes.length - 1 && opts?.lastHighBoost ? c * (1 + opts.lastHighBoost / 100) : Math.max(prev, c) * 1.01;
    const low = i === closes.length - 1 && opts?.lastLowDip ? c * (1 - opts.lastLowDip / 100) : Math.min(prev, c) * 0.99;
    return { date: `d${i}`, open: prev, close: c, high, low, volume: vols[i] ?? 100 };
  });
}

describe("周线级中长波段模型", () => {
  it("aggregateWeeklyBars 按周聚合且 analyzeWeeklySwing 不抛错", () => {
    const bars = Array.from({ length: 80 }, (_, i) => ({
      date: `2026-${String(Math.floor(i / 5) + 1).padStart(2, "0")}-${String((i % 5) + 1).padStart(2, "0")}`, open: 10 + i * 0.1, close: 10.1 + i * 0.1, high: 10.2 + i * 0.1, low: 10 + i * 0.1, volume: 100,
    }));
    const weekly = aggregateWeeklyBars(bars);
    expect(weekly.length).toBeLessThan(bars.length);
    const r = analyzeWeeklySwing(bars);
    expect(["底部整理","启动","主升","加速","退潮","数据不足"]).toContain(r.phase);
  });
});

// v9.147.0（阶段二A·多周期共振）：月线第三级 —— 按 YYYY-MM 聚合，minBars=12
describe("月线级长波段模型", () => {
  it("aggregateMonthlyBars 按月聚合（同月多根 → 1 根）", () => {
    const bars = Array.from({ length: 60 }, (_, i) => ({
      date: `2026-${String(Math.floor(i / 20) + 1).padStart(2, "0")}-${String((i % 20) + 1).padStart(2, "0")}`,
      open: 10 + i * 0.1, close: 10.1 + i * 0.1, high: 10.2 + i * 0.1, low: 10 + i * 0.1, volume: 100,
    }));
    const monthly = aggregateMonthlyBars(bars);
    expect(monthly.length).toBeLessThan(bars.length);
    expect(monthly.length).toBe(3); // 3 个月
    const r = analyzeMonthlySwing(bars);
    expect(["底部整理","启动","主升","加速","退潮","数据不足"]).toContain(r.phase);
  });

  it("月线持续上行（>=20 根，MA20 可算）→ 主升", () => {
    const closes = Array.from({ length: 24 }, (_, i) => 10 + i * 0.5); // 每月一根，持续上行
    const bars: KlineBar[] = closes.map((c, i) => ({
      date: `2025-${String(i + 1).padStart(2, "0")}-15`,
      open: c - 0.2, close: c, high: c + 0.3, low: c - 0.4, volume: 100,
    }));
    const r = analyzeMonthlySwing(bars);
    expect(r.phase).not.toBe("数据不足");
    expect(["主升", "加速"]).toContain(r.phase);
  });

  it("月线不足 12 根 → 数据不足（防短样本误判）", () => {
    const bars: KlineBar[] = Array.from({ length: 6 }, (_, i) => ({
      date: `2026-${String(i + 1).padStart(2, "0")}-15`,
      open: 10, close: 11, high: 11.2, low: 9.8, volume: 100,
    }));
    expect(analyzeMonthlySwing(bars).phase).toBe("数据不足");
  });
});

describe("detectPlatform 平台识别", () => {
  it("横盘 20 日振幅<12% → 识别平台", () => {
    const closes = [...Array(25).fill(10).map((_, i) => 10 + Math.sin(i) * 0.3)]; // 9.7-10.3 区间（需 ≥21 根）
    const bars = mkBars(closes);
    const p = detectPlatform(bars, 20, 0.12);
    expect(p).not.toBeNull();
    expect(p!.days).toBe(20);
  });

  it("单边大涨 → 不识别为平台", () => {
    const closes = Array.from({ length: 20 }, (_, i) => 10 + i * 0.5); // 10→19.5 单边
    const bars = mkBars(closes);
    expect(detectPlatform(bars, 20, 0.12)).toBeNull();
  });
});

describe("detectBreakout 突破检测", () => {
  it("放量突破平台高点 → broken", () => {
    const closes = [...Array(20).fill(10).map((_, i) => 10 + Math.sin(i) * 0.3), 10.8]; // 平台后放量突破
    const bars = mkBars(closes, { vols: [...Array(20).fill(100), 250] });
    const r = detectBreakout(bars, [9.6, 10.4], 1.8);
    expect(r.broken).toBe(true);
    expect(r.volRatio).toBeGreaterThanOrEqual(2);
  });

  it("缩量突破 → 不认定（量能不足）", () => {
    const closes = [...Array(20).fill(10).map((_, i) => 10 + Math.sin(i) * 0.3), 10.8];
    const bars = mkBars(closes, { vols: [...Array(20).fill(100), 120] });
    const r = detectBreakout(bars, [9.6, 10.4], 1.8);
    expect(r.broken).toBe(false);
  });
});

describe("detectFirstLimitUp 放量首板", () => {
  it("今日+10% 昨日+2% → 首板", () => {
    const closes = [10, 10.2, 11.22];
    const bars = mkBars(closes);
    const r = detectFirstLimitUp(bars, 9.5);
    expect(r.isFirst).toBe(true);
    expect(r.pct).toBeCloseTo(10, 1);
  });

  it("连续两日涨停 → 非首板（二板）", () => {
    const closes = [10, 11, 12.1];
    const bars = mkBars(closes);
    const r = detectFirstLimitUp(bars, 9.5);
    expect(r.isFirst).toBe(false);
  });
});

describe("detectFirstBoardDipBuy 首板次日低吸", () => {
  it("昨日首板，今日回踩 MA5/10 企稳且未再封板 → 低吸买点", () => {
    // 30 根横盘后首板（10→11），今日回踩到 10.6（在 MA5/10 附近）收回
    const base = Array.from({ length: 28 }, (_, i) => 10 + Math.sin(i) * 0.2);
    const closes = [...base, 11.0, 10.6];
    const bars = mkBars(closes, { lastLowDip: 3.5 }); // 今日最低 10.6*0.965≈10.23 触及均线区
    const r = detectFirstBoardDipBuy(bars, 9.5);
    expect(r.hit).toBe(true);
  });

  it("首板次日继续大涨追板 → 不认定低吸（防追高）", () => {
    const base = Array.from({ length: 28 }, (_, i) => 10 + Math.sin(i) * 0.2);
    const closes = [...base, 11.0, 12.1];
    const bars = mkBars(closes);
    const r = detectFirstBoardDipBuy(bars, 9.5);
    expect(r.hit).toBe(false);
  });
});

describe("classifySwingPhase 阶段判定", () => {
  it("数据不足（<30 根）→ 数据不足", () => {
    const r = analyzeSwing(mkBars([...Array(20).fill(10)]));
    expect(r.phase).toBe("数据不足");
  });

  it("底部横盘 → 底部整理", () => {
    const closes = Array.from({ length: 40 }, (_, i) => 10 + Math.sin(i / 2) * 0.3);
    const r = analyzeSwing(mkBars(closes));
    expect(r.phase).toBe("底部整理");
    expect(r.buyPoint).toBeNull();
  });

  it("平台放量突破 → 启动（平台突破买点）", () => {
    const closes = [...Array.from({ length: 38 }, (_, i) => 10 + Math.sin(i / 2) * 0.3), 10.9];
    const bars = mkBars(closes, { vols: [...Array(38).fill(100), 260] });
    const r = analyzeSwing(bars);
    expect(r.phase).toBe("启动");
    expect(r.buyPoint).toBe("平台突破");
  });

  it("多头排列且价格在 MA20 上方 → 主升", () => {
    // 持续上行：10 → 15，MA5>MA10>MA20
    const closes = Array.from({ length: 45 }, (_, i) => 10 + i * 0.12);
    const r = analyzeSwing(mkBars(closes));
    expect(r.phase).toBe("主升");
  });

  it("加速：偏离 MA20>18% → 加速（赶顶风险）", () => {
    // 近期陡涨：从 10 拉到 14+（偏离 MA20 超 18%）
    const closes = [...Array.from({ length: 40 }, (_, i) => 10 + i * 0.05), 13.5, 14.2, 14.8];
    const r = analyzeSwing(mkBars(closes));
    expect(r.phase).toBe("加速");
  });

  it("跌破 MA20 且 MA5<MA20 → 退潮", () => {
    // 上涨后连续下跌击穿 MA20
    const up = Array.from({ length: 35 }, (_, i) => 10 + i * 0.15); // 10→15.1
    const down = [14.8, 14.2, 13.5, 12.8, 12.2, 11.8, 11.5]; // 快速回落
    const r = analyzeSwing(mkBars([...up, ...down]));
    expect(r.phase).toBe("退潮");
  });
});
