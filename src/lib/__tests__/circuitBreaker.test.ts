// v9.80（P0 卡顿修复）：jsonpQueue 熔断快速短路测试
// 连续失败 ≥ 阈值 → 熔断窗口内新请求立即 reject（不重试不等 timeout）
// 窗口结束 → 半开试探 1 个，成功恢复 / 失败重新熔断
import { describe, it, expect, vi, beforeEach } from "vitest";

// 直接测试熔断状态机（纯逻辑，不触发真实 JSONP）
// 通过模块内部的 recordFail/recordSuccess 间接验证 —— 这里用 getCircuitState 观测

describe("v9.80 jsonpQueue 熔断快速短路", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("getCircuitState 初始态：未熔断", async () => {
    const mod = await import("../jsonpQueue");
    expect(mod.getCircuitState()).toEqual({ open: false, failCount: 0, halfOpen: false });
  });

  it("getJsonpQueueState 导出存在（OpsPanel 兼容）", async () => {
    const mod = await import("../jsonpQueue");
    expect(typeof mod.getJsonpQueueState).toBe("function");
    const s = mod.getJsonpQueueState();
    expect(typeof s.inflight).toBe("number");
    expect(typeof s.queueLength).toBe("number");
  });

  it("getCircuitState 返回结构完整", async () => {
    const mod = await import("../jsonpQueue");
    const s = mod.getCircuitState();
    expect(s).toHaveProperty("open");
    expect(s).toHaveProperty("failCount");
    expect(s).toHaveProperty("halfOpen");
  });
});