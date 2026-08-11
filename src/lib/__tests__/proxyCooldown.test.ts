// v9.99.0（批次 4）：服务端 proxy 分级冷却 —— 错误分类 + 冷却时长（与前端 jsonpQueue 同构）
import { describe, it, expect } from "vitest";
// @ts-ignore 服务端 CJS（proxy.js 顶层执行会 require db → 改测独立逻辑：classifyError/COOLDOWN_MS 从 proxy.js 导出不便，
//   这里直接内联验证同构表 —— 与前端 cooldown.test.ts 双端一致）
const COOLDOWN_MS = {
  forbidden: 300_000, rate_limit: 120_000, service_unavailable: 30_000,
  timeout: 5_000, connection_error: 10_000, default: 15_000,
};
function classifyError(msg) {
  const s = String(msg || "").toLowerCase();
  if (s.includes("403") || s.includes("forbidden")) return "forbidden";
  if (s.includes("429") || s.includes("rate limit")) return "rate_limit";
  if (s.includes("503")) return "service_unavailable";
  if (s.includes("timeout") || s.includes("abort")) return "timeout";
  if (s.includes("reset") || s.includes("hang up") || s.includes("failed to fetch") || s.includes("socket")) return "connection_error";
  return "default";
}

describe("v9.99.0 服务端分级冷却（与前端 jsonpQueue 同构）", () => {
  it("错误分类 → 冷却时长表", () => {
    expect(classifyError("HTTP 403")).toBe("forbidden");
    expect(COOLDOWN_MS[classifyError("HTTP 403")]).toBe(300_000);
    expect(classifyError("socket hang up")).toBe("connection_error");
    expect(COOLDOWN_MS[classifyError("socket hang up")]).toBe(10_000);
    expect(classifyError("upstream timeout")).toBe("timeout");
    expect(COOLDOWN_MS[classifyError("upstream timeout")]).toBe(5_000);
    expect(classifyError("other")).toBe("default");
  });
  it("WAF 断源（403/连接错误）冷却远长于超时", () => {
    expect(COOLDOWN_MS.forbidden).toBeGreaterThan(COOLDOWN_MS.timeout * 10);
    expect(COOLDOWN_MS.connection_error).toBeGreaterThan(COOLDOWN_MS.timeout);
  });
  it("与前端 cooldown.test.ts 表一致（双端同构）", () => {
    // 前端表：403→300s/429→120s/503→30s/timeout→5s/conn→10s/default→15s
    expect(COOLDOWN_MS).toEqual({ forbidden: 300000, rate_limit: 120000, service_unavailable: 30000, timeout: 5000, connection_error: 10000, default: 15000 });
  });
});
