// v9.65（V2-P2）：双源熔断工具层测试
import { describe, it, expect, beforeEach } from "vitest";
import { fetchWithFallback, isCircuitOpen, recordSourceFailure, recordSourceSuccess } from "../dataSource";

describe("dataSource 双源熔断", () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* node 环境可能无 localStorage */ }
  });

  it("主源成功 → 直接返回，不查备源", async () => {
    const r = await fetchWithFallback("testA", [
      async () => 1,
      async () => { throw new Error("备源不应被调用"); },
    ]);
    expect(r).toBe(1);
  });

  it("主源失败 → 回退备源", async () => {
    const r = await fetchWithFallback("testB", [
      async () => { throw new Error("主源挂"); },
      async () => 42,
    ]);
    expect(r).toBe(42);
  });

  it("连续失败 3 次 → 熔断打开（isCircuitOpen=true）", () => {
    for (let i = 0; i < 3; i++) recordSourceFailure("srcX");
    expect(isCircuitOpen("srcX")).toBe(true);
  });

  it("熔断中的源被跳过（备源直接接管）", async () => {
    for (let i = 0; i < 3; i++) recordSourceFailure("skip#0");
    const calls: string[] = [];
    const r = await fetchWithFallback("skip", [
      async () => { calls.push("primary"); throw new Error("熔断中的主源不应被调"); },
      async () => { calls.push("backup"); return "ok"; },
    ]);
    expect(r).toBe("ok");
    expect(calls).toEqual(["backup"]);
  });

  it("成功后熔断清零", () => {
    for (let i = 0; i < 3; i++) recordSourceFailure("srcY");
    expect(isCircuitOpen("srcY")).toBe(true);
    recordSourceSuccess("srcY");
    expect(isCircuitOpen("srcY")).toBe(false);
  });
});
