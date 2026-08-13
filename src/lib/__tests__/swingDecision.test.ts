// v9.138.0（波段重构·阶段一）：swingDecision 波段决策核纯函数测试
import { describe, it, expect } from "vitest";
import { swingDecision, type SwingDecisionInput } from "../swingDecision";
import { analyzeSwing, type KlineBar } from "../swingStage";

function mkKlines(closes: number[], vols?: number[]): KlineBar[] {
  return closes.map((c, i) => {
    const prev = i > 0 ? closes[i - 1] : c;
    return { date: `d${i}`, open: prev, close: c, high: Math.max(prev, c) * 1.01, low: Math.min(prev, c) * 0.99, volume: vols?.[i] ?? 100 };
  });
}

/** 平台放量突破 → 启动 */
function startupStage(): ReturnType<typeof analyzeSwing> {
  const closes = [...Array.from({ length: 38 }, (_, i) => 10 + Math.sin(i / 2) * 0.3), 10.9];
  return analyzeSwing(mkKlines(closes, [...Array(38).fill(100), 260]));
}

describe("swingDecision 波段决策", () => {
  it("启动+平台突破+板块健康 → 波段买入", () => {
    const stage = startupStage();
    const input: SwingDecisionInput = {
      stage,
      board: { code: "BK1", name: "有色", trend: 80, fund: 80, catalyst: 60, total: 75, phase: "主升", ma20Up: true, pct20d: 8, fund10d: 5, fund20d: 8, catalystsTop: [], signals: [] },
    };
    const r = swingDecision(input);
    expect(r.verdict).toBe("波段买入");
    expect(r.buyPoint).toBe("平台突破");
    expect(r.positionRange[1]).toBeGreaterThan(0);
    expect(r.score).toBeGreaterThanOrEqual(60);
  });

  it("逻辑证伪 → 回避（硬否决）", () => {
    const r = swingDecision({ stage: startupStage(), thesisFalsified: true });
    expect(r.verdict).toBe("回避");
    expect(r.blocks.some(b => b.includes("证伪"))).toBe(true);
  });

  it("个股退潮 → 回避", () => {
    const up = Array.from({ length: 35 }, (_, i) => 10 + i * 0.15);
    const down = [14.8, 14.2, 13.5, 12.8, 12.2, 11.8, 11.5];
    const stage = analyzeSwing(mkKlines([...up, ...down]));
    const r = swingDecision({ stage });
    expect(r.verdict).toBe("回避");
  });

  it("主升+持仓 → 持有", () => {
    const closes = Array.from({ length: 45 }, (_, i) => 10 + i * 0.12);
    const stage = analyzeSwing(mkKlines(closes));
    const r = swingDecision({ stage, holding: true, cost: 12 });
    expect(r.verdict).toBe("持有");
  });

  it("加速+持仓 → 减仓（止盈）", () => {
    const closes = [...Array.from({ length: 40 }, (_, i) => 10 + i * 0.05), 13.5, 14.2, 14.8];
    const stage = analyzeSwing(mkKlines(closes));
    const r = swingDecision({ stage, holding: true, cost: 10 });
    expect(r.verdict).toBe("减仓");
    expect(r.reasons.some(x => x.includes("加速"))).toBe(true);
  });

  it("底部整理未持仓 → 观望", () => {
    const closes = Array.from({ length: 40 }, (_, i) => 10 + Math.sin(i / 2) * 0.3);
    const stage = analyzeSwing(mkKlines(closes));
    const r = swingDecision({ stage });
    expect(r.verdict).toBe("观望");
  });

  it("板块退潮 → 回避", () => {
    const r = swingDecision({
      stage: startupStage(),
      board: { code: "BK1", name: "退潮板块", trend: 20, fund: 20, catalyst: 20, total: 20, phase: "退潮", ma20Up: false, pct20d: -8, fund10d: -3, fund20d: -5, catalystsTop: [], signals: [] },
    });
    expect(r.verdict).toBe("回避");
  });
});
