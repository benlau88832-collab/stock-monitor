// v9.96.0（阶段一-1）：分级冷却状态机 —— 错误分类 → 冷却时长表 + 倍率累积（finshare SmartCooldown 移植）
import { describe, it, expect } from "vitest";
import { classifyError, COOLDOWN_MS, cooldownMultiplier } from "../jsonpQueue";

describe("v9.96.0 classifyError 错误分类", () => {
  it("403/forbidden → forbidden（WAF 拒绝，最长冷却）", () => {
    expect(classifyError(new Error("proxy HTTP 403"))).toBe("forbidden");
    expect(classifyError(new Error("forbidden origin"))).toBe("forbidden");
  });
  it("429/rate limit → rate_limit", () => {
    expect(classifyError(new Error("proxy HTTP 429"))).toBe("rate_limit");
  });
  it("503 → service_unavailable", () => {
    expect(classifyError(new Error("proxy HTTP 503"))).toBe("service_unavailable");
  });
  it("timeout/abort → timeout（最短冷却）", () => {
    expect(classifyError(new Error("JSONP timeout"))).toBe("timeout");
    expect(classifyError(new DOMException("aborted", "AbortError"))).toBe("timeout");
  });
  it("ECONNRESET/socket hang up/load error → connection_error", () => {
    expect(classifyError(new Error("socket hang up"))).toBe("connection_error");
    expect(classifyError(new Error("JSONP load error"))).toBe("connection_error");
    expect(classifyError(new Error("Failed to fetch"))).toBe("connection_error");
  });
  it("其他 → default", () => {
    expect(classifyError(new Error("bad jsonp body"))).toBe("default");
    expect(classifyError(undefined)).toBe("default");
  });
});

describe("v9.96.0 COOLDOWN_MS 分级时长表", () => {
  it("403 应远长于 timeout（WAF 拒绝重试无意义）", () => {
    expect(COOLDOWN_MS.forbidden).toBe(300_000);
    expect(COOLDOWN_MS.rate_limit).toBe(120_000);
    expect(COOLDOWN_MS.service_unavailable).toBe(30_000);
    expect(COOLDOWN_MS.timeout).toBe(5_000);
    expect(COOLDOWN_MS.connection_error).toBe(10_000);
    expect(COOLDOWN_MS.forbidden).toBeGreaterThan(COOLDOWN_MS.timeout * 10);
  });
});

describe("v9.96.0 cooldownMultiplier 倍率累积", () => {
  it("首次失败 ×1，后续按 min(1+N×0.5, 3.0) 累积", () => {
    expect(cooldownMultiplier(1)).toBe(1);
    expect(cooldownMultiplier(2)).toBe(1.5);
    expect(cooldownMultiplier(3)).toBe(2);
    expect(cooldownMultiplier(5)).toBe(3);
    expect(cooldownMultiplier(10)).toBe(3); // 封顶 3 倍
  });
});
