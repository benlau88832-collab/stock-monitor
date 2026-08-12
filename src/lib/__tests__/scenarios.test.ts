// v9.118.0（S4-1）：四场景纯函数单测 —— 情绪周期买卖点/竞价/异动处置/尾盘减仓（③ 验收各 2 例）
import { describe, it, expect } from "vitest";
import { stageToAction, sentimentCycleAdvice } from "../scenarios/sentimentCycle";
import { assessAuctionVolatility } from "../scenarios/auction";
import { composeIntradayAction } from "../scenarios/intradayAction";
import { buildCloseList } from "../scenarios/closeList";

describe("v9.118.0 情绪周期买卖点（S4-1）", () => {
  it("发酵 → 接力核心龙头；高潮 → 只持不开", () => {
    expect(stageToAction("发酵").action).toBe("接力");
    expect(stageToAction("高潮").action).toBe("只持");
  });
  it("冰点 → 低吸；退潮 → 回避；认知层消费", () => {
    expect(stageToAction("冰点").action).toBe("低吸");
    expect(stageToAction("退潮").action).toBe("回避");
    expect(sentimentCycleAdvice({ sentiment: { value: { stage: "分歧" } } }).action).toBe("减仓");
    expect(sentimentCycleAdvice({ sentiment: { value: { stage: "冰点" } } }).positionPct).toBe(15);
  });
});

describe("v9.118.0 竞价决策（S4-1）", () => {
  it("龙头+高开 3.5%+量比 2.4+大单 → 竞价打板", () => {
    const v = assessAuctionVolatility(
      { code: "600001", name: "龙头", auctionPct: 3.5, volumeRatio: 2.4, amount: 6800, isLeader: true },
      { risk: { value: { gateOpen: true } } },
    );
    expect(v.decision).toBe("竞价打板");
    expect(v.matchScore).toBeGreaterThanOrEqual(70);
  });
  it("闸门关闭 → 回避（一票否决）", () => {
    const v = assessAuctionVolatility(
      { code: "600001", name: "龙头", auctionPct: 3.5, volumeRatio: 2.4, amount: 6800, isLeader: true },
      { risk: { value: { gateOpen: false } } },
    );
    expect(v.decision).toBe("回避");
  });
});

describe("v9.118.0 盘中异动处置（S4-1）", () => {
  it("主力净流出+涨幅 6% → 减仓（量价背离）", () => {
    const v = composeIntradayAction({ code: "600001", name: "A", pct: 6.2, mainNet: -5e7 }, {});
    expect(v.action).toBe("减仓");
  });
  it("认知出货 → 回避；主力流入+涨幅确认 → 加仓", () => {
    expect(composeIntradayAction({ code: "600001", name: "A", pct: 5, mainNet: 1e7 }, { capital: { value: { signal: "出货" } } }).action).toBe("回避");
    expect(composeIntradayAction({ code: "600001", name: "A", pct: 5, mainNet: 8e7 }, {}).action).toBe("加仓");
  });
});

describe("v9.118.0 尾盘减仓（S4-1）", () => {
  const holdings = [
    { code: "600001", name: "高位跟风A", profitPct: 12.3, pct: 8.1, isHighFollow: true, reason: "" },
    { code: "600002", name: "核心龙头B", profitPct: 6.5, pct: 3.2, isHighFollow: false, reason: "" },
    { code: "600003", name: "破位股C", profitPct: -6.8, pct: -4.1, isHighFollow: false, reason: "" },
  ];
  it("高潮阶段高位跟风 → 减仓；破 5% 止损 → 减仓", () => {
    const list = buildCloseList(holdings, { sentiment: { value: { stage: "高潮" } } });
    expect(list.find((h) => h.code === "600001")!.action).toBe("减仓");
    expect(list.find((h) => h.code === "600003")!.action).toBe("减仓");
  });
  it("非高风险阶段 + 浮盈 6.5% → 持有；浮盈 ≥10% → 锁定", () => {
    const list = buildCloseList(holdings, { sentiment: { value: { stage: "启动" } } });
    expect(list.find((h) => h.code === "600002")!.action).toBe("持有");
    // 浮盈 12.3% 的高位跟风在启动阶段 → 锁定（≥10% 规则）
    expect(list.find((h) => h.code === "600001")!.action).toBe("锁定");
  });
});
