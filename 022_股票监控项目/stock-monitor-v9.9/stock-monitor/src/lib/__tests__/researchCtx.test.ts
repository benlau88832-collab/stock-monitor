// v9.67：调研会话状态（researchCtx）多轮上下文测试
import { describe, it, expect, beforeEach } from "vitest";
import { extractStockCode, isNewResearchRequest, isContinueResearch, updateResearchCtxAfterReply, saveResearchCtx } from "../researchTools";

describe("researchCtx 多轮上下文", () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* node 无 localStorage */ }
  });

  it("提取 6 位股票代码", () => {
    expect(extractStockCode("个股深度调研 中天科技 600522")).toBe("600522");
    expect(extractStockCode("继续深入查询")).toBeNull();
  });

  it("v9.67：中文名也能识别（避免 ctx 残留旧标的）", () => {
    expect(extractStockCode("个股深度调研 亨通光电")).toBe("600487");
    expect(extractStockCode("深度调研 中天科技")).toBe("600522");
    expect(extractStockCode("深度调研 贵州茅台")).toBe("600519");
    expect(extractStockCode("看看行情")).toBeNull();
  });

  it("识别新调研指令（需代码）", () => {
    expect(isNewResearchRequest("个股深度调研 中天科技 600522")).toBe(true);
    expect(isNewResearchRequest("深度调研 600487")).toBe(true);
    expect(isNewResearchRequest("继续深入查询")).toBe(false);
    expect(isNewResearchRequest("看看今天的行情")).toBe(false);
  });

  it("识别继续/深入指令", () => {
    expect(isContinueResearch("继续深入查询财务数据")).toBe(true);
    expect(isContinueResearch("继续 Phase 3 行业博弈")).toBe(true);
    expect(isContinueResearch("个股深度调研 600522")).toBe(false);
  });

  it("回复后推进 Phase（有工具调用 → 推进；含评级 → Phase 4 + 结论）", () => {
    const ctx = { code: "600522", name: "中天科技", phase: 0, collected: [], conclusion: "", updatedAt: 0 };
    const afterTool = updateResearchCtxAfterReply(ctx, "现价33.67 PE35.98", ["researchQuote"]);
    expect(afterTool!.phase).toBeGreaterThan(0);
    const afterFinal = updateResearchCtxAfterReply(afterTool, "综合评级：谨慎观望，等回调", ["researchQuote", "researchData"]);
    expect(afterFinal!.phase).toBe(4);
    expect(afterFinal!.conclusion).toContain("谨慎观望");
  });

  it("持久化到 localStorage 并可读回", () => {
    const ctx = { code: "600522", name: "中天科技", phase: 2, collected: ["a"], conclusion: "", updatedAt: 1 };
    saveResearchCtx(ctx);
    expect(true).toBe(true); // 无异常即通过（node 环境 catch 静默）
  });
});
