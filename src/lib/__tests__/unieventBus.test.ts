// P2-5：统一事件总线纯函数测试
import { describe, it, expect, beforeEach } from "vitest";
import { emitEvent, listEvents, statsByType } from "../unieventBus";

function stubLocalStorage() {
  const store = new Map<string, string>();
  const ls = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
  };
  Object.defineProperty(globalThis, "localStorage", { value: ls, writable: true, configurable: true });
}

beforeEach(() => {
  stubLocalStorage();
  try { localStorage.clear(); } catch { /* skip */ }
});

describe("P2-5 unieventBus 统一事件总线", () => {
  it("emitEvent：写入并返回完整事件（含 ts）", () => {
    const e = emitEvent({ id: "watch_600001", type: "watch", severity: "critical", message: "测试" });
    expect(e.ts).toBeGreaterThan(0);
    expect(listEvents().length).toBe(1);
    expect(listEvents()[0].id).toBe("watch_600001");
  });

  it("listEvents：按类型过滤", () => {
    emitEvent({ id: "watch_1", type: "watch", severity: "critical", message: "w" });
    emitEvent({ id: "veto_1", type: "veto", severity: "warning", message: "v" });
    const watches = listEvents({ type: "watch" });
    expect(watches.length).toBe(1);
    expect(watches[0].id).toBe("watch_1");
  });

  it("listEvents：按 severity 过滤", () => {
    emitEvent({ id: "a1", type: "auction", severity: "critical", message: "c" });
    emitEvent({ id: "a2", type: "auction", severity: "info", message: "i" });
    expect(listEvents({ severity: "critical" }).length).toBe(1);
  });

  it("同 id 15 分钟内冷却不重复写", () => {
    emitEvent({ id: "seal_1", type: "seal", severity: "critical", message: "第一次" });
    emitEvent({ id: "seal_1", type: "seal", severity: "critical", message: "第二次" });
    expect(listEvents().length).toBe(1);
    expect(listEvents()[0].message).toBe("第一次");
  });

  it("statsByType：空数据返回空对象", () => {
    expect(statsByType()).toEqual({});
  });
});