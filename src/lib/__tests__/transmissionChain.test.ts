// transmissionChain.test.ts —— 传导链知识库（v9.140.0 阶段三 #14）
import { describe, it, expect } from "vitest";
import { locateChain, buildChainView, CHAIN_KB } from "../transmissionChain";

describe("locateChain 板块定位", () => {
  it("有色金属 → 铜产业链上游（工业金属关键词）", () => {
    const hit = locateChain("有色金属");
    expect(hit).not.toBeNull();
    expect(hit!.chain.id).toBe("copper");
    expect(hit!.nodeIdx).toBe(0);
  });

  it("电池 → 锂电产业链中游", () => {
    const hit = locateChain("电池");
    expect(hit).not.toBeNull();
    expect(hit!.chain.id).toBe("lithium");
    expect(hit!.nodeIdx).toBe(2);
  });

  it("光伏设备 → 光伏产业链中游", () => {
    const hit = locateChain("光伏设备");
    expect(hit).not.toBeNull();
    expect(hit!.chain.id).toBe("solar");
  });

  it("未收录板块 → null（诚实缺省）", () => {
    expect(locateChain("元宇宙概念")).toBeNull();
    expect(locateChain("")).toBeNull();
  });

  it("知识库至少 8 条链", () => {
    expect(CHAIN_KB.length).toBeGreaterThanOrEqual(8);
  });
});

describe("buildChainView 传导链视图", () => {
  it("锂电中游（电池）：上游 2 跳 + 下游 1 跳", () => {
    const v = buildChainView("电池");
    expect(v).not.toBeNull();
    expect(v!.chainName).toContain("锂电");
    expect(v!.nodeName).toContain("电池制造");
    expect(v!.upstream.length).toBe(2);      // 材料 + 锂矿
    expect(v!.downstream.length).toBe(1);    // 整车
    expect(v!.upstream[0]).toContain("材料");
    expect(v!.downstream[0]).toContain("整车");
  });

  it("铜产业链上游（工业金属）：atHead=true、无上游、下游 2 跳", () => {
    const v = buildChainView("工业金属");
    expect(v).not.toBeNull();
    expect(v!.atHead).toBe(true);
    expect(v!.upstream).toEqual([]);
    expect(v!.downstream.length).toBe(2);
  });

  it("hops 参数限制跳数（hops=1）", () => {
    const v = buildChainView("电池", 1);
    expect(v!.upstream.length).toBe(1);
    expect(v!.downstream.length).toBe(1);
  });

  it("未收录板块 → null", () => {
    expect(buildChainView("某某板块")).toBeNull();
  });
});
