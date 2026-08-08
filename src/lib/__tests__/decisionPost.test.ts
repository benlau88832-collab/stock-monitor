// P0-1：人类拍板台账纯函数测试
import { describe, it, expect, beforeEach } from "vitest";
import { makeTicketId, loadDayPosts, loadRecentPosts, hasPosted, buildPost } from "../decisionPost";

// 最小 localStorage stub（vitest node env 默认无 localStorage）
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

describe("P0-1 decisionPost 拍板台账", () => {
  it("makeTicketId：生成日期 acción 主题 6位 ms 末段结构", () => {
    const id = makeTicketId("2026-08-08", "AI应用", null, "confirm");
    expect(id.startsWith("2026-08-08_confirm_AI应用_")).toBe(true);
    expect(id.slice(-6)).toMatch(/^\d{6}$/);
  });

  it("makeTicketId：code 优先于 mainline", () => {
    const id1 = makeTicketId("2026-08-08", "AI应用", "600001", "confirm");
    expect(id1).toContain("600001");
    expect(id1).not.toContain("AI应用");
  });

  it("makeTicketId：非法字符被过滤（保留中文与字母数字）", () => {
    const id = makeTicketId("2026-08-08", "低空经济+", null, "confirm");
    expect(id).not.toContain("+");
    expect(id).toContain("低空经济");
  });

  it("loadDayPosts：空 localStorage 返回空数组（不抛错）", () => {
    localStorage.clear();
    const arr = loadDayPosts("2026-08-08");
    expect(Array.isArray(arr)).toBe(true);
    expect(arr.length).toBe(0);
  });

  it("loadDayPosts：损坏数据返回空数组（不抛错）", () => {
    localStorage.setItem("decision_post:2026-08-08", "{bad json");
    const arr = loadDayPosts("2026-08-08");
    expect(Array.isArray(arr)).toBe(true);
    expect(arr.length).toBe(0);
  });

  it("loadRecentPosts：近 N 天查多天 key（不抛错）", () => {
    localStorage.clear();
    const arr = loadRecentPosts(3);
    expect(Array.isArray(arr)).toBe(true);
  });

  it("hasPosted：空 decisionLogRef 返回 false", () => {
    expect(hasPosted("")).toBe(false);
    expect(hasPosted("")).toBe(false);
  });

  it("buildPost：生成完整对象，date/ticketId/ts 非空", () => {
    const p = buildPost({ mainline: "AI应用", humanAction: "confirm", confidenceAtPost: 80 });
    expect(p.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(p.ticketId).toContain("confirm");
    expect(p.ts).toBeGreaterThan(0);
    expect(p.humanAction).toBe("confirm");
    expect(p.confidenceAtPost).toBe(80);
    expect(p.executed).toBe(false);
    expect(p.pnl).toBeNull();
    expect(p.decisionLogRef).toBeNull();
  });

  it("buildPost：code 优先于 mainline 作为 ticketId subject", () => {
    const p = buildPost({ mainline: "AI", code: "600001", humanAction: "watch", priceAtPost: 12.5 });
    expect(p.ticketId).toContain("600001");
    expect(p.code).toBe("600001");
    expect(p.mainline).toBe("AI");
    expect(p.priceAtPost).toBe(12.5);
    expect(p.humanAction).toBe("watch");
  });

  it("buildPost：reject 动作可生成", () => {
    const p = buildPost({ mainline: "AI", humanAction: "reject" });
    expect(p.humanAction).toBe("reject");
    expect(p.ticketId).toContain("reject");
  });
});