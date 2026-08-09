// v9.81（性能）：cloudStore 增量同步测试
// migrateLocalStorageToCloud：首次全量上传，之后只传变更 key（字符串比对，不 parse）
// 服务端 kv/bulk 限 100 条/请求 → 超量分块（修复原全量上传被静默截断的数据丢失隐患）
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// 最小 localStorage stub（含 key()/length，cloudStore 扫描需要）
function stubLocalStorage() {
  const store = new Map<string, string>();
  const ls = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  };
  Object.defineProperty(globalThis, "localStorage", { value: ls, writable: true, configurable: true });
  return ls;
}

// 模拟本地服务（window.location.hostname 非 github.io → isLocalServer true）
// 并 stub fetch 记录 /api/db/kv/bulk 请求体
function stubWindowAndFetch() {
  (globalThis as any).window = { location: { hostname: "localhost" } };
  const bulkCalls: unknown[][] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, opts: any) => {
    if (String(url).includes("/api/db/kv/bulk")) {
      const body = JSON.parse(opts.body) as unknown[];
      bulkCalls.push(body);
      return { ok: true, json: async () => ({ ok: true, count: body.length }) };
    }
    return { ok: false, json: async () => ({}) };
  }));
  return bulkCalls;
}

beforeEach(() => {
  vi.resetModules();
  stubLocalStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("v9.81 cloudStore 增量同步", () => {
  it("首次调用全量上传（幂等 upsert）", async () => {
    const bulkCalls = stubWindowAndFetch();
    localStorage.setItem("a", JSON.stringify({ x: 1 }));
    localStorage.setItem("b", "plain-string");
    localStorage.setItem("c", JSON.stringify([1, 2, 3]));
    const mod = await import("../cloudStore");
    const n = await mod.migrateLocalStorageToCloud();
    expect(n).toBe(3);
    expect(bulkCalls.length).toBe(1);
    const uploaded = bulkCalls[0] as Array<{ key: string; value: unknown }>;
    expect(uploaded.map(i => i.key).sort()).toEqual(["a", "b", "c"]);
    // 字符串值按 __raw 包装还原
    expect((uploaded.find(i => i.key === "b") as any).value).toEqual({ __raw: "plain-string" });
  });

  it("二次调用无变更 → 0 上传（增量核心）", async () => {
    const bulkCalls = stubWindowAndFetch();
    localStorage.setItem("a", JSON.stringify({ x: 1 }));
    const mod = await import("../cloudStore");
    await mod.migrateLocalStorageToCloud();
    const callsAfterFirst = bulkCalls.length;
    const n2 = await mod.migrateLocalStorageToCloud();
    expect(n2).toBe(0);
    expect(bulkCalls.length).toBe(callsAfterFirst); // 第二次没有发任何请求
  });

  it("只上传变更的 key（其余跳过）", async () => {
    const bulkCalls = stubWindowAndFetch();
    localStorage.setItem("a", "v1");
    localStorage.setItem("b", "v1");
    const mod = await import("../cloudStore");
    await mod.migrateLocalStorageToCloud();
    // 变更 b，a 不动
    localStorage.setItem("b", "v2");
    const n = await mod.migrateLocalStorageToCloud();
    expect(n).toBe(1);
    const last = bulkCalls[bulkCalls.length - 1] as Array<{ key: string }>;
    expect(last.map(i => i.key)).toEqual(["b"]);
  });

  it("超过 100 条分块上传（服务端 bulk 上限）", async () => {
    const bulkCalls = stubWindowAndFetch();
    for (let i = 0; i < 230; i++) localStorage.setItem(`k${i}`, JSON.stringify(i));
    const mod = await import("../cloudStore");
    const n = await mod.migrateLocalStorageToCloud();
    expect(n).toBe(230);
    // 100 + 100 + 30 三块
    expect(bulkCalls.length).toBe(3);
    expect((bulkCalls[0] as unknown[]).length).toBe(100);
    expect((bulkCalls[1] as unknown[]).length).toBe(100);
    expect((bulkCalls[2] as unknown[]).length).toBe(30);
  });

  it("敏感 key（ai_settings/llm_api_key 前缀）不上传", async () => {
    const bulkCalls = stubWindowAndFetch();
    localStorage.setItem("ai_settings_v1", JSON.stringify({ apiKey: "SECRET" }));
    localStorage.setItem("llm_api_key", "SECRET2");
    localStorage.setItem("normal_key", "1");
    const mod = await import("../cloudStore");
    const n = await mod.migrateLocalStorageToCloud();
    expect(n).toBe(1);
    const uploaded = bulkCalls[0] as Array<{ key: string }>;
    expect(uploaded.map(i => i.key)).toEqual(["normal_key"]);
  });
});
