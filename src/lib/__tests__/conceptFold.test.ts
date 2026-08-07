// v11-8（P0）：概念折叠验收测试 —— 光通信/CPO → 通信（LLM 主线名折叠的根基）
// v11-13（P1）：大类表校准验收（华为昇腾→算力、半导体设备→芯片、宠物经济→大消费）
import { describe, it, expect } from "vitest";
import { conceptGroupOf, CONCEPT_GROUPS } from "../conceptGroups";

describe("V11-8 概念折叠（LLM 主线名折叠根基）", () => {
  it("光通信/CPO → 通信（不再与'通信'并存两条主线）", () => {
    expect(conceptGroupOf("光通信/CPO")).toBe("通信");
    expect(conceptGroupOf("光模块")).toBe("通信");
    expect(conceptGroupOf("CPO")).toBe("通信");
  });

  it("常见细分概念折叠到大类", () => {
    expect(conceptGroupOf("AI应用")).toBe("AI应用");
    expect(conceptGroupOf("算力")).toBe("算力");
    expect(conceptGroupOf("液冷")).toBe("算力");
  });
});

describe("V11-13 大类表校准", () => {
  it("华为昇腾 → 算力（AI 算力芯片，不再是通信）", () => {
    expect(conceptGroupOf("华为昇腾")).toBe("算力");
  });

  it("半导体设备 → 芯片（并入芯片组，不再分裂）", () => {
    expect(conceptGroupOf("半导体设备")).toBe("芯片");
    expect(conceptGroupOf("光刻机")).toBe("芯片");
    expect(conceptGroupOf("封测")).toBe("芯片");
  });

  it("宠物经济 → 大消费", () => {
    expect(conceptGroupOf("宠物经济")).toBe("大消费");
  });

  it("独立组'半导体设备'已删除（CONCEPT_GROUPS 无此组）", () => {
    expect(CONCEPT_GROUPS.some(g => g.group === "半导体设备")).toBe(false);
  });
});
