// v9.101.1（T-D4）：盘口三分类纯函数单测（诱多/假摔/强势介入）
import { describe, it, expect } from "vitest";
import { classifyBoardTrap, classifyBoardTrapForBoard } from "../boardTrap";

describe("v9.101.1 classifyBoardTrap（盘口三分类）", () => {
  it("诱多：封单快速撤单 + 大单流出", () => {
    const r = classifyBoardTrap({ sealRatio: 3, sealChangeRate: -45, bigNetFlow: -2e7, turnoverRate: 15, blasted: false });
    expect(r.type).toBe("诱多");
    expect(r.reasons.join()).toContain("快速撤单");
  });

  it("假摔：炸板但大单未出", () => {
    const r = classifyBoardTrap({ sealRatio: 0, sealChangeRate: -60, bigNetFlow: 5e6, turnoverRate: 25, blasted: true });
    expect(r.type).toBe("假摔");
    expect(r.reasons.join()).toContain("筹码未走");
  });

  it("假摔：炸板但大单无大幅流出（小波动也算筹码未走）", () => {
    const r = classifyBoardTrap({ sealRatio: 0, sealChangeRate: -50, bigNetFlow: 5e5, turnoverRate: 22, blasted: true });
    // 5e5 为正流入（bigIn=true）→ 大单未出，假摔成立（T-6a 收紧不影响正流入场景）
    expect(r.type).toBe("假摔");
  });

  it("强势介入：封成比高 + 封单稳定 + 大单流入 + 换手温和", () => {
    const r = classifyBoardTrap({ sealRatio: 3.5, sealChangeRate: 5, bigNetFlow: 3e7, turnoverRate: 12, blasted: false });
    expect(r.type).toBe("强势介入");
    expect(r.reasons.join()).toContain("封成比 3.5");
  });

  it("封单不稳定（变化率过大）→ 非强势介入", () => {
    const r = classifyBoardTrap({ sealRatio: 3, sealChangeRate: 25, bigNetFlow: 3e7, turnoverRate: 12, blasted: false });
    expect(r.type).toBeNull();
  });

  it("诱多优先级高于假摔（撤单+流出，即使炸板）", () => {
    const r = classifyBoardTrap({ sealRatio: 1, sealChangeRate: -50, bigNetFlow: -1e7, turnoverRate: 20, blasted: true });
    expect(r.type).toBe("诱多");
  });

  it("阈值可覆盖（收紧介入封成比）", () => {
    const r = classifyBoardTrap({ sealRatio: 2.5, sealChangeRate: 5, bigNetFlow: 1e7, turnoverRate: 10, blasted: false }, { sealRatioMin: 3 });
    expect(r.type).toBeNull();
  });

  // v9.108.0（T-6a P2-1）：假摔收紧 —— 单一温和条件不再判假摔（需小flow 与 小sealchange 同时成立或有正向大单）
  it("假摔收紧：炸板 + 大单流出 + 小flow + sealchange=25 → 非假摔（旧逻辑误判）", () => {
    const r = classifyBoardTrap({ sealRatio: 0, sealChangeRate: 25, bigNetFlow: -5e5, turnoverRate: 20, blasted: true });
    expect(r.type).not.toBe("假摔");
  });

  it("假摔收紧：炸板 + 小flow 且 小sealchange 同时成立 → 仍判假摔", () => {
    const r = classifyBoardTrap({ sealRatio: 0, sealChangeRate: 10, bigNetFlow: 5e5, turnoverRate: 22, blasted: true });
    expect(r.type).toBe("假摔");
  });
});

// v9.106.2（用户定调：同概念批量涨停视为板块异动）：板块级聚合三分类单测（classifyBoardTrapForBoard）
describe("v9.106.2 classifyBoardTrapForBoard（板块级聚合接线）", () => {
  it("板块批量涨停封单整体撤 ≥30% → 板块诱多", () => {
    const r = classifyBoardTrapForBoard({
      stocks: [
        { sealFund: 6e7, amount: 2e8, blastCount: 0 },
        { sealFund: 4e7, amount: 1e8, blastCount: 0 },
      ],
      prevTotalSealFund: 2e8, // 上轮 2 亿 → 本轮 1 亿（-50%）
    });
    expect(r.type).toBe("诱多");
    expect(r.reasons.join()).toContain("快速撤单");
  });

  it("板块炸板占比 ≥30% 且封单变化温和 → 板块假摔", () => {
    const r = classifyBoardTrapForBoard({
      stocks: [
        { sealFund: 5e7, amount: 2e8, blastCount: 1 },
        { sealFund: 6e7, amount: 1e8, blastCount: 0 },
        { sealFund: 4e7, amount: 1e8, blastCount: 1 },
      ],
      prevTotalSealFund: 1.505e8, // v9.108.0（T-6a 收紧后）：变化 <1e6（小flow）且 |Δ|<20%（温和）才判假摔
    });
    expect(r.type).toBe("假摔");
    expect(r.reasons.join()).toContain("筹码未走");
  });

  it("板块封成比高 + 封单稳定/增 → 板块强势介入", () => {
    const r = classifyBoardTrapForBoard({
      stocks: [
        { sealFund: 6e7, amount: 2e7, blastCount: 0 },
        { sealFund: 5e7, amount: 2e7, blastCount: 0 },
      ],
      prevTotalSealFund: 1e8,
    });
    expect(r.type).toBe("强势介入");
  });

  it("首轮无快照（prevTotalSealFund<=0）→ 不误判", () => {
    const r = classifyBoardTrapForBoard({
      stocks: [
        { sealFund: 6e7, amount: 2e8, blastCount: 0 },
        { sealFund: 4e7, amount: 1e8, blastCount: 0 },
      ],
      prevTotalSealFund: 0,
    });
    expect(r.type).toBeNull();
  });

  it("板块涨停家数不足 2 只 → 不判（个股异动不归板块）", () => {
    const r = classifyBoardTrapForBoard({ stocks: [{ sealFund: 6e7, amount: 2e8, blastCount: 0 }], prevTotalSealFund: 1e8 });
    expect(r.type).toBeNull();
  });
});
