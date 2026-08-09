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

  it("v9.81 按 host 分桶：A 域名熔断不影响 B 域名", async () => {
    const mod = await import("../jsonpQueue");
    // 最小 DOM 桩：script.src 赋值 5ms 后触发 onerror（模拟东财断源快速失败）
    let errorFired = 0;
    (globalThis as any).window = globalThis;
    (globalThis as any).document = {
      createElement: () => {
        const el: any = {};
        Object.defineProperty(el, "src", {
          set() { setTimeout(() => { errorFired++; if (el.onerror) el.onerror(); }, 5); },
        });
        el.referrerPolicy = "";
        el.parentNode = null;
        el.removeChild = () => {};
        return el;
      },
      head: { appendChild: () => {} },
    };
    const URL_A = "https://a.eastmoney.com/x?id=";
    const URL_B = "https://b.tencent.com/y?cb=1";

    // A 域名连败 3 次（阈值）→ A 熔断（URL 各不相同，绕过 queuedJsonp 的 URL 去重）
    await Promise.allSettled([0, 1, 2].map(i => mod.queuedJsonp(URL_A + i, 200, "cb", 0)));
    expect(mod.getCircuitState().open).toBe(true);

    // B 域名不受牵连：请求走真实执行路径（onerror 触发），而非 circuit open 快速失败
    const firedBefore = errorFired;
    const rB = await mod.queuedJsonp(URL_B, 200, "cb", 0).then(() => "ok", (e: Error) => e.message);
    expect(errorFired).toBe(firedBefore + 1);
    expect(rB).toBe("JSONP load error");

    // A 域名在熔断窗口内：请求立即 reject，不触发 onerror
    const firedBeforeA = errorFired;
    const rA = await mod.queuedJsonp(URL_A + 9, 200, "cb", 0).then(() => "ok", (e: Error) => e.message);
    expect(rA).toBe("circuit open (data source unavailable)");
    expect(errorFired).toBe(firedBeforeA); // 没有发出真实请求
  });
});