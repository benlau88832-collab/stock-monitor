// v9.90.0：jsonpQueue script 直连层域名 fallback 测试
// 行为（实测确认）：fetchViaProxy 失败后（服务端离线），script 层**直接先试 fallback 域**
// （push2 已知不可达 → 先 push2delay，JSONP 无 CORS 限制），fallback 域失败才回原 URL。
// 守卫：push2delay 供数成功 / tencentKline（纯 JSON）不换域 / 非 fallback 域不换域
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const createdScripts: Array<{ src: string; onload: (() => void) | null; onerror: (() => void) | null }> = [];

function setupDomStub() {
  vi.stubGlobal("window", {});
  vi.stubGlobal("document", {
    createElement: vi.fn((tag: string) => {
      if (tag === "script") {
        const s: any = { src: "", onload: null, onerror: null, referrerPolicy: "", parentNode: null };
        createdScripts.push(s);
        return s;
      }
      return {};
    }),
    head: { appendChild: vi.fn((el: any) => { el.parentNode = { removeChild: vi.fn() }; }) },
  });
  // 模拟服务端离线：/api/proxy fetch 一律拒绝
  vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
}

async function waitFor(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timeout");
    await new Promise(r => setTimeout(r, 30));
  }
}

function triggerCallback(i: number, data: unknown) {
  const s = createdScripts[i];
  const m = s.src.match(/cb=([\w.]+)/);
  const cbName = m ? m[1] : "";
  if (cbName && (window as any)[cbName]) (window as any)[cbName](data);
}

let mod: typeof import("../jsonpQueue");
beforeEach(async () => {
  vi.resetModules();
  createdScripts.length = 0;
  setupDomStub();
  mod = await import("../jsonpQueue");
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("v9.90.0 script 直连层域名 fallback", () => {
  it("服务端离线时 push2 请求 → script 直连 push2delay 供数成功", async () => {
    const url = "https://push2.eastmoney.com/api/qt/ulist.np/get?ut=x&fltt=2&fields=f2,f12&secids=1.600001";
    const p = mod.queuedJsonp(url, 4000);
    // script 出现（fallback 域优先）
    await waitFor(() => createdScripts.length >= 1);
    expect(createdScripts[0].src).toContain("push2delay.eastmoney.com");
    // 触发回调 → resolve
    triggerCallback(0, { rc: 0, data: { total: 1 } });
    const result = await p;
    expect(result).toEqual({ rc: 0, data: { total: 1 } });
    // 供数源已记录（HealthDot/OpsPanel 可观测）
    const srcState = mod.getSourceState();
    expect(srcState.some(x => x.host === "push2.eastmoney.com" && x.source === "push2delay.eastmoney.com")).toBe(true);
  });

  it("push2 与 push2delay 都失败 → 回退原 URL（双保险）", async () => {
    const url = "https://push2.eastmoney.com/api/qt/ulist.np/get?ut=x&fltt=2&fields=f2,f12&secids=1.600001";
    const p = mod.queuedJsonp(url, 4000);
    await waitFor(() => createdScripts.length >= 1);
    // fallback 域 script 失败（onerror 不触发 → 4s 超时；这里直接触发 onerror 加速）
    if (createdScripts[0].onerror) createdScripts[0].onerror();
    // 原 URL script 出现
    await waitFor(() => createdScripts.some(s => s.src.includes("push2.eastmoney.com") && !s.src.includes("push2delay")));
    expect(createdScripts.some(s => s.src.includes("push2.eastmoney.com"))).toBe(true);
    p.catch(() => {});
  });

  it("fallback 目标为 tencentKline（纯 JSON 非 JSONP）→ script 层不换域", async () => {
    const url = "https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.600001&fields1=f1&fields2=f51";
    const p = mod.queuedJsonp(url, 4000);
    await waitFor(() => createdScripts.length >= 1);
    // 不应出现腾讯域 script（纯 JSON 无法 JSONP 回调）
    expect(createdScripts[0].src).toContain("push2his.eastmoney.com");
    expect(createdScripts[0].src.includes("web.ifzq.gtimg.cn")).toBe(false);
    p.catch(() => {});
  });

  it("非 fallback 域（np-weblist）失败 → 不换域", async () => {
    const url = "https://np-weblist.eastmoney.com/comm/web/getFastNewsList?client=web&pageSize=5";
    const p = mod.queuedJsonp(url, 4000);
    await waitFor(() => createdScripts.length >= 1);
    expect(createdScripts[0].src).toContain("np-weblist.eastmoney.com");
    p.catch(() => {});
  });
});
