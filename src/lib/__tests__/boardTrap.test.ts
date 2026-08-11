// v9.101.1（T-D4）：盘口三分类纯函数单测（诱多/假摔/强势介入）
import { describe, it, expect } from "vitest";
import { classifyBoardTrap, classifyBoardTrapFromLimit } from "../boardTrap";

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
});

// v9.106.1（验收遗留 #2）：涨停池适配函数接线单测（classifyBoardTrapFromLimit —— 封单变化代理大单方向）
describe("v9.106.1 classifyBoardTrapFromLimit（涨停池适配接线）", () => {
  it("封单撤单 ≥30%（prevSealFund 有效）→ 诱多", () => {
    const r = classifyBoardTrapFromLimit({ sealFund: 5e7, amount: 1e9, blastCount: 0 }, 1e8);
    expect(r.type).toBe("诱多");
    expect(r.reasons.join()).toContain("快速撤单");
  });

  it("炸板（zbc>0）但封单变化温和 → 假摔", () => {
    const r = classifyBoardTrapFromLimit({ sealFund: 9.5e7, amount: 1e9, blastCount: 2 }, 1e8);
    expect(r.type).toBe("假摔");
    expect(r.reasons.join()).toContain("筹码未走");
  });

  it("封成比高 + 封单稳定/增封 → 强势介入", () => {
    const r = classifyBoardTrapFromLimit({ sealFund: 1.05e8, amount: 3e7, blastCount: 0 }, 1e8);
    expect(r.type).toBe("强势介入");
  });

  it("首轮无快照（prevSealFund<=0）→ 不误判（变化率 0）", () => {
    const r = classifyBoardTrapFromLimit({ sealFund: 3e8, amount: 1e9, blastCount: 0 }, 0);
    expect(r.type).toBeNull();
  });

  it("非涨停股封单为 0 → 不误判", () => {
    const r = classifyBoardTrapFromLimit({ sealFund: 0, amount: 1e8, blastCount: 0 }, 0);
    expect(r.type).toBeNull();
  });
});
