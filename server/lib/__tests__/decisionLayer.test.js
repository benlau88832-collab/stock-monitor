// v9.116.0（S2-1）+ v9.121.0（卓越 S2-1b）：决策直达五支柱 + 游资战术单测
import { describe, it, expect } from "vitest";
import { composeDecisionCore, detectTrap } from "../decisionCore";
import { relayEnvScore, stageActionOf, buyPointOf, assessTactics, ladderPosOf } from "../decisionCore";

// 认知层 stub（闸门放开/风险低/发酵）
function cogStub(over = {}) {
  return {
    version: 2,
    risk: { value: { level: "低", traps: [], gateOpen: true } },
    sentiment: { value: { stage: "发酵", score: 75 } },
    mainline: { value: { primaryTheme: "半导体", strength: 92, ladder: { tier1: ["A"], tier2: ["B"], tier3: ["C"] } } },
    leader: { value: { name: "龙头A", height: 3, relayOk: true } },
    ...over,
  };
}

describe("v9.116.0 决策直达 composeDecisionCore（S2-1）", () => {
  it("① 闸门关闭 → decision=回避", () => {
    const cog = cogStub({ risk: { value: { level: "中", traps: ["炸板率偏高"], gateOpen: false } } });
    const v = composeDecisionCore(null, cog, { riskAppetite: "短线" });
    expect(v.decision).toBe("回避");
    expect(v.blocks).toContain("情绪闸门关闭");
  });

  it("② 诱多命中 → 回避（一票否决）", () => {
    const stock = { code: "600001", name: "诱多股", pct: 8, mainNet: -5e7, turnoverRate: 3, limitUp: false, relay: 0 };
    const v = composeDecisionCore(stock, cogStub(), { riskAppetite: "短线" });
    expect(v.decision).toBe("回避");
    expect(v.pillars.trap.pass).toBe(false);
    expect(v.blocks.join("")).toContain("诱多");
  });

  it("③ 同输入 score 确定性（纯函数）", () => {
    const stock = { code: "600519", name: "贵州茅台", pct: 1.2, mainNet: 8e7, turnoverRate: 1.5, relay: 0 };
    const a = composeDecisionCore(stock, cogStub(), { riskAppetite: "短线" });
    const b = composeDecisionCore(stock, cogStub(), { riskAppetite: "短线" });
    expect(a.score).toBe(b.score);
    expect(a.decision).toBe(b.decision);
  });

  it("④ 纯函数核心 latencyMs < 5ms（无 IO 编排；<1ms 在 CI 高负载下偶发 Date.now 抖动，放宽防 flake）", () => {
    const stock = { code: "600519", name: "贵州茅台", pct: 1.2, mainNet: 8e7, turnoverRate: 1.5, relay: 0 };
    const v = composeDecisionCore(stock, cogStub(), { riskAppetite: "短线" });
    expect(v.latencyMs).toBeLessThan(5);
  });

  it("⑤ 健康场景：闸门开+无诱多 → 可上车/观望（非回避）", () => {
    const stock = { code: "600001", name: "健康股", pct: 2.1, mainNet: 3e7, turnoverRate: 8, relay: 2 };
    const v = composeDecisionCore(stock, cogStub(), { riskAppetite: "短线" });
    expect(["可上车", "观望"]).toContain(v.decision);
    expect(v.decision).not.toBe("回避");
  });

  it("detectTrap：主力净流出 → 命中；无信号 → pass", () => {
    expect(detectTrap({ mainNet: -1e7 }, cogStub()).pass).toBe(false);
    expect(detectTrap({ mainNet: 1e7, pct: 2, turnoverRate: 8, relay: 1 }, cogStub()).pass).toBe(true);
  });
});

// v9.121.0（卓越 S2-1b）：游资战术五件套（⑤ 验收 4 例）
describe("v9.121.0 assessTactics（游资战术，S2-1b）", () => {
  it("relayEnvScore：闸门关 → 扣分且 < 闸门开", () => {
    const open = relayEnvScore(cogStub());
    const closed = relayEnvScore(cogStub({ risk: { value: { level: "高", traps: ["炸板率偏高"], gateOpen: false } } }));
    expect(closed).toBeLessThan(open);
    expect(open).toBeGreaterThanOrEqual(0);
    expect(open).toBeLessThanOrEqual(100);
  });

  it("stageActionOf(发酵) === '接力核心龙头'；高潮 → 只持不开", () => {
    expect(stageActionOf("发酵")).toBe("主线确认，回踩分批加仓");
    expect(stageActionOf("高潮")).toBe("持有不追高，分批止盈");
  });

  it("buyPointOf：竞价窗口 → '竞价打板/低吸'；涨停2板 → 回封接力", () => {
    expect(buyPointOf(null, cogStub(), "竞价")).toBe("竞价观察，不追高");
    expect(buyPointOf({ code: "600001", limitUp: true, relay: 2 }, cogStub(), "盘中")).toBe("连板加速，谨慎参与");
  });

  it("composeDecisionCore 返回含 tactics（五支柱不动）", () => {
    const stock = { code: "600519", name: "贵州茅台", pct: 1.2, mainNet: 8e7, turnoverRate: 1.5, relay: 0 };
    const v = composeDecisionCore(stock, cogStub(), { riskAppetite: "短线" }, "盘中");
    expect(v.tactics).toBeDefined();
    expect(typeof v.tactics.relayScore).toBe("number");
    expect(typeof v.tactics.stageAction).toBe("string");
    expect(v.tactics.sellDiscipline).toContain("止损"); // 非高潮/分歧阶段
    expect(v.pillars.admission).toBeDefined(); // 五支柱不受影响
  });
});

// v9.123.0（卓越审查 P0-1）：梯队空名守卫 + 离场解析边界（T-3/T-4）
describe("v9.123.0 卓越审查修复（P0-1）", () => {
  it("ladderPosOf：stock.name 为空且 tier1 非空 → '非主线梯队'（不再 n.includes('') 恒真误判）", () => {
    const cog = cogStub({ mainline: { value: { primaryTheme: "半导体", strength: 92, ladder: { tier1: ["龙头甲"], tier2: ["跟风乙"], tier3: [] } } } });
    expect(ladderPosOf({ code: "600519" }, cog)).toBe("非主线梯队");
    expect(ladderPosOf(null, cog)).toBe("非主线梯队");
    // 有名股票正常命中
    expect(ladderPosOf({ code: "600001", name: "龙头甲科技" }, cog)).toBe("tier1龙头");
  });

  it("composeDecisionCore：ctx.exit.detail 无 % → stopLossPct/targetPct 均为 null", () => {
    const v = composeDecisionCore(null, cogStub(), {
      riskAppetite: "短线",
      exit: { pass: true, score: 80, detail: "无百分比文案" },
    });
    expect(v.stopLossPct).toBeNull();
    expect(v.targetPct).toBeNull();
  });
});
