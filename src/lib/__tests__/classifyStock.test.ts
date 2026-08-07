// v11-11（P0）：全站唯一分类器 classifyStock 测试
import { describe, it, expect } from "vitest";
import { classifyStock } from "../classifyStock";

describe("V11-11 classifyStock 唯一分类器", () => {
  it("验收：中际旭创(光模块+CPO+5G+AI+算力) → 通信（3票>算力1>AI应用1）", () => {
    const r = classifyStock("300308", ["光模块", "CPO", "5G", "AI", "算力"]);
    expect(r.mainline).toBe("通信");
    expect(r.source).toBe("f10_concepts");
    const comm = r.candidates.find(c => c.group === "通信");
    expect(comm?.votes).toBe(3); // 光模块+CPO+5G → 通信
    expect(r.confidence).toBeGreaterThan(0.3);
  });

  it("无 F10 概念 → hybk 折叠（通信设备 → 通信）", () => {
    const r = classifyStock("600487", [], "通信设备");
    expect(r.mainline).toBe("通信");
    expect(r.source).toBe("hybk");
  });

  it("F10/hybk 都无 → 申万兜底", () => {
    const r = classifyStock("600519", [], "");
    expect(["白酒", "消费", "大消费", "其他"]).toContain(r.mainline);
  });

  it("全部无 → '其他'", () => {
    const r = classifyStock("999999", [], "");
    expect(r.mainline).toBe("其他");
    expect(r.confidence).toBe(0);
  });
});
