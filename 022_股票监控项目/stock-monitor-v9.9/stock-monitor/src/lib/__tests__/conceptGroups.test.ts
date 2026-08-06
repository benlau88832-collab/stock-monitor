// v9.51（V7-4/5）：概念归类重构验收测试
// 验收样本：有机硅/铜箔/毫米波雷达/在线教育/激光雷达/卫星通信/多晶硅
import { describe, it, expect } from "vitest";
import { conceptGroupOf, foldConcepts } from "../conceptGroups";

describe("conceptGroups 概念归类（V7-4/5）", () => {
  it("单字词根已删除：有机硅 → 化工（不再被 芯片 的'硅'吞并）", () => {
    expect(conceptGroupOf("有机硅")).toBe("化工");
  });

  it("铜箔 → 元器件（不再被 有色 的'铜'吞并）", () => {
    expect(conceptGroupOf("铜箔")).toBe("元器件");
  });

  it("毫米波雷达 → 智能驾驶（最长词根 5字 胜过 通信'毫米波'3字）", () => {
    expect(conceptGroupOf("毫米波雷达")).toBe("智能驾驶");
  });

  it("激光雷达 → 智能驾驶（胜过 军工'雷达'）", () => {
    expect(conceptGroupOf("激光雷达")).toBe("智能驾驶");
  });

  it("在线教育 → 教育（不再被 AI应用 吞并）", () => {
    expect(conceptGroupOf("在线教育")).toBe("教育");
  });

  it("多晶硅 → 新能源（光伏硅料，不再错归芯片）", () => {
    expect(conceptGroupOf("多晶硅")).toBe("新能源");
  });

  it("卫星通信 → 通信（最长词根胜过 军工'卫星'）", () => {
    expect(conceptGroupOf("卫星通信")).toBe("通信");
  });

  it("数据中心 → 算力（重叠概念唯一归属）", () => {
    expect(conceptGroupOf("数据中心")).toBe("算力");
  });

  it("foldConcepts 去重折叠", () => {
    const folded = foldConcepts(["光模块", "5G", "光模块", "PCB"]);
    expect(folded).toContain("通信");
    expect(folded).toContain("元器件");
    expect(new Set(folded).size).toBe(folded.length);
  });

  it("无匹配概念返回 null（不误归类）", () => {
    expect(conceptGroupOf("某个不存在的冷门概念")).toBeNull();
  });
});
